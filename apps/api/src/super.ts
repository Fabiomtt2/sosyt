import { trialSuperView } from "./gamification.js";
// AUDITORIA / assinatura SUPER: privilégios por tempo, revogados automaticamente.
//
// Princípio que mantém isto honesto: **não existe estado "é super" gravado**. A
// assinatura é uma linha com `expires_at`, e todo privilégio é derivado dela na
// hora da leitura. Assim a expiração não depende de nenhuma rotina rodar — no
// segundo seguinte ao vencimento, o selo, o chat sem espera e os uploads extras
// simplesmente deixam de existir. É o mesmo princípio do ledger que a auditoria
// aprovou: derivar em vez de duplicar estado.
import { randomUUID } from "node:crypto";
import type { AppDatabase } from "./db.js";

export const ITEM_SUPER = "SUPER";
export const SUPER_DAYS = 30;
export const SUPER_UPLOADS_PER_ROUND = 5;   // contra 1 do participante comum
export const SUPER_PINNED_SLOTS = 3;        // vitrine compartilhada do chat
export const SUPER_PIN_MINUTES = 60;

export type SuperState = {
  active: boolean;
  expiresAt?: string;
  secondsRemaining: number;
  autoRenew: boolean;
  source?: string;
  uploadsPerRound: number;
  chatCooldownSeconds: number;   // 0 = sem espera
  canPin: boolean;
};

function err(statusCode: number, message: string, extra: Record<string, unknown> = {}) {
  return Object.assign(new Error(message), { statusCode, ...extra });
}

/** Verdade única sobre a assinatura. Tudo mais deriva daqui. */
export function superState(db: AppDatabase, userId: string): SuperState {
  const row = db.prepare(`SELECT expires_at AS expiresAt, auto_renew AS autoRenew, source
    FROM super_subscriptions WHERE user_id=? AND revoked_at IS NULL`).get(userId) as
    | { expiresAt: string; autoRenew: number; source: string } | undefined;
  const trial=trialSuperView(db,userId);
  const paidUntil=row?Date.parse(row.expiresAt):0;
  const trialUntil=trial.expiresAt?Date.parse(trial.expiresAt):0;
  const until=Math.max(paidUntil,trialUntil);
  const active=until>Date.now();
  return {
    active,
    expiresAt:until>0?new Date(until).toISOString():undefined,
    secondsRemaining: active ? Math.max(0, Math.floor((until - Date.now()) / 1000)) : 0,
    autoRenew: paidUntil>Date.now() && Boolean(row?.autoRenew),
    source: trialUntil>paidUntil?trial.source:row?.source,
    uploadsPerRound: active ? SUPER_UPLOADS_PER_ROUND : 1,
    chatCooldownSeconds: active ? 0 : -1,   // -1 = usa o cooldown padrão do chat
    canPin: active
  };
}

/** O ROOT_OWNER tem tudo, sempre — inclusive SUPER, sem gastar nem expirar. */
export function isRootOwner(db: AppDatabase, userId: string): boolean {
  const row = db.prepare("SELECT role FROM owner_access WHERE user_id=? AND active=1").get(userId) as { role: string } | undefined;
  return row?.role === "ROOT_OWNER";
}

/** Estado efetivo: ROOT enxerga privilégios ilimitados sem assinatura. */
export function effectiveSuper(db: AppDatabase, userId: string): SuperState {
  if (isRootOwner(db, userId)) {
    return { active: true, secondsRemaining: Number.MAX_SAFE_INTEGER, autoRenew: false, source: "ROOT_OWNER",
      uploadsPerRound: Number.MAX_SAFE_INTEGER, chatCooldownSeconds: 0, canPin: true };
  }
  return superState(db, userId);
}

/**
 * Concede/renova. Renovar **soma** ao tempo restante em vez de substituir — quem
 * renova antes do fim não perde os dias que já pagou.
 */
export function grantSuper(db: AppDatabase, userId: string, opts: { days?: number; source: string; autoRenew?: boolean; referenceId?: string; note?:string }): SuperState {
  const days = opts.days ?? SUPER_DAYS;
  const now = Date.now();
  return db.transaction(() => {
    if (opts.referenceId) {
      const already = db.prepare("SELECT 1 FROM super_events WHERE reference_id=?").get(opts.referenceId);
      if (already) return superState(db, userId);   // idempotente: compra reenviada não duplica
    }
    // Paid renewals extend paid time only; trials remain independent grants.
    const paid=db.prepare("SELECT expires_at AS expiresAt FROM super_subscriptions WHERE user_id=? AND revoked_at IS NULL").get(userId) as {expiresAt:string}|undefined;
    const base=paid&&Date.parse(paid.expiresAt)>now?Date.parse(paid.expiresAt):now;
    const expiresAt = new Date(base + days * 86_400_000).toISOString();
    db.prepare(`INSERT INTO super_subscriptions (user_id,started_at,expires_at,auto_renew,source,revoked_at,updated_at)
      VALUES (?,?,?,?,?,NULL,?)
      ON CONFLICT(user_id) DO UPDATE SET expires_at=excluded.expires_at,auto_renew=excluded.auto_renew,
        source=excluded.source,revoked_at=NULL,updated_at=excluded.updated_at`)
      .run(userId, new Date(now).toISOString(), expiresAt, opts.autoRenew ? 1 : 0, opts.source, new Date(now).toISOString());
    db.prepare("INSERT INTO super_events (id,user_id,kind,days,reference_id,note,created_at) VALUES (?,?,?,?,?,?,?)")
      .run(randomUUID(), userId, "GRANT", days, opts.referenceId ?? null, JSON.stringify({source:opts.source,detail:opts.note}), new Date(now).toISOString());
    return superState(db, userId);
  })();
}

