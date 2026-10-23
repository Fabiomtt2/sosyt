// IA DE VERDADE NO BOT — COM REDEA CURTA.
//
// Pedido do dono, textual: integrar IA "com cuidado", de modo que ela nao invente
// fatos. Este modulo e a resposta — e o desenho importa mais que o modelo:
//
//   O MODELO INTERPRETA. ELE NUNCA ESCREVE PARA A PESSOA.
//
// A unica coisa que pedimos ao modelo e: "classifique esta frase em UM destes
// rotulos, ou responda NENHUMA". Ele devolve um rotulo. O texto que chega no
// WhatsApp continua saindo dos NOSSOS textos revisados. Consequencia pratica: a IA
// nao tem como inventar preco, prazo, regra de fila ou promessa — ela so escolhe
// uma porta que ja existe.
//
// Por que um cliente compativel com OpenAI em vez de um SDK especifico: o dono quer
// comecar DE GRACA. Groq, OpenRouter e o Gemini expoem endpoints no formato
// /chat/completions, e provedores pagos tambem. Trocar de provedor passa a ser
// mudar URL/modelo/chave no painel, sem recodar nada.
//
// Degradacao: qualquer falha (sem chave, timeout, cota, resposta estranha) devolve
// undefined e o bot se comporta exatamente como antes da IA existir. A IA e um
// ganho opcional, nunca um ponto de ruptura.
//
// Privacidade: enviamos APENAS o texto da mensagem. Nunca telefone, nome, id,
// saldo ou historico. O provedor nao recebe quem falou.
import type { AppDatabase } from "./db.js";

/** Rotulos que a IA pode escolher. Sao portas que o bot JA sabe atender. */
export const AI_LABELS = [
  "GROUP_ACCESS", "PAYMENT", "AVATAR", "UPLOAD_HELP", "QUEUE_INFO",
  "RESEND_CODE", "HELP", "HUMAN", "THANKS", "STATUS", "PARTICIPATE", "NENHUMA",
] as const;
export type AiLabel = (typeof AI_LABELS)[number];

export type BotAiSettings = {
  enabled: boolean;
  baseUrl: string;
  model: string;
  apiKeyConfigured: boolean;
  dailyCap: number;
  timeoutMs: number;
};

const KEYS = {
  enabled: "bot.ai.enabled",
  baseUrl: "bot.ai.baseUrl",
  model: "bot.ai.model",
  apiKey: "bot.ai.apiKey",
  dailyCap: "bot.ai.dailyCap",
} as const;

function read(db: AppDatabase, key: string): string | undefined {
  return (db.prepare("SELECT value FROM integration_settings WHERE key=?").get(key) as { value: string } | undefined)?.value;
}
function write(db: AppDatabase, key: string, value: string) {
  db.prepare(`INSERT INTO integration_settings (key,value,updated_at) VALUES (?,?,?)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at`)
    .run(key, value, new Date().toISOString());
}

/** Tabela de uso: o teto diario e persistido, senao um loop queimaria a cota. */
export function ensureBotAiUsage(db: AppDatabase) {
  db.exec(`CREATE TABLE IF NOT EXISTS bot_ai_usage (
    day TEXT PRIMARY KEY,
    calls INTEGER NOT NULL DEFAULT 0,
    hits INTEGER NOT NULL DEFAULT 0,
    failures INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL
  );`);
}

export function readBotAiSettings(db: AppDatabase, env: NodeJS.ProcessEnv = process.env): BotAiSettings {
  const cap = Number(read(db, KEYS.dailyCap) ?? env.BOT_AI_DAILY_CAP ?? 200);
  return {
    // Desligada por padrao: ninguem acorda com chamada externa que nao pediu.
    enabled: (read(db, KEYS.enabled) ?? (env.BOT_AI_ENABLED === "true" ? "1" : "0")) === "1",
    baseUrl: read(db, KEYS.baseUrl) ?? env.BOT_AI_BASE_URL ?? "",
    model: read(db, KEYS.model) ?? env.BOT_AI_MODEL ?? "",
    apiKeyConfigured: Boolean(read(db, KEYS.apiKey) ?? env.BOT_AI_API_KEY),
    dailyCap: Number.isFinite(cap) && cap > 0 ? Math.floor(cap) : 200,
    timeoutMs: 4_000,
  };
}

export function saveBotAiSettings(db: AppDatabase, patch: { enabled?: boolean; baseUrl?: string; model?: string; apiKey?: string; dailyCap?: number }) {
  if (patch.enabled !== undefined) write(db, KEYS.enabled, patch.enabled ? "1" : "0");
  if (patch.baseUrl !== undefined) write(db, KEYS.baseUrl, patch.baseUrl.trim());
  if (patch.model !== undefined) write(db, KEYS.model, patch.model.trim());
  if (patch.apiKey) write(db, KEYS.apiKey, patch.apiKey.trim());
  if (patch.dailyCap !== undefined && Number.isFinite(patch.dailyCap) && patch.dailyCap > 0) write(db, KEYS.dailyCap, String(Math.floor(patch.dailyCap)));
  return readBotAiSettings(db);
}

const today = () => new Date().toISOString().slice(0, 10);

