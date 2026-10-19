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
import {botPhoneAccessBlocked} from "./bot-account-access.js";
import { randomUUID } from "node:crypto";
import type { AppDatabase } from "./db.js";
import type { Config } from "./config.js";
import { effectiveWhatsAppConfig } from "./integrations.js";
import { sameWhatsAppNumber, type EvolutionClient, type GroupSlot } from "./bot-evolution.js";

import { recordGroupVerification, recordMemberVerification, materializeApprovedMembership } from "./group-verification.js";

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
  if(botPhoneAccessBlocked(db,digits))return {queued:false,reason:"ACCOUNT_ACCESS_REVOKED"};
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
       (SELECT COUNT(DISTINCT v.phone) FROM whatsapp_member_verifications v WHERE v.group_code=g.code AND v.external_group_id=g.whatsapp_group_id AND v.revoked_at IS NULL) AS members
     FROM groups g WHERE g.whatsapp_group_id IS NOT NULL AND g.enabled=1 ORDER BY CAST(g.code AS INTEGER)`,
  ).all() as Array<{ code: string; gid: string; enabled: number; members: number }>;
  return rows.map((r) => ({ code: r.code, memberCount: r.members, capacity: GROUP_CAPACITY, enabled: r.enabled !== 0 }));
}

export type JoinOutcome = { phone: string; groupCode?: string; requestId?: string; alreadyMember?: boolean; added?: boolean; invited?: boolean; escalated?: boolean; reason?: string };

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

  db.prepare("UPDATE group_join_requests SET status='PENDING' WHERE status='PROCESSING' AND updated_at<?")
    .run(new Date(Date.now() - 120_000).toISOString());
  const job = db.prepare(
    "SELECT id,phone,name,attempts FROM group_join_requests WHERE status='PENDING' ORDER BY created_at LIMIT 1",
  ).get() as { id: string; phone: string; name?: string; attempts: number } | undefined;
  if (!job) return undefined;

  const stamp = new Date().toISOString();
  const claimed = db.prepare("UPDATE group_join_requests SET status='PROCESSING',updated_at=? WHERE id=? AND status='PENDING'").run(stamp, job.id);
  if (!claimed.changes) return undefined;
  if(botPhoneAccessBlocked(db,job.phone)){
    db.prepare("UPDATE group_join_requests SET status='FAILED',last_error='ACCOUNT_ACCESS_REVOKED',updated_at=? WHERE id=?").run(stamp,job.id);
    return {phone:job.phone,reason:"ACCOUNT_ACCESS_REVOKED"};
  }
  if (db.prepare("SELECT 1 FROM group_memberships WHERE phone=? AND revoked_at IS NOT NULL").get(job.phone)) {
    db.prepare("UPDATE group_join_requests SET status='FAILED',last_error='MEMBERSHIP_REVOKED_REQUIRES_REVIEW',updated_at=? WHERE id=?").run(stamp, job.id);
    deps.escalate?.(job.phone, job.name, "MEMBERSHIP_REVOKED_REQUIRES_REVIEW");
    return { phone: job.phone, escalated: true, reason: "MEMBERSHIP_REVOKED_REQUIRES_REVIEW" };
  }
  // Validate each mapping against the live group, instead of getting stuck on a
  // stale/unavailable group 1 while a real group 2 is accepting participants.
  const candidates=groupSlots(db).filter(slot=>/^[1-9]\d{0,2}$/.test(slot.code));
  let target:GroupSlot|undefined,groupJid:string|undefined,initialPhones:string[]=[];
  const available:Array<{slot:GroupSlot;gid:string;phones:string[]}>=[];
  // Check every real group first: an existing member of group 2 must not be
  // added to group 1 just because group 1 has room. LIDs are decoded by client.
  for(const candidate of candidates){
    const gid=(db.prepare("SELECT whatsapp_group_id AS gid FROM groups WHERE code=?").get(candidate.code) as {gid:string}).gid;
    if(!/^\d+(?:-\d+)?@g\.us$/.test(gid))continue;
    try{
      const phones=await client.groupParticipants(gid);
      available.push({slot:candidate,gid,phones});
    }catch{ /* An unavailable mapping cannot establish admission or presence. */ }
  }
  const existingMember=available.find(group=>group.phones.some(phone=>sameWhatsAppNumber(phone,job.phone)));
  const selected=existingMember??available.find(group=>group.phones.length<GROUP_CAPACITY);
  if(selected){target=selected.slot;groupJid=selected.gid;initialPhones=selected.phones;}
  if(!target||!groupJid){
    db.prepare("UPDATE group_join_requests SET status='FAILED',last_error='NO_VERIFIED_GROUP_WITH_ROOM',attempts=attempts+1,updated_at=? WHERE id=?").run(stamp,job.id);
    deps.escalate?.(job.phone,job.name,"NO_VERIFIED_GROUP_WITH_ROOM");
    return {phone:job.phone,escalated:true,reason:"NO_VERIFIED_GROUP_WITH_ROOM"};
  }

  const targetCode=target.code,verifiedGroupJid=groupJid;
  try {
    const containsPhone = (phones: string[]) => phones.some(phone => sameWhatsAppNumber(phone, job.phone));
    if (!containsPhone(initialPhones)) await client.addParticipant(verifiedGroupJid, job.phone);
    if (!containsPhone(await client.groupParticipants(verifiedGroupJid))) throw new Error("EVOLUTION_MEMBERSHIP_NOT_CONFIRMED");
    db.transaction(() => {
      if(botPhoneAccessBlocked(db,job.phone))throw new Error("ACCOUNT_ACCESS_REVOKED");
      const revoked = db.prepare("SELECT 1 FROM group_memberships WHERE phone=? AND revoked_at IS NOT NULL").get(job.phone);
      if (revoked) throw new Error("MEMBERSHIP_REVOKED_REQUIRES_REVIEW");
      recordGroupVerification(db, "EVOLUTION", targetCode, verifiedGroupJid, `SOS YOUTUBER ${targetCode}`, 0, stamp);
      recordMemberVerification(db, "EVOLUTION", targetCode, job.phone, verifiedGroupJid, true, stamp);
      const approved = materializeApprovedMembership(db, job.phone, targetCode, stamp);
      if (!approved.accessGranted) throw new Error("MEMBERSHIP_APPROVAL_NOT_CONFIRMED");
      const primary=db.prepare("SELECT group_code AS code FROM group_memberships WHERE phone=? AND revoked_at IS NULL").get(job.phone) as {code:string};
      db.prepare("UPDATE users SET group_code=?,updated_at=? WHERE phone=? AND deleted_at IS NULL").run(primary.code, stamp, job.phone);
      db.prepare("UPDATE group_join_requests SET status='DONE',group_code=?,attempts=attempts+1,last_error=NULL,updated_at=? WHERE id=?").run(targetCode, stamp, job.id);
    })();
    return { phone: job.phone, groupCode: targetCode, requestId:job.id, alreadyMember:containsPhone(initialPhones), added: true };
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message.slice(0, 120) : "ADD_FAILED";
    if (reason === "ACCOUNT_ACCESS_REVOKED" || reason === "MEMBERSHIP_REVOKED_REQUIRES_REVIEW" || reason === "MEMBERSHIP_APPROVAL_NOT_CONFIRMED") {
      db.prepare("UPDATE group_join_requests SET status='FAILED',group_code=?,attempts=attempts+1,last_error=?,updated_at=? WHERE id=?")
        .run(targetCode, reason, stamp, job.id);
      deps.escalate?.(job.phone, job.name, reason);
      return { phone: job.phone, groupCode: targetCode, escalated: true, reason };
    }
    // Privacidade: a pessoa pode bloquear "ser adicionada". O convite resolve sem
    // expor ninguém — ela entra com um toque.
    let inviteUrl: string | undefined;
    try { inviteUrl = await client.groupInviteUrl?.(verifiedGroupJid); } catch { /* sem convite disponível */ }
    const attempts = job.attempts + 1;
    if (inviteUrl || attempts >= 3) {
      db.prepare("UPDATE group_join_requests SET status=?,group_code=?,attempts=?,last_error=?,updated_at=? WHERE id=?")
        .run(inviteUrl ? "INVITED" : "FAILED", targetCode, attempts, reason, stamp, job.id);
      if (inviteUrl) deps.sendInvite?.(job.phone, targetCode, inviteUrl);
      else deps.escalate?.(job.phone, job.name, reason);
      return { phone: job.phone, groupCode: targetCode, invited: Boolean(inviteUrl), escalated: !inviteUrl, reason };
    }
    db.prepare("UPDATE group_join_requests SET status='PENDING',attempts=?,last_error=?,updated_at=? WHERE id=?").run(attempts, reason, stamp, job.id);
    return { phone: job.phone, groupCode: targetCode, reason };
  }
}
