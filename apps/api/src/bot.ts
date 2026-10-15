// Configuração persistida dos modos e preferências do bot. O painel lê do banco
// a cada requisição, mas os fluxos de envio ainda não consomem estas flags.
// Portanto uma preferência salva não equivale a uma automação em operação.
import { z } from "zod";
import type { AppDatabase } from "./db.js";
import type { Config } from "./config.js";
import { persistedWhatsAppMode, readWhatsAppIntegration, readYouTubeIntegration, readPaymentIntegration } from "./integrations.js";

// Modo do MOTOR de WhatsApp do bot:
//  DISABLED  — bot não fala/recebe
//  OFFICIAL  — preferência pela Cloud API da Meta; não gerencia grupos reais
//  EVOLUTION — preferência pelo motor não oficial; há risco de bloqueio
//  HYBRID    — proposta de Meta para mensagens e complemento para grupos
export const botModeSchema = z.enum(["DISABLED", "OFFICIAL", "EVOLUTION", "HYBRID", "HYBRID_PLUS", "META_GROUPS"]);
export type BotMode = z.infer<typeof botModeSchema>;

// Cada função do bot. `engine` = que motor a função exige.
//  'messaging' roda em OFFICIAL ou EVOLUTION ou HYBRID;
//  'group'     exige EVOLUTION ou HYBRID (Meta oficial não gerencia grupos reais).
export const BOT_FEATURES = [
  { code: "LOGIN_CODE",     label: "Enviar código de acesso (OTP) por WhatsApp",        engine: "messaging", defaultOn: true },
  { code: "OWNER_ALERTS",   label: "Avisar Owners sobre novas solicitações",            engine: "messaging", defaultOn: true },
  { code: "DECISION_NOTICE",label: "Avisar participante sobre aprovação/recusa",        engine: "messaging", defaultOn: true },
  { code: "QUEUE_ANNOUNCE", label: "Anunciar filas: nova fila, vagas, conclusão",       engine: "messaging", defaultOn: true },
  { code: "SUPPORT_CHAT",   label: "Conversa interativa de suporte automático",         engine: "messaging", defaultOn: true },
  { code: "HUMAN_HANDOFF",  label: "Transbordo para atendimento humano (Business)",     engine: "messaging", defaultOn: true },
  { code: "BROADCAST",      label: "Disparos/avisos em massa autorizados pelo Owner",   engine: "messaging", defaultOn: false },
  { code: "GROUP_SYNC",     label: "Gerir grupos: ler membros, adicionar, remover",     engine: "group",     defaultOn: false }
] as const;
export type BotFeatureCode = (typeof BOT_FEATURES)[number]["code"];

const MODE_KEY = "bot.mode";
const featKey = (code: string) => `bot.feature.${code}`;

function get(db: AppDatabase, key: string) {
  return (db.prepare("SELECT value FROM integration_settings WHERE key=?").get(key) as { value: string } | undefined)?.value;
}
function set(db: AppDatabase, key: string, value: string) {
  db.prepare(`INSERT INTO integration_settings (key,value,updated_at) VALUES (?,?,?)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at`)
    .run(key, value, new Date().toISOString());
}

export function botMode(db: AppDatabase): BotMode {
  return persistedWhatsAppMode(db) ?? "DISABLED";
}
export function featureEnabled(db: AppDatabase, code: BotFeatureCode): boolean {
  const stored = get(db, featKey(code));
  if (stored === "1") return true;
  if (stored === "0") return false;
  return BOT_FEATURES.find((f) => f.code === code)?.defaultOn ?? false;
}

/** Um motor de mensageria está pronto? (oficial OU evolution, conforme o modo) */
function messagingReady(mode: BotMode, wa: ReturnType<typeof readWhatsAppIntegration>): boolean {
  if (mode === "OFFICIAL" || mode === "HYBRID_PLUS" || mode === "META_GROUPS") return wa.officialReady;
  if (mode === "EVOLUTION") return Boolean(wa.evolutionUrl && wa.evolutionInstance && wa.evolutionApiKeyConfigured);
  return false;
}
function groupReady(mode: BotMode, wa: ReturnType<typeof readWhatsAppIntegration>): boolean {
  if (mode === "EVOLUTION" || mode === "HYBRID_PLUS") return Boolean(wa.evolutionUrl && wa.evolutionInstance && wa.evolutionApiKeyConfigured);
  return false;
}

