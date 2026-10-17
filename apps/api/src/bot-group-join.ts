// AUDITORIA / entrada automática em grupo — "reduzir ação humana ao máximo".
//
// Pedido do dono: quem fala com o bot e AINDA NÃO está num grupo deve ser ADICIONADO
// pelo próprio bot — no SOS Youtuber 1, ou no 2, 3, 4, 5... conforme a lotação. Só
// vira pendência para o Owner quando o bot genuinamente não consegue resolver.
//
// Por que uma FILA e não uma chamada direta: adicionar alguém a um grupo é uma chamada
// de rede, e o processamento de mensagens roda dentro de uma transação SQLite (síncrona).
// Fazer I/O ali travaria o banco. Então o inbound só ENFILEIRA o pedido e um worker no
// tick executa com calma — respeitando a cadência anti-ban do motor.
//
// Privacidade do WhatsApp: muita gente bloqueia "ser adicionado a grupos". Nesse caso o
// add falha e o bot manda o LINK DE CONVITE, que depende de um toque da pessoa (e não
// expõe ninguém). Só depois de esgotar as duas vias é que o Owner é chamado.
import { randomUUID } from "node:crypto";
import type { AppDatabase } from "./db.js";
import type { Config } from "./config.js";
import { effectiveWhatsAppConfig } from "./integrations.js";
import { pickGroupWithRoom, type EvolutionClient, type GroupSlot } from "./bot-evolution.js";

/** Lotação padrão de um grupo de WhatsApp (o limite real da plataforma). */
export const GROUP_CAPACITY = 1024;

export function ensureGroupJoinQueue(db: AppDatabase) {
  db.exec(`CREATE TABLE IF NOT EXISTS group_join_requests (
    id TEXT PRIMARY KEY,
    phone TEXT NOT NULL UNIQUE,
    name TEXT,
    status TEXT NOT NULL DEFAULT 'PENDING',
    attempts INTEGER NOT NULL DEFAULT 0,
    group_code TEXT,
    last_error TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );`);
  db.exec("CREATE INDEX IF NOT EXISTS idx_group_join_status ON group_join_requests(status,created_at);");
}

/**
 * Enfileira a entrada de alguém em um grupo. Idempotente por telefone: falar com o bot
 * dez vezes não gera dez pedidos (era o que enchia o painel do Owner de pendências).
 */
export function enqueueGroupJoin(db: AppDatabase, phone: string, name?: string): { queued: boolean; reason?: string } {
  ensureGroupJoinQueue(db);
  const digits = String(phone).replace(/\D/g, "");
  if (!/^[1-9]\d{7,14}$/.test(digits)) return { queued: false, reason: "INVALID_PHONE" };
  const stamp = new Date().toISOString();
  const existing = db.prepare("SELECT status FROM group_join_requests WHERE phone=?").get(digits) as { status: string } | undefined;
  if (existing && existing.status !== "FAILED") return { queued: true, reason: "ALREADY_QUEUED" };
  db.prepare(`INSERT INTO group_join_requests (id,phone,name,status,attempts,created_at,updated_at)
    VALUES (?,?,?,'PENDING',0,?,?)
    ON CONFLICT(phone) DO UPDATE SET name=COALESCE(excluded.name,group_join_requests.name),
      status='PENDING',attempts=0,last_error=NULL,updated_at=excluded.updated_at`)
    .run(randomUUID(), digits, name ?? null, stamp, stamp);
  return { queued: true };
}

/** Grupos candidatos com a lotação atual, para o roteador de capacidade. */
export function groupSlots(db: AppDatabase): GroupSlot[] {
  const rows = db.prepare(
    `SELECT g.code AS code, g.whatsapp_group_id AS gid, g.enabled AS enabled,
       (SELECT COUNT(*) FROM group_memberships m WHERE m.group_code=g.code AND m.revoked_at IS NULL) AS members
     FROM groups g WHERE g.whatsapp_group_id IS NOT NULL ORDER BY g.code`,
  ).all() as Array<{ code: string; gid: string; enabled: number; members: number }>;
  return rows.map((r) => ({ code: r.code, memberCount: r.members, capacity: GROUP_CAPACITY, enabled: r.enabled !== 0 }));
}

