// AUDITORIA / credencial administrativa gerenciada no painel.
//
// Problema que isto resolve, de uma vez:
//  1. O segredo do ROOT vive no ambiente e precisa ter 32+ caracteres em produção
//     (config.ts). Uma senha memorizável nunca caberia ali — mas cabe AQUI, porque
//     guardamos o HASH (scrypt + sal) e protegemos com tentativas/bloqueio.
//  2. O ADMIN_OWNER não tinha credencial alguma: elevava só com posse do telefone.
//     Agora ele tem um segundo fator real, definido pelo ROOT.
//
// O segredo do ambiente continua valendo como credencial de emergência do ROOT
// (break-glass): se a senha do painel se perder, o ROOT ainda entra.
import type { AppDatabase } from "./db.js";
import { hashPassword, verifyPassword } from "./password.js";

const MAX_ATTEMPTS = 5;
const LOCK_MINUTES = 15;

function err(statusCode: number, message: string, extra: Record<string, unknown> = {}) {
  return Object.assign(new Error(message), { statusCode, ...extra });
}

export type CredentialState = { configured: boolean; mustChange: boolean; lockedUntil?: string; updatedAt?: string };

export function credentialState(db: AppDatabase, ownerId: string): CredentialState {
  const row = db.prepare(`SELECT password_hash AS hash, must_change AS mustChange, locked_until AS lockedUntil, updated_at AS updatedAt
    FROM admin_credentials WHERE owner_id=?`).get(ownerId) as
    | { hash: string; mustChange: number; lockedUntil?: string; updatedAt: string } | undefined;
  return { configured: Boolean(row), mustChange: Boolean(row?.mustChange), lockedUntil: row?.lockedUntil, updatedAt: row?.updatedAt };
}

/** Define/troca a credencial. `mustChange` marca senha provisória criada pelo ROOT. */
export function setCredential(db: AppDatabase, ownerId: string, plain: string, opts: { mustChange?: boolean } = {}): void {
  const password = String(plain);
  if (password.length < 10 || password.length > 128) throw err(400, "A credencial deve ter entre 10 e 128 caracteres.");
  if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) throw err(400, "A credencial precisa de letras e números.");
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO admin_credentials (owner_id,password_hash,must_change,attempts,locked_until,updated_at)
    VALUES (?,?,?,0,NULL,?)
    ON CONFLICT(owner_id) DO UPDATE SET password_hash=excluded.password_hash,must_change=excluded.must_change,
      attempts=0,locked_until=NULL,updated_at=excluded.updated_at`)
    .run(ownerId, hashPassword(password), opts.mustChange ? 1 : 0, now);
}

export function clearCredential(db: AppDatabase, ownerId: string): void {
  db.prepare("DELETE FROM admin_credentials WHERE owner_id=?").run(ownerId);
}

/**
 * Confere a credencial do painel. Resposta uniforme e bloqueio progressivo:
 * 5 erros travam por 15 minutos, para que a senha curta não vire alvo de força bruta.
 */
export function verifyCredential(db: AppDatabase, ownerId: string, plain: string): boolean {
  const row = db.prepare(`SELECT password_hash AS hash, attempts, locked_until AS lockedUntil FROM admin_credentials WHERE owner_id=?`)
    .get(ownerId) as { hash: string; attempts: number; lockedUntil?: string } | undefined;
  if (!row) return false;
  if (row.lockedUntil && Date.parse(row.lockedUntil) > Date.now()) {
    throw err(429, "Credencial bloqueada por tentativas. Aguarde alguns minutos.", { code: "CREDENTIAL_LOCKED", until: row.lockedUntil });
  }
  if (!verifyPassword(String(plain), row.hash)) {
    const attempts = row.attempts + 1;
    const lockedUntil = attempts >= MAX_ATTEMPTS ? new Date(Date.now() + LOCK_MINUTES * 60_000).toISOString() : null;
    db.prepare("UPDATE admin_credentials SET attempts=?, locked_until=? WHERE owner_id=?").run(lockedUntil ? 0 : attempts, lockedUntil, ownerId);
    return false;
  }
  db.prepare("UPDATE admin_credentials SET attempts=0, locked_until=NULL WHERE owner_id=?").run(ownerId);
  return true;
}
