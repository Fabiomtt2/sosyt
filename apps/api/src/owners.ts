import { createHash } from "node:crypto";
import type { Config } from "./config.js";

export type OwnerRole = "ROOT_OWNER" | "ADMIN_OWNER";
export const normalizeOwnerName = (value: string) => value.normalize("NFKD").replace(/\p{M}/gu, "").trim().toLowerCase();
export const eligibleAdminName = (value:string) => ["fabio","rafael"].includes(normalizeOwnerName(value));
export const eligibleRootOwnerName = eligibleAdminName;

export function ownerNameMatches(configuredName: string, candidate: string) {
  const configured = normalizeOwnerName(configuredName);
  const provided = normalizeOwnerName(candidate);
  return provided === configured || (configured.endsWith("0") && provided === configured.slice(0, -1)) || (provided.endsWith("0") && configured === provided.slice(0, -1));
}

/**
 * AUDITORIA: a identidade do Owner e NOME + TELEFONE (mais o id interno fixo).
 * O antigo `identifier` (OWNER_*_ID) era codigo morto — nunca era lido em lugar
 * algum — e foi removido para nao sugerir uma terceira chave de identidade.
 * O nome e comparado sem acento e sem caixa (ver normalizeOwnerName), entao
 * "Fábio", "Fabio" e "FaBiO" sao a mesma pessoa.
 */
export function ownerAccounts(config: Config) {
  return [
    { id:"fabio",name:config.OWNER_FABIO_NAME,secret:config.OWNER_FABIO_SECRET,phone:config.OWNER_FABIO_WHATSAPP,role:"ROOT_OWNER" as OwnerRole },
    { id:"rafael",name:config.OWNER_RAFAEL_NAME,secret:config.OWNER_RAFAEL_SECRET,phone:config.OWNER_RAFAEL_WHATSAPP,role:"ROOT_OWNER" as OwnerRole }
  ];
}

/** Chave do telefone do Owner quando trocado pelo painel. */
export const ownerPhoneKey = (ownerId: string) => `owner.${ownerId}.phone`;

/**
 * Contas do Owner com o telefone EFETIVO: se o ROOT trocou o numero no painel,
 * o valor salvo prevalece sobre o ambiente. Permite trocar de chip sem redeploy.
 */
export function effectiveOwnerAccounts(db: import("./db.js").AppDatabase, config: Config) {
  return ownerAccounts(config).map((account) => {
    const row = db.prepare("SELECT value FROM integration_settings WHERE key=?").get(ownerPhoneKey(account.id)) as { value: string } | undefined;
    return row?.value ? { ...account, phone: row.value } : account;
  });
}
export const ownerCredentialVersion = (secret: string) => createHash("sha256").update(secret).digest("hex");
export const dynamicOwnerVersion = (id:string,userId:string,role:OwnerRole,updatedAt:string) =>
  createHash("sha256").update([id,userId,role,updatedAt].join(":")).digest("hex");


// An administrative participant session remains privileged only while its
// issuing account and credential version are still valid on the server.
export function administrativeSessionValid(db: import("./db.js").AppDatabase, config: Config,
  session: {sub:string;adminRole?:OwnerRole;ownerId?:string;jti?:string}): boolean {
  if (!session.adminRole || !session.ownerId || !session.jti) return false;
  const user=db.prepare("SELECT phone FROM users WHERE id=? AND deleted_at IS NULL").get(session.sub) as {phone:string}|undefined;
  if (!user) return false;
  const account=effectiveOwnerAccounts(db,config).find((item)=>item.id===session.ownerId);
  if (account) return Boolean(account.secret && account.phone===user.phone && account.role===session.adminRole && session.jti===ownerCredentialVersion(account.secret));
  const access=db.prepare("SELECT id,user_id AS userId,phone,role,updated_at AS updatedAt FROM owner_access WHERE id=? AND active=1").get(session.ownerId) as {id:string;userId:string;phone:string;role:OwnerRole;updatedAt:string}|undefined;
  return Boolean(access && access.userId===session.sub && access.phone===user.phone && access.role===session.adminRole && session.jti===dynamicOwnerVersion(access.id,access.userId,access.role,access.updatedAt));
}