export type JoinOutcome = { phone: string; groupCode?: string; added?: boolean; invited?: boolean; escalated?: boolean; reason?: string };

/**
 * Processa UM pedido da fila. Devolve o desfecho para o chamador registrar/avisar.
 * `sendInvite` entrega o link de convite quando o add direto é recusado (privacidade).
 */
export async function processGroupJoin(
  db: AppDatabase, config: Config, client: EvolutionClient,
  deps: { sendInvite?: (phone: string, groupCode: string, inviteUrl?: string) => void; escalate?: (phone: string, name: string | undefined, reason: string) => void } = {},
): Promise<JoinOutcome | undefined> {
  ensureGroupJoinQueue(db);
  const runtime = effectiveWhatsAppConfig(db, config);
  if (runtime.WHATSAPP_MODE !== "EVOLUTION" && runtime.WHATSAPP_MODE !== "HYBRID_PLUS") return undefined;

  const job = db.prepare(
    "SELECT id,phone,name,attempts FROM group_join_requests WHERE status='PENDING' ORDER BY created_at LIMIT 1",
  ).get() as { id: string; phone: string; name?: string; attempts: number } | undefined;
  if (!job) return undefined;

  const stamp = new Date().toISOString();
  const target = pickGroupWithRoom(groupSlots(db));
  if (!target) {
    db.prepare("UPDATE group_join_requests SET status='FAILED',last_error='NO_GROUP_WITH_ROOM',attempts=attempts+1,updated_at=? WHERE id=?").run(stamp, job.id);
    deps.escalate?.(job.phone, job.name, "NO_GROUP_WITH_ROOM");
    return { phone: job.phone, escalated: true, reason: "NO_GROUP_WITH_ROOM" };
  }
  const groupJid = (db.prepare("SELECT whatsapp_group_id AS gid FROM groups WHERE code=?").get(target.code) as { gid: string } | undefined)?.gid;
  if (!groupJid) {
    db.prepare("UPDATE group_join_requests SET status='FAILED',last_error='GROUP_NOT_PAIRED',attempts=attempts+1,updated_at=? WHERE id=?").run(stamp, job.id);
    deps.escalate?.(job.phone, job.name, "GROUP_NOT_PAIRED");
    return { phone: job.phone, groupCode: target.code, escalated: true, reason: "GROUP_NOT_PAIRED" };
  }

  try {
    await client.addParticipant(groupJid, job.phone);
    db.prepare("UPDATE group_join_requests SET status='DONE',group_code=?,attempts=attempts+1,last_error=NULL,updated_at=? WHERE id=?").run(target.code, stamp, job.id);
    return { phone: job.phone, groupCode: target.code, added: true };
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message.slice(0, 120) : "ADD_FAILED";
    // Privacidade: a pessoa pode bloquear "ser adicionada". O convite resolve sem
    // expor ninguém — ela entra com um toque.
    let inviteUrl: string | undefined;
    try { inviteUrl = await client.groupInviteUrl?.(groupJid); } catch { /* sem convite disponível */ }
    const attempts = job.attempts + 1;
    if (inviteUrl || attempts >= 3) {
      db.prepare("UPDATE group_join_requests SET status=?,group_code=?,attempts=?,last_error=?,updated_at=? WHERE id=?")
        .run(inviteUrl ? "INVITED" : "FAILED", target.code, attempts, reason, stamp, job.id);
      if (inviteUrl) deps.sendInvite?.(job.phone, target.code, inviteUrl);
      else deps.escalate?.(job.phone, job.name, reason);
      return { phone: job.phone, groupCode: target.code, invited: Boolean(inviteUrl), escalated: !inviteUrl, reason };
    }
    db.prepare("UPDATE group_join_requests SET attempts=?,last_error=?,updated_at=? WHERE id=?").run(attempts, reason, stamp, job.id);
    return { phone: job.phone, groupCode: target.code, reason };
  }
}
