// AUDITORIA / recuperação de senha com consentimento do titular.
//
// POR QUE ESTE MÓDULO EXISTE
//
// O dono pediu "ver as senhas e poder mudá-las". Mudar, sim. VER é impossível — e
// de propósito: o sistema guarda apenas um hash irreversível (`user_passwords
// .password_hash`). Ninguém, nem o Owner, nem o banco, recupera a senha original.
// Se fosse possível, um vazamento do painel entregaria as contas de toda a
// comunidade de uma vez.
//
// O red team mostrou o preço de ignorar isso: o antigo "código de ativação"
// SOBRESCREVIA a senha de conta ativa e era devolvido em texto claro AO OWNER, o que
// dava tomada de conta com um clique (carteira, SUPER, itens, correio privado).
//
// O desenho correto, que entrega o que o dono realmente quer (automatizado e
// gerenciável pelo painel) sem reabrir o buraco:
//
//   1. O Owner SOLICITA a troca. Não escolhe a senha, não vê o código.
//   2. O código vai pelo bot DIRETO para o WhatsApp DO TITULAR (transacional, nunca
//      silenciado por horário ou orçamento).
//   3. O titular confirma e define a própria senha nova.
//   4. Tudo fica registrado em trilha append-only: quem pediu, quando, se foi usado.
//      Uma troca de senha nunca acontece em silêncio.
//
// O Owner enxerga o ESTADO (pendente/usado/expirado), nunca o segredo.
import { createHash, randomInt, randomUUID, timingSafeEqual } from "node:crypto";
import type { AppDatabase } from "./db.js";

export const RESET_CODE_TTL_MINUTES = 15;
export const RESET_MAX_ATTEMPTS = 5;

export class PasswordResetError extends Error {
  constructor(public readonly code: string, message: string, public readonly statusCode = 400) {
    super(message);
    this.name = "PasswordResetError";
  }
}

const hashCode = (code: string) => createHash("sha256").update("sosyt-reset:" + code).digest("hex");

function safeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
}

export function ensurePasswordResets(db: AppDatabase) {
  db.exec(`CREATE TABLE IF NOT EXISTS password_resets (
    id TEXT PRIMARY KEY,
    phone TEXT NOT NULL,
    code_hash TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    requested_by_owner_id TEXT,
    requested_by_owner_name TEXT,
    requested_by TEXT NOT NULL,
    delivered INTEGER NOT NULL DEFAULT 0,
    used_at TEXT,
    created_at TEXT NOT NULL
  );`);
  db.exec("CREATE INDEX IF NOT EXISTS idx_password_resets_phone ON password_resets(phone,created_at);");
  // Trilha append-only: toda solicitação e todo uso ficam registrados.
  db.exec(`CREATE TABLE IF NOT EXISTS password_reset_audit (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    phone TEXT NOT NULL,
    event TEXT NOT NULL,
    actor_owner_id TEXT,
    actor_owner_name TEXT,
    detail TEXT,
    created_at TEXT NOT NULL
  );`);
  db.exec(`CREATE TRIGGER IF NOT EXISTS password_reset_audit_no_update BEFORE UPDATE ON password_reset_audit
    BEGIN SELECT RAISE(ABORT,'append-only: password_reset_audit nao pode ser alterado'); END;`);
  db.exec(`CREATE TRIGGER IF NOT EXISTS password_reset_audit_no_delete BEFORE DELETE ON password_reset_audit
    BEGIN SELECT RAISE(ABORT,'append-only: password_reset_audit nao pode ser apagado'); END;`);
}

function audit(db: AppDatabase, phone: string, event: string, actor?: { id?: string; name?: string }, detail?: string) {
  db.prepare(`INSERT INTO password_reset_audit (phone,event,actor_owner_id,actor_owner_name,detail,created_at)
    VALUES (?,?,?,?,?,?)`).run(phone, event, actor?.id ?? null, actor?.name ?? null, detail ?? null, new Date().toISOString());
}

export type ResetRequest = {
  /** O código NUNCA é devolvido ao solicitante: vai só para o WhatsApp do titular. */
  code: string;
  expiresAt: string;
  id: string;
};

/**
 * Cria uma solicitação de troca. Devolve o código APENAS para quem vai entregá-lo
 * ao titular (o bot) — a rota do painel não repassa esse valor ao Owner.
 * Invalida solicitações anteriores do mesmo telefone.
 */
export function createPasswordReset(
  db: AppDatabase, phone: string,
  requestedBy: "OWNER" | "SELF",
  actor?: { id?: string; name?: string },
): ResetRequest {
  ensurePasswordResets(db);
  const now = new Date();
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const id = randomUUID();
  const expiresAt = new Date(now.getTime() + RESET_CODE_TTL_MINUTES * 60_000).toISOString();
  db.transaction(() => {
    // uma solicitação viva por telefone: pedir de novo invalida a anterior
    db.prepare("UPDATE password_resets SET used_at=? WHERE phone=? AND used_at IS NULL")
      .run(now.toISOString(), phone);
    db.prepare(`INSERT INTO password_resets
      (id,phone,code_hash,expires_at,attempts,requested_by_owner_id,requested_by_owner_name,requested_by,delivered,used_at,created_at)
      VALUES (?,?,?,?,0,?,?,?,0,NULL,?)`)
      .run(id, phone, hashCode(code), expiresAt, actor?.id ?? null, actor?.name ?? null, requestedBy, now.toISOString());
    audit(db, phone, requestedBy === "OWNER" ? "REQUESTED_BY_OWNER" : "REQUESTED_BY_SELF", actor);
  })();
  return { code, expiresAt, id };
}