/** Reserva uma chamada. Devolve false quando o teto do dia acabou. */
export function reserveAiCall(db: AppDatabase, cap: number): boolean {
  ensureBotAiUsage(db);
  const day = today(), stamp = new Date().toISOString();
  const row = db.prepare("SELECT calls FROM bot_ai_usage WHERE day=?").get(day) as { calls: number } | undefined;
  if ((row?.calls ?? 0) >= cap) return false;
  db.prepare(`INSERT INTO bot_ai_usage (day,calls,hits,failures,updated_at) VALUES (?,1,0,0,?)
    ON CONFLICT(day) DO UPDATE SET calls=bot_ai_usage.calls+1,updated_at=excluded.updated_at`).run(day, stamp);
  return true;
}
function recordOutcome(db: AppDatabase, field: "hits" | "failures") {
  ensureBotAiUsage(db);
  db.prepare(`UPDATE bot_ai_usage SET ${field}=${field}+1,updated_at=? WHERE day=?`).run(new Date().toISOString(), today());
}

/** Quanto a IA foi usada hoje (o painel mostra ao Owner). */
export function botAiUsageToday(db: AppDatabase): { calls: number; hits: number; failures: number } {
  ensureBotAiUsage(db);
  const row = db.prepare("SELECT calls,hits,failures FROM bot_ai_usage WHERE day=?").get(today()) as { calls: number; hits: number; failures: number } | undefined;
  return row ?? { calls: 0, hits: 0, failures: 0 };
}

const SYSTEM_PROMPT = [
  "Você classifica mensagens de WhatsApp de uma comunidade de youtubers chamada SOS YOUTUBER.",
  "Responda APENAS com um rótulo da lista, em maiúsculas, sem pontuação e sem explicação.",
  "Se a mensagem não corresponder claramente a nenhum rótulo, responda NENHUMA.",
  "Nunca escreva frases, nunca responda à pessoa, nunca invente informação.",
  "",
  "Rótulos:",
  "GROUP_ACCESS = quer entrar/ser adicionado em um grupo de WhatsApp, ou pede o link do grupo",
  "PAYMENT = pergunta sobre preço, mensalidade, se é pago, Pix ou assinatura",
  "AVATAR = pergunta sobre avatar, personagem, foto de perfil ou emblemas",
  "UPLOAD_HELP = quer saber como enviar o vídeo dele ou onde colar o link do vídeo",
  "QUEUE_INFO = pergunta como funcionam as filas de links, prazos ou vagas",
  "RESEND_CODE = não consegue acessar a conta, perdeu ou não recebeu a senha",
  "HELP = pede orientação geral, quer entender o projeto, ou pergunta sobre moedas, XP, níveis e ranking",
  "HUMAN = pede explicitamente para falar com uma pessoa, atendente ou a equipe",
  "THANKS = apenas agradece ou elogia",
  "STATUS = quer saber a situação do próprio cadastro ou pedido",
  "PARTICIPATE = quer se cadastrar/participar do projeto pela primeira vez",
  "NENHUMA = qualquer outra coisa",
].join("\n");

/**
 * Pergunta ao modelo qual porta abrir. Devolve `undefined` em QUALQUER duvida —
 * sem chave, sem configuracao, cota estourada, timeout, HTTP != 200, ou resposta
 * que nao seja exatamente um rotulo conhecido. Nunca lanca.
 */
export async function aiClassifyIntent(
  db: AppDatabase, text: string,
  deps: { env?: NodeJS.ProcessEnv; fetchImpl?: typeof fetch } = {},
): Promise<AiLabel | undefined> {
  const env = deps.env ?? process.env;
  const settings = readBotAiSettings(db, env);
  if (!settings.enabled || !settings.baseUrl || !settings.model || !settings.apiKeyConfigured) return undefined;
  const limpo = text.trim();
  // Mensagem curta demais nao tem sinal; longa demais e custo sem retorno.
  if (limpo.length < 3 || limpo.length > 400) return undefined;
  if (!reserveAiCall(db, settings.dailyCap)) return undefined;

  const apiKey = read(db, KEYS.apiKey) ?? env.BOT_AI_API_KEY ?? "";
  const doFetch = deps.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), settings.timeoutMs);
  try {
    const response = await doFetch(`${settings.baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      signal: controller.signal,
      body: JSON.stringify({
        model: settings.model,
        temperature: 0,          // classificacao nao quer criatividade
        max_tokens: 8,           // um rotulo cabe em poucos tokens; teto corta custo e divagacao
        messages: [{ role: "system", content: SYSTEM_PROMPT }, { role: "user", content: limpo }],
      }),
    });
    if (!response.ok) { recordOutcome(db, "failures"); return undefined; }
    const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    const bruto = (data.choices?.[0]?.message?.content ?? "").trim().toUpperCase().replace(/[^A-Z_]/g, "");
    // Lista fechada: o que nao esta nela nao existe. E o que impede a IA de
    // "inventar" uma acao que o bot nao sabe executar.
    const rotulo = (AI_LABELS as readonly string[]).includes(bruto) ? (bruto as AiLabel) : undefined;
    recordOutcome(db, rotulo && rotulo !== "NENHUMA" ? "hits" : "failures");
    return rotulo === "NENHUMA" ? undefined : rotulo;
  } catch {
    recordOutcome(db, "failures");
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}
