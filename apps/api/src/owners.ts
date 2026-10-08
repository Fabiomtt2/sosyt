import { createHash } from "node:crypto";
import type { Config } from "./config.js";

export type OwnerRole = "ROOT_OWNER" | "ADMIN_OWNER";
export const normalizeOwnerName = (value: string) => value.normalize("NFKD").replace(/\p{M}/gu, "").trim().toLowerCase();
export const eligibleAdminName = (value:string) => ["fabio","rafael"].includes(normalizeOwnerName(value));
export const eligibleRootOwnerName = eligibleAdminName;

export function ownerNameMatches(configuredName: string, candidate: string) {
  const configured = normalizeOwnerName(configuredName);
  const provided = normalizeOwnerName(candidate);
  return provided === configured || (configured.endsWith("0") && provided === configured.slice(0, -1));
}

export function ownerAccounts(config: Config) {
  return [
    { id:"fabio",name:config.OWNER_FABIO_NAME,identifier:config.OWNER_FABIO_ID,secret:config.OWNER_FABIO_SECRET,phone:config.OWNER_FABIO_WHATSAPP,role:"ROOT_OWNER" as OwnerRole },
    { id:"rafael",name:config.OWNER_RAFAEL_NAME,identifier:config.OWNER_RAFAEL_ID,secret:config.OWNER_RAFAEL_SECRET,phone:config.OWNER_RAFAEL_WHATSAPP,role:"ROOT_OWNER" as OwnerRole }
  ];
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
  const account=ownerAccounts(config).find((item)=>item.id===session.ownerId);
  if (account) return Boolean(account.secret && account.phone===user.phone && account.role===session.adminRole && session.jti===ownerCredentialVersion(account.secret));
  const access=db.prepare("SELECT id,user_id AS userId,phone,role,updated_at AS updatedAt FROM owner_access WHERE id=? AND active=1").get(session.ownerId) as {id:string;userId:string;phone:string;role:OwnerRole;updatedAt:string}|undefined;
  return Boolean(access && access.userId===session.sub && access.phone===user.phone && access.role===session.adminRole && session.jti===dynamicOwnerVersion(access.id,access.userId,access.role,access.updatedAt));
}
