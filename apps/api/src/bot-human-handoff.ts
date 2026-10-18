// Atendimento humano: configuração do destinatário e textos legados de diagnóstico.
// O fluxo de pedido humano usa bot-human-relay.ts: ticket persistente e respostas
// autorizadas enviadas pelo bot na mesma conversa do participante.
// humanHandoffAlert permanece para avisos operacionais e falhas de senha.
import type { AppDatabase } from "./db.js";
import type { Config } from "./config.js";

/** Número humano de atendimento padrão (business). O Owner pode trocar no painel. */
export const DEFAULT_HUMAN_SUPPORT = "5571993978956";

const HUMAN_SUPPORT_KEY = "whatsapp.support.human_number";

const digitsOnly = (value: string | undefined | null): string => (value ?? "").replace(/\D/g, "");

/**
 * Número humano efetivo: o que o Owner salvou no painel, senão o business do config,
 * senão o default. Sempre devolve só dígitos (pronto para wa.me e para o outbox).
 */
export function humanSupportNumber(db: AppDatabase, config?: Config): string {
  let saved: string | undefined;
  try {
    const row = db.prepare("SELECT value FROM integration_settings WHERE key=?").get(HUMAN_SUPPORT_KEY) as { value: string } | undefined;
    saved = row?.value;
  } catch { /* tabela pode não existir em teste isolado */ }
  const resolved = digitsOnly(saved) || digitsOnly(config?.OWNER_BUSINESS_WHATSAPP) || DEFAULT_HUMAN_SUPPORT;
  return resolved;
}

/** O Owner define/atualiza o número humano de atendimento (painel). */
export function setHumanSupportNumber(db: AppDatabase, raw: string): string {
  const digits = digitsOnly(raw);
  if (!/^[1-9]\d{7,14}$/.test(digits)) {
    throw Object.assign(new Error("Informe o número humano com DDI, DDD e telefone."), { statusCode: 400, code: "INVALID_HUMAN_NUMBER" });
  }
  db.prepare(`INSERT INTO integration_settings (key,value,updated_at) VALUES (?,?,?)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`)
    .run(HUMAN_SUPPORT_KEY, digits, new Date().toISOString());
  return digits;
}

/**
 * Resposta ACOLHEDORA ao usuário quando ele pede atendimento humano. Varia um pouco
 * para não soar robótico. Nunca promete prazo que não controlamos; nunca manda o
 * usuário clicar em link nenhum — a equipe é quem procura.
 */
export function humanHandoffUserReply(name?: string): string {
  const primeiro = (name ?? "").trim().split(/\s+/)[0];
  const ola = primeiro ? `Pode deixar comigo, ${primeiro}! 💛` : "Pode deixar comigo! 💛";
  return `${ola} Já avisei a nossa equipe que você quer uma ajuda mais de pertinho. ` +
    "Uma pessoa de verdade poderá responder por esta mesma conversa assim que estiver disponível. " +
    "Se quiser, já me adianta numa frase o que você precisa, que a gente agiliza. 🙌";
}

/**
 * Aviso operacional ao número humano, com contato direto para diagnóstico.
 * O humano toca no link e já cai na conversa — essa é a única fricção wa.me, e fica do
 * lado da equipe, não do usuário.
 */
export function humanHandoffAlert(input: { name?: string; userPhone: string; lastMessage?: string }): string {
  const nome = (input.name ?? "").trim() || "Participante";
  const userDigits = digitsOnly(input.userPhone);
  const assunto = (input.lastMessage ?? "").trim();
  const linhaAssunto = assunto ? `\nO que a pessoa disse: "${assunto.slice(0, 300)}"` : "";
  return "🙋 Pedido de atendimento no SOS YOUTUBER\n\n" +
    `Participante: ${nome}` +
    `\nFalar agora: https://wa.me/${userDigits}` +
    linhaAssunto +
    "\n\nÉ só tocar no link pra abrir a conversa com a pessoa. (Aviso automático do bot.) 💛";
}
