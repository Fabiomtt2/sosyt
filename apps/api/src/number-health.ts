// AUDITORIA / saúde do número Business: detecta quando o número deixa de ser
// funcional (ban, desconexão, token revogado, qualidade despencando) e recomenda
// a troca. O número é descartável por desenho, então trocar precisa ser rotina
// barata: o painel mostra o diagnóstico e o passo a passo, sem adivinhação.
import type { AppDatabase } from "./db.js";
import type { Config } from "./config.js";
import { readWhatsAppIntegration } from "./integrations.js";

export type NumberStatus = "HEALTHY" | "DEGRADED" | "UNUSABLE" | "UNKNOWN";

const KEY_LAST = "whatsapp.health.last";

type HealthRecord = {
  status: NumberStatus;
  checkedAt: string;
  phone?: string;
  phoneNumberId?: string;
  qualityRating?: string;        // GREEN | YELLOW | RED (Meta)
  platformStatus?: string;       // CONNECTED | FLAGGED | RESTRICTED | BANNED...
  detail: string;
  recommendation: string;
  shouldReplaceNumber: boolean;
};

function get(db: AppDatabase, key: string) {
  return (db.prepare("SELECT value FROM integration_settings WHERE key=?").get(key) as { value: string } | undefined)?.value;
}
function set(db: AppDatabase, key: string, value: string) {
  db.prepare(`INSERT INTO integration_settings (key,value,updated_at) VALUES (?,?,?)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at`)
    .run(key, value, new Date().toISOString());
}

/** Último diagnóstico salvo (o painel lê isso sem bater na Meta a cada render). */
export function lastNumberHealth(db: AppDatabase): HealthRecord | undefined {
  const raw = get(db, KEY_LAST);
  if (!raw) return undefined;
  try { return JSON.parse(raw) as HealthRecord; } catch { return undefined; }
}

/** Traduz o que a Meta respondeu em diagnóstico acionável. */
export function classify(input: { httpOk: boolean; httpStatus: number; errorCode?: number; errorMessage?: string; found: boolean; quality?: string; platform?: string }): Pick<HealthRecord, "status" | "detail" | "recommendation" | "shouldReplaceNumber"> {
  // Token inválido/expirado — não é ban do número, é credencial.
  if (!input.httpOk && (input.httpStatus === 401 || input.errorCode === 190)) {
    return { status: "UNUSABLE", detail: "A Meta recusou o token de acesso (expirado ou revogado).", recommendation: "Gere um novo System User Access Token permanente e cole no painel. O número provavelmente continua válido.", shouldReplaceNumber: false };
  }
  if (!input.httpOk && input.httpStatus === 403) {
    return { status: "UNUSABLE", detail: "Acesso negado pela Meta a esta conta/WABA.", recommendation: "Confira as permissões do System User (whatsapp_business_messaging e whatsapp_business_management).", shouldReplaceNumber: false };
  }
  if (!input.httpOk) {
    return { status: "UNKNOWN", detail: `A Meta respondeu com erro ${input.httpStatus}${input.errorMessage ? ": " + input.errorMessage : ""}.`, recommendation: "Tente novamente em alguns minutos. Se persistir, confira o WABA ID e o token.", shouldReplaceNumber: false };
  }
  // Token ok, mas o número sumiu do WABA: banido/removido.
  if (!input.found) {
    return { status: "UNUSABLE", detail: "O número não aparece mais neste WABA — sinal típico de número banido ou removido.", recommendation: "Troque o número Business: registre outro número descartável na Meta e atualize telefone + Phone Number ID aqui no painel.", shouldReplaceNumber: true };
  }
  const platform = (input.platform ?? "").toUpperCase();
  if (["BANNED", "RESTRICTED", "DISABLED", "DELETED"].some((s) => platform.includes(s))) {
    return { status: "UNUSABLE", detail: `A Meta reporta o número como ${platform}.`, recommendation: "Troque o número Business agora: este não voltará a enviar. Registre outro descartável e atualize o painel.", shouldReplaceNumber: true };
  }
  const quality = (input.quality ?? "").toUpperCase();
  if (quality === "RED") {
    return { status: "DEGRADED", detail: "Qualidade VERMELHA na Meta: entrega limitada e risco alto de bloqueio.", recommendation: "Reduza disparos imediatamente e prepare um número reserva. Se cair para banido, troque pelo painel.", shouldReplaceNumber: true };
  }
  if (quality === "YELLOW" || platform.includes("FLAGGED")) {
    return { status: "DEGRADED", detail: "Qualidade AMARELA/sinalizada na Meta: o número está sob observação.", recommendation: "Espace as mensagens e evite conteúdo repetitivo. Mantenha um número reserva pronto.", shouldReplaceNumber: false };
  }
  return { status: "HEALTHY", detail: "Número ativo e com boa reputação na Meta.", recommendation: "Nenhuma ação necessária.", shouldReplaceNumber: false };
}

