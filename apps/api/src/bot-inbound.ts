// AUDITORIA / HYBRID+ — "ninguém nunca fala sozinho".
//
// A reauditoria encontrou CINCO portas por onde uma pessoa escreve para o bot e
// leva vácuo: só "quero participar" era entendido; nome com link ou longo demais
// caía fora; mensagem acima de 500 caracteres era descartada; a recusa PROMETIA
// "responda por aqui" sem handler; e o suporte mandava escrever "humano" sem que
// nenhuma linha de código lesse "humano". Áudio e foto sumiam calados.
//
// Este módulo classifica QUALQUER entrada e garante que sempre haja uma resposta.
// É puro (sem banco, sem rede) na classificação, para ser testável de verdade.
//
// Também implementa o OPT-OUT, que é dignidade e defesa ao mesmo tempo: quem pede
// para parar e continua recebendo acaba BLOQUEANDO o número — e bloqueio derruba a
// nota de qualidade da Meta, que por sua vez derruba a entrega do código de acesso.
// Respeitar o "pare" protege o login de todo mundo.
//
// REGRA DURA: opt-out NUNCA bloqueia mensagem transacional (código de acesso e
// decisão de cadastro). Quem pediu silêncio pediu silêncio de divulgação, não de
// segurança — e sem o código ele não entra na própria conta.
import type { AppDatabase } from "./db.js";

export type InboundIntent =
  | "PARTICIPATE"   // "quero participar"
  | "HUMAN"         // quer uma pessoa de verdade
  | "OPT_OUT"       // pare de me mandar mensagem
  | "OPT_IN"        // quero voltar a receber
  | "STATUS"        // "e aí, saiu?"
  | "RESEND_CODE"   // "não chegou meu código"
  | "GREETING"      // oi, bom dia
  | "HELP"          // ajuda, socorro, não entendi
  | "NAME_CANDIDATE"// pode ser o nome, quando estamos perguntando
  | "UNKNOWN";      // nada acima — AINDA ASSIM responde

/** Mesma normalização já usada no webhook: sem acento, minúsculo. */
export function normalizeInbound(text: string): string {
  return text.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().trim();
}

// Cada intenção tem frases de gatilho. Comparação por inclusão no texto normalizado,
// então "quero falar com humano" e "HUMANO" caem no mesmo lugar.
const TRIGGERS: Array<{ intent: InboundIntent; phrases: string[] }> = [
  { intent: "OPT_OUT", phrases: [
    "pare", "parar", "sair", "cancelar inscricao", "descadastrar", "nao quero mais receber",
    "nao quero receber", "me tira", "me tire", "remover meu numero", "stop",
  ] },
  { intent: "OPT_IN", phrases: ["voltar a receber", "quero receber", "reativar avisos", "voltei"] },
  { intent: "HUMAN", phrases: [
    "humano", "atendente", "pessoa de verdade", "falar com alguem", "falar com uma pessoa", "suporte humano",
  ] },
  { intent: "RESEND_CODE", phrases: [
    "nao chegou", "nao recebi", "reenviar codigo", "reenvia o codigo", "codigo nao", "sem codigo",
  ] },
  { intent: "STATUS", phrases: ["status", "e ai saiu", "ja saiu", "foi aprovado", "minha solicitacao", "novidade"] },
  { intent: "PARTICIPATE", phrases: ["quero participar", "quero entrar", "como participo", "como entro", "participar"] },
  { intent: "HELP", phrases: ["ajuda", "socorro", "nao entendi", "me ajuda", "duvida", "como funciona"] },
  { intent: "GREETING", phrases: ["oi", "ola", "bom dia", "boa tarde", "boa noite", "e ai", "opa"] },
];

/** Frase curta é saudação só quando é a mensagem inteira (evita casar "oi" dentro de "coisa"). */
const SHORT_EXACT: InboundIntent[] = ["GREETING", "OPT_OUT", "OPT_IN", "HUMAN", "STATUS"];

/**
 * Classifica a entrada. `awaitingName` muda o desfecho: durante a pergunta do nome,
 * um texto que não é comando provavelmente É o nome.
 */
export function classifyInbound(raw: string, opts: { awaitingName?: boolean } = {}): InboundIntent {
  const text = normalizeInbound(raw);
  if (!text) return "UNKNOWN";
  for (const { intent, phrases } of TRIGGERS) {
    for (const phrase of phrases) {
      const hit = SHORT_EXACT.includes(intent) && phrase.length <= 4
        ? text === phrase
        : text.includes(phrase);
      if (hit) return intent;
    }
  }
  if (opts.awaitingName && looksLikeName(raw)) return "NAME_CANDIDATE";
  return "UNKNOWN";
}

/**
 * O nome é aceitável? Antes, nome com link/quebra/longo demais caía num `else if`
 * que não enviava NADA. Agora separamos "é nome" de "não é" para sempre responder.
 */
export function looksLikeName(raw: string): boolean {
  const name = raw.trim();
  return name.length >= 2 && name.length <= 80 && !/[\r\n]/.test(name) && !/https?:\/\//i.test(name);
}

