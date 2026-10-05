export const INTERNATIONAL_PHONE_PATTERN = String.raw`\+?[1-9][0-9 ()-]{7,20}`;

export function formatInternationalPhoneInput(value: string): string {
  const cleaned = value.replace(/[^0-9+ ()-]/g, "").replace(/(?!^)\+/g, "");
  return cleaned.slice(0, 24);
}

export function isCompleteInternationalPhone(value: string): boolean {
  return /^[1-9]\d{7,14}$/.test(value.replace(/\D/g, ""));
}

// Legado: alguns pontos antigos ainda podem importar estes nomes.
export const BRAZIL_MOBILE_PATTERN = String.raw`\+55 [1-9][0-9] \[9\] ?[0-9]{4}-[0-9]{4}`;
export function formatBrazilMobileInput(value: string): string {
  let digits = value.replace(/\D/g, "");
  if (digits.startsWith("55")) digits = digits.slice(2);
  digits = digits.slice(0, 11);
  const ddd = digits.slice(0, 2);
  const prefix = digits.slice(2, 3);
  const first = digits.slice(3, 7);
  const last = digits.slice(7, 11);
  let result = "+55";
  if (ddd) result += ` ${ddd}`;
  if (prefix) result += ` [${prefix}]`;
  if (first) result += first;
  if (last) result += `-${last}`;
  return result;
}

export function isCompleteBrazilMobile(value: string): boolean {
  return /^55[1-9]\d9\d{8}$/.test(value.replace(/\D/g, ""));
}