/**
 * Relatório de prontidão: para o modo atual, quais funções conseguem rodar e,
 * quando não, o que falta configurar. É o que o dashboard mostra ao Owner e a
 * resposta para "o que preciso fazer para ativar o bot".
 */
export function botStatus(db: AppDatabase, config: Config) {
  const mode = botMode(db);
  const wa = readWhatsAppIntegration(db, config);
  const yt = readYouTubeIntegration(db, config);
  const pay = readPaymentIntegration(db, config);
  const msgOk = messagingReady(mode, wa);
  const grpOk = groupReady(mode, wa);

  const missing: string[] = [];
  if (mode === "DISABLED") missing.push("Escolha um modo do bot (OFFICIAL, EVOLUTION ou HYBRID).");
  if ((mode === "OFFICIAL" || mode === "HYBRID_PLUS" || mode === "META_GROUPS") && !wa.officialReady) missing.push("Configure a Meta Cloud API: Phone Number ID, WABA ID, Access Token, App Secret e Verify Token.");
  if ((mode === "EVOLUTION" || mode === "HYBRID_PLUS") && !grpOk) missing.push("Configure o motor Evolution: URL, instância e API key (gestão de grupos).");
  if (mode !== "DISABLED") missing.push("As funções desta aba ainda não foram conectadas aos fluxos de envio. A configuração salva não ativa o bot.");

  const features = BOT_FEATURES.map((f) => {
    const enabled = featureEnabled(db, f.code);
    const engineOk = f.engine === "group" ? grpOk : msgOk;
    // Estas flags ainda não são consumidas pelos fluxos de envio. Credenciais
    // prontas não demonstram que cada função está implementada ou em execução.
    const wiredToRuntime = false;
    return {
      code: f.code, label: f.label, engine: f.engine, enabled,
      active: enabled && engineOk && wiredToRuntime,
      blockedReason: enabled && (!engineOk || !wiredToRuntime)
        ? (!engineOk
          ? (f.engine === "group" ? "Requer motor Evolution configurado." : "Requer um motor de mensagens pronto (Meta oficial ou Evolution).")
          : "Configuração salva; esta função ainda não está conectada ao fluxo do aplicativo.")
        : null,
      riskNote: f.engine === "group" ? "Função não-oficial: risco de bloqueio do número pela Meta." : null
    };
  });

  return {
    mode,
    engines: {
      messaging: { ready: msgOk, official: wa.officialReady, evolution: Boolean(wa.evolutionUrl && wa.evolutionInstance && wa.evolutionApiKeyConfigured) },
      group: { ready: grpOk }
    },
    dependencies: {
      whatsappOfficialReady: wa.officialReady,
      youtubeReady: yt.ready,
      paymentReady: pay.ready,
      webhookUrl: wa.webhookUrl
    },
    features,
    missing,
    // 'fullyActive' = modo escolhido, sem pendências do modo, e ao menos uma função ativa.
    fullyActive: mode !== "DISABLED" && missing.length === 0 && features.some((f) => f.active)
  };
}

const saveSchema = z.object({
  mode: botModeSchema.optional(),
  features: z.record(z.string(), z.boolean()).optional()
});
export function saveBotSettings(db: AppDatabase, raw: unknown) {
  const body = saveSchema.parse(raw);
  if (body.mode) db.transaction(()=>{
    const mode=body.mode==="HYBRID" ? "HYBRID_PLUS" : body.mode!;
    set(db,MODE_KEY,mode);
    set(db,"whatsapp.mode",mode);
  })();
  if (body.features) {
    for (const [code, on] of Object.entries(body.features)) {
      if (BOT_FEATURES.some((f) => f.code === code)) set(db, featKey(code), on ? "1" : "0");
    }
  }
}
