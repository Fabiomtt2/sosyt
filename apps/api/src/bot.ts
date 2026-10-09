// AUDITORIA / cérebro do bot: modos (isolado/híbrido) + flags por função, tudo
// configurável no painel e aplicado em tempo real (lê sempre do banco). Não há
// estado em memória: salvar no dashboard = efeito imediato na próxima requisição.
import { z } from "zod";
import type { AppDatabase } from "./db.js";
import type { Config } from "./config.js";
import { readWhatsAppIntegration, readYouTubeIntegration, readPaymentIntegration } from "./integrations.js";

// Modo do MOTOR de WhatsApp do bot:
//  DISABLED  — bot não fala/recebe
//  OFFICIAL  — só Cloud API da Meta (mensagens 1:1, seguro, sem gestão de grupo real)
//  EVOLUTION — só motor não-oficial (grupos + mensagens; risco de ban)
//  HYBRID    — oficial para mensagens/conversa + não-oficial para grupos (cobre TUDO)
export const botModeSchema = z.enum(["DISABLED", "OFFICIAL", "EVOLUTION", "HYBRID"]);
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
  return botModeSchema.catch("DISABLED").parse(get(db, MODE_KEY) ?? "DISABLED");
}
export function featureEnabled(db: AppDatabase, code: BotFeatureCode): boolean {
  const stored = get(db, featKey(code));
  if (stored === "1") return true;
  if (stored === "0") return false;
  return BOT_FEATURES.find((f) => f.code === code)?.defaultOn ?? false;
}

/** Um motor de mensageria está pronto? (oficial OU evolution, conforme o modo) */
function messagingReady(mode: BotMode, wa: ReturnType<typeof readWhatsAppIntegration>): boolean {
  if (mode === "OFFICIAL" || mode === "HYBRID") return wa.officialReady;
  if (mode === "EVOLUTION") return Boolean(wa.evolutionUrl && wa.evolutionInstance && wa.evolutionApiKeyConfigured);
  return false;
}
function groupReady(mode: BotMode, wa: ReturnType<typeof readWhatsAppIntegration>): boolean {
  if (mode === "EVOLUTION" || mode === "HYBRID") return Boolean(wa.evolutionUrl && wa.evolutionInstance && wa.evolutionApiKeyConfigured);
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
  if ((mode === "OFFICIAL" || mode === "HYBRID") && !wa.officialReady) missing.push("Configure a Meta Cloud API: Phone Number ID, WABA ID, Access Token, App Secret e Verify Token.");
  if ((mode === "EVOLUTION" || mode === "HYBRID") && !grpOk) missing.push("Configure o motor Evolution: URL, instância e API key (gestão de grupos).");

  const features = BOT_FEATURES.map((f) => {
    const enabled = featureEnabled(db, f.code);
    const engineOk = f.engine === "group" ? grpOk : msgOk;
    return {
      code: f.code, label: f.label, engine: f.engine, enabled,
      // 'active' = ligado pelo Owner E com motor pronto; senão 'blocked' com motivo.
      active: enabled && engineOk,
      blockedReason: enabled && !engineOk
        ? (f.engine === "group" ? "Requer motor Evolution configurado." : "Requer um motor de mensagens pronto (Meta oficial ou Evolution).")
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
  if (body.mode) set(db, MODE_KEY, body.mode);
  if (body.features) {
    for (const [code, on] of Object.entries(body.features)) {
      if (BOT_FEATURES.some((f) => f.code === code)) set(db, featKey(code), on ? "1" : "0");
    }
  }
}
