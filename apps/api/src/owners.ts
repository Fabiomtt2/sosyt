import { createHash } from "node:crypto";
import type { Config } from "./config.js";
export const normalizeOwnerName = (value: string) => value.normalize("NFKD").replace(/\p{M}/gu, "").trim().toLowerCase();
export function ownerAccounts(config: Config) {
  return [
    { id: "fabio", name: config.OWNER_FABIO_NAME, identifier: config.OWNER_FABIO_ID, secret: config.OWNER_FABIO_SECRET, phone: config.OWNER_FABIO_WHATSAPP },
    { id: "rafael", name: config.OWNER_RAFAEL_NAME, identifier: config.OWNER_RAFAEL_ID, secret: config.OWNER_RAFAEL_SECRET, phone: config.OWNER_RAFAEL_WHATSAPP }
  ];
}
export const ownerCredentialVersion = (secret: string) => createHash("sha256").update(secret).digest("hex");
