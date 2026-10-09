// AUDITORIA C-01: credencial de senha persistente, complementar ao OTP.
// Hash scrypt com sal por usuario e comparacao timing-safe. Formato autodescritivo
// para permitir evoluir parametros sem migracao: scrypt$N$r$p$salt$hash (base64url).
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const N = 16384, r = 8, p = 1, KEYLEN = 32;

export function hashPassword(plain: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(plain.normalize("NFKC"), salt, KEYLEN, { N, r, p, maxmem: 64 * 1024 * 1024 });
  return ["scrypt", N, r, p, salt.toString("base64url"), hash.toString("base64url")].join("$");
}

export function verifyPassword(plain: string, stored?: string | null): boolean {
  if (!stored) return false;
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, nStr, rStr, pStr, saltB64, hashB64] = parts;
  try {
    const salt = Buffer.from(saltB64, "base64url");
    const expected = Buffer.from(hashB64, "base64url");
    const actual = scryptSync(plain.normalize("NFKC"), salt, expected.length,
      { N: Number(nStr), r: Number(rStr), p: Number(pStr), maxmem: 64 * 1024 * 1024 });
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch { return false; }
}

/** Senha aleatoria forte, legivel, para o fluxo "bot gera a senha". Sem caracteres ambiguos. */
export function generateBotPassword(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const bytes = randomBytes(14);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

export const passwordSchemaMin = 8;
export const passwordSchemaMax = 128;