/** Revogação imediata pelo ROOT: todos os privilégios somem no mesmo instante. */
export function revokeSuper(db: AppDatabase, userId: string, actor: string): void {
  const now = new Date().toISOString();
  db.transaction(() => {
    db.prepare("UPDATE super_subscriptions SET revoked_at=?,auto_renew=0,updated_at=? WHERE user_id=? AND revoked_at IS NULL").run(now, now, userId);
    db.prepare("INSERT INTO super_events (id,user_id,kind,days,reference_id,created_at,note) VALUES (?,?,?,?,?,?,?)")
      .run(randomUUID(), userId, "REVOKE", 0, null, now, `Revogado por ${actor}`);
    db.prepare("UPDATE gamification_trials SET revoked_at=? WHERE user_id=? AND revoked_at IS NULL").run(now,userId);
    // Mensagens fixas do SUPER caem junto: o privilégio acabou.
    db.prepare("UPDATE super_pins SET removed_at=? WHERE user_id=? AND removed_at IS NULL").run(now, userId);
  })();
}

export function setAutoRenew(db: AppDatabase, userId: string, autoRenew: boolean): void {
  db.prepare("UPDATE super_subscriptions SET auto_renew=?,updated_at=? WHERE user_id=? AND revoked_at IS NULL")
    .run(autoRenew ? 1 : 0, new Date().toISOString(), userId);
}

// ---------- vitrine de mensagens fixas ----------

/** Fixações vivas: no máximo 3 no sistema inteiro, 1 h cada. */
export function activePins(db: AppDatabase) {
  const cutoff = new Date(Date.now() - SUPER_PIN_MINUTES * 60_000).toISOString();
  return db.prepare(`SELECT p.id,p.user_id AS userId,p.body,p.channel_url AS channelUrl,p.created_at AS createdAt
    FROM super_pins p WHERE p.removed_at IS NULL AND p.created_at > ? AND (EXISTS(SELECT 1 FROM owner_access a WHERE a.user_id=p.user_id AND a.active=1 AND a.role='ROOT_OWNER') OR EXISTS(SELECT 1 FROM super_subscriptions s WHERE s.user_id=p.user_id AND s.revoked_at IS NULL AND s.expires_at>?) OR EXISTS(SELECT 1 FROM gamification_trials t WHERE t.user_id=p.user_id AND t.revoked_at IS NULL AND t.starts_at<=? AND t.expires_at>?)) ORDER BY p.created_at ASC`).all(cutoff,new Date().toISOString(),new Date().toISOString(),new Date().toISOString()) as
    Array<{ id: string; userId: string; body: string; channelUrl?: string; createdAt: string }>;
}

export function pinSlotsFree(db: AppDatabase): number {
  return Math.max(0, SUPER_PINNED_SLOTS - activePins(db).length);
}

// A mensagem fixa é divulgação do próprio canal: pedido amigável de like,
// comentário e visualização. Nada de link externo nem apelo agressivo.
const PIN_MAX = 180;
const FORBIDDEN = /\b(?:compre|venda|promo[çc][aã]o|desconto|pix|whatsapp|telegram|grupo|dinheiro|gr[aá]tis)\b/i;

export function createPin(db: AppDatabase, userId: string, rawBody: string, channelUrl?: string,rootAccess=false) {
  const state = effectiveSuper(db, userId);
  if (!rootAccess && !state.canPin) throw err(403, "Fixar mensagens é um privilégio da assinatura SUPER.", { code: "SUPER_REQUIRED" });
  const body = String(rawBody ?? "").replace(/\s+/g, " ").trim();
  if (body.length < 10 || body.length > PIN_MAX) throw err(400, `A divulgação deve ter entre 10 e ${PIN_MAX} caracteres.`);
  if (FORBIDDEN.test(body)) throw err(400, "A mensagem fixa serve para divulgar seu canal — sem vendas, grupos ou links externos.", { code: "PIN_CONTENT" });
  if (/https?:\/\/|www\.|\.com|\.br/i.test(body)) throw err(400, "Não inclua links no texto; seu canal já é mostrado no selo.", { code: "PIN_LINK" });
  if (!rootAccess && !isRootOwner(db, userId)) {
    const mine = activePins(db).filter((p) => p.userId === userId);
    if (mine.length) throw err(409, "Você já tem uma divulgação no ar. Aguarde ela expirar.", { code: "PIN_ALREADY" });
  }
  if (pinSlotsFree(db) <= 0) throw err(409, "As três vagas de divulgação estão ocupadas. Tente novamente em instantes.", { code: "PIN_FULL" });
  const id = randomUUID(), now = new Date().toISOString();
  db.prepare("INSERT INTO super_pins (id,user_id,body,channel_url,created_at,removed_at) VALUES (?,?,?,?,?,NULL)")
    .run(id, userId, body, channelUrl ?? null, now);
  return { id, createdAt: now, expiresInSeconds: SUPER_PIN_MINUTES * 60 };
}

export function removePin(db: AppDatabase, pinId: string): boolean {
  return db.prepare("UPDATE super_pins SET removed_at=? WHERE id=? AND removed_at IS NULL").run(new Date().toISOString(), pinId).changes > 0;
}