/** Consulta a Meta e salva o diagnóstico. Nunca lança: o painel sempre tem resposta. */
export async function checkNumberHealth(db: AppDatabase, config: Config, deps: { accessToken?: string } = {}): Promise<HealthRecord> {
  const state = readWhatsAppIntegration(db, config);
  const checkedAt = new Date().toISOString();
  const accessToken = deps.accessToken;
  let record: HealthRecord;

  if (!accessToken || !state.businessAccountId) {
    record = { status: "UNKNOWN", checkedAt, phone: state.businessPhone, phoneNumberId: state.phoneNumberId,
      detail: "Integração oficial ainda não configurada (falta token e/ou WABA ID).",
      recommendation: "Conclua a configuração da Meta Cloud API no painel para habilitar o monitoramento.", shouldReplaceNumber: false };
    set(db, KEY_LAST, JSON.stringify(record));
    return record;
  }

  try {
    const url = `https://graph.facebook.com/${encodeURIComponent(state.graphVersion)}/${encodeURIComponent(state.businessAccountId)}/phone_numbers?fields=id,display_phone_number,verified_name,quality_rating,platform_type,status`;
    const response = await fetch(url, { headers: { authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(15_000) });
    const payload = await response.json().catch(() => ({})) as {
      data?: Array<{ id?: string; display_phone_number?: string; quality_rating?: string; status?: string; platform_type?: string }>;
      error?: { message?: string; code?: number };
    };
    const phones = payload.data ?? [];
    const selected = state.phoneNumberId ? phones.find((p) => p.id === state.phoneNumberId) : undefined;
    const verdict = classify({
      httpOk: response.ok, httpStatus: response.status,
      errorCode: payload.error?.code, errorMessage: payload.error?.message,
      found: Boolean(selected), quality: selected?.quality_rating, platform: selected?.status ?? selected?.platform_type
    });
    record = { ...verdict, checkedAt, phone: state.businessPhone, phoneNumberId: state.phoneNumberId,
      qualityRating: selected?.quality_rating, platformStatus: selected?.status ?? selected?.platform_type };
  } catch {
    record = { status: "UNKNOWN", checkedAt, phone: state.businessPhone, phoneNumberId: state.phoneNumberId,
      detail: "Não foi possível falar com a Meta agora (rede ou tempo esgotado).",
      recommendation: "Tente novamente em alguns minutos.", shouldReplaceNumber: false };
  }
  set(db, KEY_LAST, JSON.stringify(record));
  return record;
}

/** Passo a passo da troca, exibido no painel quando shouldReplaceNumber. */
export const REPLACEMENT_STEPS = [
  "Registre um novo número descartável na Meta (nunca um número pessoal ou importante).",
  "Copie o novo Phone Number ID na aba WhatsApp do app Meta.",
  "No painel, atualize o telefone Business e o Phone Number ID e salve.",
  "Rode 'Validar com a Meta' — a conferência exige que o número informado bata com o da Meta.",
  "Reative os envios. Os templates aprovados continuam no mesmo WABA."
] as const;
