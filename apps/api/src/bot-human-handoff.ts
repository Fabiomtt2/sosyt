// AUDITORIA / escalonamento para atendimento humano ("Tenho dúvidas").
//
// POR QUE ASSIM, E NÃO UM LINK wa.me JOGADO NA CARA DO USUÁRIO
//
// A tela final do WhatsApp (mensagem pronta + botão enviar) é da Meta e não pode ser
// restilizada por ninguém — nem por nós, nem por serviço/repo externo. O que os
// "wa.me customizados" fazem é enfeitar o BOTÃO antes de abrir o WhatsApp; a tela em
// si continua a mesma, e ainda terceirizam dados de usuário. Então não dependemos de
// ninguém de fora.
//
// O desenho que o dono pediu (sem o popup padrão incomodando o usuário):
//   1. A pessoa escreve "Tenho dúvidas" na conversa privada com o bot.
//   2. O bot acolhe e diz que já chamou a equipe — a pessoa não precisa clicar em nada.
//   3. O bot AVISA o número humano de atendimento, com um link direto pra conversa da
//      pessoa (wa.me do usuário) — aí um humano de verdade a procura.
//
// Assim o atendimento é proativo: quem tem a fricção do wa.me é a EQUIPE (um clique no
// link), nunca o usuário. O número humano é configurável pelo Owner.
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
    "Em pouquinho uma pessoa de verdade vai te chamar aqui mesmo, nesta conversa. " +
    "Se quiser, já me adianta numa frase o que você precisa, que a gente agiliza. 🙌";
}

/**
 * Mensagem que o bot envia ao NÚMERO HUMANO, com o link direto pra conversa da pessoa.
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