/** Por que o nome não serve — usado para explicar com gentileza, em vez de calar. */
export function nameRejectionReason(raw: string): string | undefined {
  const name = raw.trim();
  if (name.length < 2) return "Esse nome ficou curtinho — me manda com pelo menos duas letras?";
  if (name.length > 80) return "Esse nome ficou bem comprido! Pode mandar só como prefere ser chamado?";
  if (/https?:\/\//i.test(name)) return "Por segurança não consigo guardar links aqui. Me manda só o seu nome?";
  if (/[\r\n]/.test(name)) return "Me manda só o nome numa linha só, por favor?";
  return undefined;
}

// ───────────────────────────── OPT-OUT ─────────────────────────────

export function ensureBotOptOut(db: AppDatabase) {
  db.exec(`CREATE TABLE IF NOT EXISTS bot_opt_out (
    phone TEXT PRIMARY KEY,
    opted_out_at TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'WHATSAPP'
  );`);
}

export function isOptedOut(db: AppDatabase, phone: string): boolean {
  return Boolean(db.prepare("SELECT 1 FROM bot_opt_out WHERE phone=?").get(phone));
}

export function setOptOut(db: AppDatabase, phone: string, optedOut: boolean, source = "WHATSAPP") {
  if (optedOut) {
    db.prepare("INSERT INTO bot_opt_out (phone,opted_out_at,source) VALUES (?,?,?) ON CONFLICT(phone) DO NOTHING")
      .run(phone, new Date().toISOString(), source);
  } else {
    db.prepare("DELETE FROM bot_opt_out WHERE phone=?").run(phone);
  }
}

/** Mensagens que o opt-out NUNCA bloqueia: sem elas a pessoa perde a própria conta. */
export const TRANSACTIONAL_KINDS = ["LOGIN_CODE", "DECISION_NOTICE", "SUPPORT_REPLY"] as const;
export type MessageKind = (typeof TRANSACTIONAL_KINDS)[number] | "ENGAGEMENT";

export function mayReceive(db: AppDatabase, phone: string, kind: MessageKind): boolean {
  if (kind !== "ENGAGEMENT") return true;       // transacional sempre passa
  return !isOptedOut(db, phone);
}

// ───────────────────────── Respostas de fallback ─────────────────────────
//
// Voz: acolhedora e objetiva. Nunca culpa a pessoa, sempre oferece a saída.

export const INBOUND_REPLIES: Record<Exclude<InboundIntent, "NAME_CANDIDATE" | "PARTICIPATE">, string> = {
  HUMAN: "Combinado! 🙋 Já estou chamando uma pessoa da equipe para falar com você por aqui. Pode aguardar só um pouquinho — obrigado pela paciência. 💛",
  OPT_OUT: "Tudo bem, respeitamos sua escolha. 🤝 Não vou mais te mandar avisos e novidades. Você vai continuar recebendo só o essencial, como o código de acesso à sua conta. Se mudar de ideia, é só escrever VOLTAR.",
  OPT_IN: "Que bom te ver de volta! 🎉 Voltei a te avisar sobre filas e novidades. Se quiser parar de novo, é só escrever PARE.",
  STATUS: "Deixa eu conferir pra você! 🔎 Já já te respondo com a situação do seu cadastro por aqui mesmo.",
  RESEND_CODE: "Sem problema! 📲 Vou providenciar o reenvio do seu código de acesso. Se não chegar em alguns minutos, me escreve HUMANO que uma pessoa te ajuda.",
  GREETING: "Oi! 👋 Que bom falar com você. Posso te ajudar a ENTRAR no projeto, falar sobre as FILAS, ou te passar para uma pessoa — é só escrever HUMANO. O que você prefere?",
  HELP: "Tô aqui pra ajudar! 💛 Me diz com uma palavra o que você precisa: ENTRAR (participar do projeto), FILA (como funciona), ou HUMANO (falar com uma pessoa da equipe).",
  UNKNOWN: "Recebi sua mensagem! 💛 Não entendi direito, mas não vou te deixar sem resposta. Me diz com uma palavra: ENTRAR, FILA ou HUMANO — e se preferir falar com uma pessoa, é só escrever HUMANO.",
};

/** Mídia (áudio, foto, vídeo) nunca mais cai no silêncio. */
export const MEDIA_REPLY =
  "Recebi seu arquivo! 🎧 Ainda não consigo ouvir áudio nem abrir imagem por aqui, mas já avisei a equipe. " +
  "Se puder escrever em uma frase o que você precisa, eu te ajudo agora mesmo — ou escreve HUMANO que uma pessoa te responde.";

/** Mensagem muito longa também era descartada em silêncio. */
export const TOO_LONG_REPLY =
  "Recebi sua mensagem, mas ela ficou um pouco longa pro meu limite aqui. 💛 " +
  "Pode me mandar o essencial em poucas linhas? Se preferir desabafar com uma pessoa, escreve HUMANO.";

/** Resposta para quem responde a uma recusa — a promessa que o texto fazia e ninguém cumpria. */
export const DECLINED_FOLLOWUP_REPLY =
  "Recebi sua mensagem e ela não vai se perder. 💛 Encaminhei para os Owners revisarem seu caso com calma. " +
  "Assim que houver uma resposta, eu te aviso por aqui.";

/** A resposta do bot para uma intenção, já pronta para enfileirar. */
export function replyFor(intent: InboundIntent): string | undefined {
  if (intent === "NAME_CANDIDATE" || intent === "PARTICIPATE") return undefined; // fluxo próprio
  return INBOUND_REPLIES[intent];
}
