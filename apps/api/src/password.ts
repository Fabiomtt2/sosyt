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

/**
 * Credencial administrativa gerada pelo bot. `generateBotPassword` sozinha pode
 * sair só com letras, e `setCredential` exige letra **e** dígito; em vez de
 * grudar um dígito fixo no fim (que viraria sufixo previsível em toda senha),
 * trocamos uma posição aleatória por um dígito aleatório.
 */
export function generateAdminCredential(): string {
  const base = generateBotPassword().split("");
  const digits = "23456789";
  const [posByte, digitByte] = randomBytes(2);
  base[posByte % base.length] = digits[digitByte % digits.length];
  return base.join("");
}

/**
 * AUDITORIA C-01 / portão híbrido: credencial de setup emitida pelo Owner.
 * Desacopla o primeiro acesso de um canal WhatsApp automático — o Owner entrega
 * o código pelo próprio grupo (manual ou via link wa.me que ele mesmo envia).
 * Formato legível em três grupos de 4, sem caracteres ambíguos (0/O, 1/I/l).
 */
export function generateSetupCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(12);
  const raw = Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
  return `${raw.slice(0,4)}-${raw.slice(4,8)}-${raw.slice(8,12)}`;
}
export function normalizeSetupCode(input: string): string {
  return input.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export const passwordSchemaMin = 8;
export const passwordSchemaMax = 128;
