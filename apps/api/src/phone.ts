export function normalizeBrazilMobile(value: string): string {
  let digits = value.replace(/\D/g, "");
  if (/^[1-9]\d9\d{8}$/.test(digits)) digits = `55${digits}`;
  return digits;
}

export function isBrazilMobile(value: string): boolean {
  return /^55[1-9]\d9\d{8}$/.test(normalizeBrazilMobile(value));
}
