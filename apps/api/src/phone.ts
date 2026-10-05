export function normalizePhone(value: string): string {
  const raw = value.trim();
  let digits = raw.replace(/\D/g, "");
  if (!raw.startsWith("+") && /^[1-9]\d9\d{8}$/.test(digits)) digits = `55${digits}`;
  return digits;
}

export function isInternationalPhone(value: string): boolean {
  return /^[1-9]\d{7,14}$/.test(normalizePhone(value));
}

// Mantidos para compatibilidade com dados/testes legados brasileiros.
export function normalizeBrazilMobile(value: string): string {
  return normalizePhone(value);
}

export function isBrazilMobile(value: string): boolean {
  return /^55[1-9]\d9\d{8}$/.test(normalizePhone(value));
}