/** Marca que o bot conseguiu entregar o código ao titular. */
export function markResetDelivered(db: AppDatabase, id: string, delivered: boolean, reason?: string) {
  db.prepare("UPDATE password_resets SET delivered=? WHERE id=?").run(delivered ? 1 : 0, id);
  const row = db.prepare("SELECT phone FROM password_resets WHERE id=?").get(id) as { phone: string } | undefined;
  if (row) audit(db, row.phone, delivered ? "CODE_DELIVERED" : "DELIVERY_FAILED", undefined, reason);
}

/**
 * Confere o código apresentado pelo TITULAR. Consome a solicitação em caso de
 * sucesso. Conta tentativas para não virar força bruta de 6 dígitos.
 */
export function verifyPasswordReset(db: AppDatabase, phone: string, code: string): { ok: true } {
  ensurePasswordResets(db);
  const row = db.prepare(
    "SELECT id,code_hash AS codeHash,expires_at AS expiresAt,attempts FROM password_resets WHERE phone=? AND used_at IS NULL ORDER BY created_at DESC LIMIT 1",
  ).get(phone) as { id: string; codeHash: string; expiresAt: string; attempts: number } | undefined;

  if (!row) throw new PasswordResetError("NO_RESET_REQUEST", "Não há pedido de troca de senha para este número.", 404);
  if (Date.parse(row.expiresAt) <= Date.now()) {
    audit(db, phone, "EXPIRED");
    throw new PasswordResetError("RESET_EXPIRED", "Este código expirou. Peça um novo.", 410);
  }
  if (row.attempts >= RESET_MAX_ATTEMPTS) {
    audit(db, phone, "LOCKED");
    throw new PasswordResetError("TOO_MANY_ATTEMPTS", "Muitas tentativas. Peça um novo código.", 429);
  }
  if (!/^\d{6}$/.test(code) || !safeEqualHex(hashCode(code), row.codeHash)) {
    db.prepare("UPDATE password_resets SET attempts=attempts+1 WHERE id=?").run(row.id);
    audit(db, phone, "WRONG_CODE");
    throw new PasswordResetError("INVALID_CODE", "Código incorreto.", 401);
  }
  db.prepare("UPDATE password_resets SET used_at=? WHERE id=?").run(new Date().toISOString(), row.id);
  audit(db, phone, "COMPLETED");
  return { ok: true };
}

/** Estado que o painel pode mostrar — nunca o segredo. */
export function passwordResetStatus(db: AppDatabase, phone: string) {
  ensurePasswordResets(db);
  const row = db.prepare(
    `SELECT expires_at AS expiresAt, used_at AS usedAt, delivered, attempts,
     requested_by AS requestedBy, requested_by_owner_name AS requestedByName, created_at AS createdAt
     FROM password_resets WHERE phone=? ORDER BY created_at DESC LIMIT 1`,
  ).get(phone) as {
    expiresAt: string; usedAt: string | null; delivered: number; attempts: number;
    requestedBy: string; requestedByName: string | null; createdAt: string;
  } | undefined;
  if (!row) return { state: "NONE" as const };
  const expired = Date.parse(row.expiresAt) <= Date.now();
  return {
    state: row.usedAt ? ("USED" as const) : expired ? ("EXPIRED" as const) : ("PENDING" as const),
    delivered: Boolean(row.delivered),
    attempts: row.attempts,
    requestedBy: row.requestedBy,
    requestedByName: row.requestedByName ?? undefined,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
  };
}

/** Histórico (append-only) de solicitações e usos para um telefone. */
export function passwordResetHistory(db: AppDatabase, phone: string, limit = 20) {
  ensurePasswordResets(db);
  return db.prepare(
    `SELECT event, actor_owner_name AS actorName, detail, created_at AS createdAt
     FROM password_reset_audit WHERE phone=? ORDER BY id DESC LIMIT ?`,
  ).all(phone, limit) as Array<{ event: string; actorName: string | null; detail: string | null; createdAt: string }>;
}

/** Mensagem que o titular recebe — explica o que aconteceu e tranquiliza sobre golpe. */
export function resetMessage(code: string, byOwner: boolean, appUrl: string): string {
  const intro = byOwner
    ? "A equipe do SOS YOUTUBER iniciou uma troca de senha para a sua conta."
    : "Você pediu para trocar a senha da sua conta no SOS YOUTUBER.";
  return `${intro}\n\nSeu código de confirmação é: ${code}\n` +
    `Ele vale por ${RESET_CODE_TTL_MINUTES} minutos e serve só para você escolher uma senha nova em ${appUrl}.\n\n` +
    "🔒 Nunca vamos pedir esse código de volta, nem sua senha, nem pagamento por aqui. " +
    "Se alguém pedir, é golpe — pode ignorar.\n" +
    "Se não foi você nem combinou isso com a equipe, responda HUMANO que a gente verifica na hora. 💛";
}
