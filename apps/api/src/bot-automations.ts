// AUDITORIA / HYBRID+ — catálogo de automações do bot, configuráveis pelo Owner.
//
// Princípio: toda "atitude" do bot (dar boas-vindas, avisar filas, anunciar um
// upload, publicar ranking, renovar SUPER, atender no suporte, mandar recado
// global) é um EVENTO com uma mensagem-modelo EDITÁVEL no painel. Este arquivo é
// o NÚCLEO PURO — catálogo, textos padrão (voz acolhedora e respeitosa) e o render
// de placeholders — sem tocar em WhatsApp nem no banco, para ser 100% testável e
// "plugar" nos motores (oficial/Evolution) depois.
//
// Nada confia no cliente: canal, alvo e gating são decididos no servidor; o painel
// só edita os textos e liga/desliga. Reusa a fila durável `whatsapp_outbox` (do
// ASTRA) para os envios 1:1 oficiais; o canal de grupo é o Evolution.
//
// Todo texto é um PADRÃO — o Owner reescreve o que quiser. Os `{campos}` são
// preenchidos pelo sistema no disparo. Eventos marcados `requires: GAMIFICATION`
// ficam no catálogo mas só disparam quando a camada de XP/níveis existir (F3).

/** Por onde a mensagem sai. OFFICIAL = DM pela Cloud API (via outbox). EVOLUTION = grupo pelo motor não-oficial. */
export type AutomationChannel = "OFFICIAL" | "EVOLUTION";
/** Para quem vai. MEMBER = DM ao participante; OWNERS = donos; GROUP = o grupo do participante; ALL_GROUPS = todos os grupos SOS YOUTUBER. */
export type AutomationTarget = "MEMBER" | "OWNERS" | "GROUP" | "ALL_GROUPS";
/** Agrupamento no painel. */
export type AutomationCategory = "ONBOARDING" | "QUEUES" | "REWARDS" | "RETENTION" | "SUPPORT" | "BROADCAST";
/** Dependência além da base (além do canal). GAMIFICATION = precisa da camada de XP/níveis. */
export type AutomationRequirement = "GAMIFICATION";

export type AutomationEvent =
  // Onboarding
  | "WELCOME_MEMBER" | "WELCOME_DM" | "PINNED_MESSAGE"
  // Filas & atividade
  | "QUEUE_OPEN" | "QUEUE_STATUS" | "UPLOAD_NOTICE" | "QUEUE_FILLING" | "QUEUE_COMPLETE"
  // Recompensas & gamificação
  | "COINS_EARNED" | "LEVEL_UP" | "WEEKLY_XP_RANK" | "MONTHLY_TOP" | "STREAK_MILESTONE" | "BOOSTER_FRIDAY"
  // Reengajamento & cuidado
  | "SUPER_EXPIRING" | "INACTIVITY_NUDGE" | "GOOD_MORNING" | "GOOD_NIGHT"
  // Suporte & humano
  | "SUPPORT_AUTO" | "SUPPORT_HANDOFF" | "SUPPORT_OFFHOURS"
  // Administração / global
  | "BROADCAST_GLOBAL";

export type AutomationMeta = {
  event: AutomationEvent;
  category: AutomationCategory;
  label: string;
  description: string;
  defaultChannel: AutomationChannel;
  defaultTarget: AutomationTarget;
  /** periódico = disparado por agendador (não por um evento do sistema). */
  periodic: boolean;
  defaultIntervalMinutes?: number;
  /** pode ser fixada no topo do grupo (só o Evolution fixa). */
  canPin: boolean;
  /** variáveis que o texto deste evento aceita (validação e ajuda no painel). */
  placeholders: string[];
  defaultEnabled: boolean;
  defaultText: string;
  /** dependências além do canal (ex.: camada de XP ainda não existe). */
  requires?: AutomationRequirement[];
};

/** Limite de caracteres de uma mensagem de texto do WhatsApp. */
export const WHATSAPP_TEXT_LIMIT = 4096;

export const AUTOMATION_CATEGORIES: readonly AutomationCategory[] = [
  "ONBOARDING", "QUEUES", "REWARDS", "RETENTION", "SUPPORT", "BROADCAST",
];

// Catálogo. Os textos padrão só usam placeholders declarados no próprio evento
// (há um teste que garante essa invariante). Voz: acolhedora, respeitosa, humana.
export const AUTOMATION_CATALOG: readonly AutomationMeta[] = [
  // ───────────────────────── Onboarding ─────────────────────────
  {
    event: "WELCOME_MEMBER", category: "ONBOARDING",
    label: "Boas-vindas no grupo", description: "Quando um participante entra/é aprovado no grupo.",
    defaultChannel: "EVOLUTION", defaultTarget: "GROUP", periodic: false, canPin: false,
    placeholders: ["nome", "grupo", "link"], defaultEnabled: true,
    defaultText: "Seja muito bem-vindo(a), {nome}! 🎉 Que bom ter você no SOS YOUTUBER {grupo}. Aqui a gente cresce junto — acesse {link} com este mesmo WhatsApp e participe das filas no seu tempo. Conte com a gente. 💛",
  },
  {
    event: "WELCOME_DM", category: "ONBOARDING",
    label: "Boas-vindas no privado (ao aprovar)", description: "DM oficial de acolhimento quando o acesso é liberado.",
    defaultChannel: "OFFICIAL", defaultTarget: "MEMBER", periodic: false, canPin: false,
    placeholders: ["nome", "grupo", "link"], defaultEnabled: true,
    defaultText: "Oi, {nome}! Seu acesso ao SOS YOUTUBER {grupo} foi liberado. 🙌 É só entrar em {link} com este WhatsApp. Precisando de qualquer coisa, responda por aqui — estamos juntos!",
  },
  {
    event: "PINNED_MESSAGE", category: "ONBOARDING",
    label: "Mensagem fixada do grupo", description: "Texto fixado no topo do grupo (regras, link, orientações).",
    defaultChannel: "EVOLUTION", defaultTarget: "GROUP", periodic: false, canPin: true,
    placeholders: ["grupo", "link"], defaultEnabled: true,
    defaultText: "📌 SOS YOUTUBER {grupo} — acesse {link} com seu WhatsApp. Colabore nas filas de 10 links e leve a seleção para o seu canal. Vamos com respeito e carinho uns com os outros. 💛",
  },
  // ───────────────────────── Filas & atividade ─────────────────────────
  {
    event: "QUEUE_OPEN", category: "QUEUES",
    label: "Nova fila aberta", description: "Avisa quando uma nova fila/ciclo começa.",
    defaultChannel: "EVOLUTION", defaultTarget: "ALL_GROUPS", periodic: false, canPin: false,
    placeholders: ["fila", "link"], defaultEnabled: true,
    defaultText: "🚀 Nova fila aberta! A fila {fila} acabou de começar no SOS YOUTUBER. Tem lugar para todo mundo colaborar — garanta sua vaga com calma em {link}.",
  },
  {
    event: "QUEUE_STATUS", category: "QUEUES",
    label: "Status das filas (periódico)", description: "Aviso recorrente de filas abertas e vagas.",
    defaultChannel: "EVOLUTION", defaultTarget: "ALL_GROUPS", periodic: true, defaultIntervalMinutes: 360, canPin: false,
    placeholders: ["abertas", "vagas", "link", "ocupadas"], defaultEnabled: true,
    defaultText: "📊 Status SOS YOUTUBER: {abertas} fila(s) aberta(s) e {vagas} vaga(s) disponível(is) agora. Quando quiser participar, é só {link}. 💛",
  },
  {
    event: "UPLOAD_NOTICE", category: "QUEUES",
    label: "Aviso de upload na fila", description: "Anuncia um envio com identificação mínima: nome, sala e posição na fila.",
    defaultChannel: "EVOLUTION", defaultTarget: "GROUP", periodic: false, canPin: false,
    placeholders: ["nome", "sala", "posicao", "aba", "fila", "url"], defaultEnabled: true,
    defaultText: "✅ {nome} — sala {sala}, posição {posicao} — enviou na aba {aba} da fila {fila}. Bora fechar esse ciclo juntos, ainda dá tempo! 💛",
  },
  {
    event: "QUEUE_FILLING", category: "QUEUES",
    label: "Fila quase cheia", description: "Avisa quando restam poucas vagas na fila.",
    defaultChannel: "EVOLUTION", defaultTarget: "ALL_GROUPS", periodic: false, canPin: false,
    placeholders: ["fila", "vagas", "link"], defaultEnabled: true,
    defaultText: "⏳ A fila {fila} está quase completa — restam só {vagas} vaga(s)! Se quiser entrar neste ciclo, {link}.",
  },
  {
    event: "QUEUE_COMPLETE", category: "QUEUES",
    label: "Ciclo concluído", description: "Avisa quando a fila fecha / o ciclo é concluído.",
    defaultChannel: "EVOLUTION", defaultTarget: "ALL_GROUPS", periodic: false, canPin: false,
    placeholders: ["fila"], defaultEnabled: true,
    defaultText: "🎉 Fila {fila} concluída! Muito obrigado a todos que colaboraram. Logo tem mais — fiquem de olho e descansem bem. 💛",
  },
  // ───────────────────────── Recompensas & gamificação ─────────────────────────
  {
    event: "COINS_EARNED", category: "REWARDS",
    label: "Ganhou moedas", description: "DM de reconhecimento quando o participante acumula moedas.",
    defaultChannel: "OFFICIAL", defaultTarget: "MEMBER", periodic: false, canPin: false,
    placeholders: ["nome", "moedas", "total"], defaultEnabled: true,
    defaultText: "💰 Boa, {nome}! Você ganhou {moedas} moeda(s) e já soma {total}. Cada minuto assistindo com atenção conta — obrigado por fortalecer a comunidade! 🙌",
  },
  {
    event: "LEVEL_UP", category: "REWARDS",
    label: "Subiu de nível", description: "DM de celebração ao alcançar um novo nível.",
    defaultChannel: "OFFICIAL", defaultTarget: "MEMBER", periodic: false, canPin: false,
    placeholders: ["nome", "nivel"], defaultEnabled: true, requires: ["GAMIFICATION"],
    defaultText: "⭐ Parabéns, {nome}! Você alcançou o nível {nivel}! Seu empenho tá fazendo diferença de verdade. Seguimos juntos nessa jornada. 🚀",
  },
  {
    event: "WEEKLY_XP_RANK", category: "REWARDS",
    label: "Ranking semanal de XP", description: "Publica o ranking de XP da semana nos grupos.",
    defaultChannel: "EVOLUTION", defaultTarget: "ALL_GROUPS", periodic: true, defaultIntervalMinutes: 10080, canPin: false,
    placeholders: ["ranking", "semana"], defaultEnabled: true, requires: ["GAMIFICATION"],
    defaultText: "🏆 Ranking semanal de XP ({semana}):\n{ranking}\nParabéns aos destaques — e a cada um que participou, obrigado! Semana nova, chance nova para todos. 🔥",
  },
  {
    event: "MONTHLY_TOP", category: "REWARDS",
    label: "Destaques do mês (premiação)", description: "Top do mês com reconhecimento/premiação.",
    defaultChannel: "EVOLUTION", defaultTarget: "ALL_GROUPS", periodic: true, defaultIntervalMinutes: 43200, canPin: false,
    placeholders: ["mes", "ranking"], defaultEnabled: true, requires: ["GAMIFICATION"],
    defaultText: "🏅 Resultado de {mes}! Nossos destaques do mês:\n{ranking}\nObrigado a TODOS pela dedicação. Mês novo, oportunidade nova para cada um brilhar. 💛",
  },
  {
    event: "BOOSTER_FRIDAY", category: "REWARDS",
    label: "Sexta do Booster", description: "Anuncia o evento de sexta: das 6h às 23h59, cada participação pode soltar moedas, Pular, Passe ou SUPER 7 dias.",
    defaultChannel: "EVOLUTION", defaultTarget: "ALL_GROUPS", periodic: true, defaultIntervalMinutes: 10080, canPin: true,
    placeholders: ["link"], defaultEnabled: true, requires: ["GAMIFICATION"],
    defaultText: "🎁 Hoje é SEXTA DO BOOSTER no SOS YOUTUBER! Das 6h às 23h59, cada participação pode soltar uma surpresa: moedas, Pular, Passe ou até SUPER por 7 dias. 🔥 Participe em {link} e boa sorte!",
  },
  {
    event: "STREAK_MILESTONE", category: "REWARDS",
    label: "Sequência de participação", description: "DM quando o participante bate uma sequência (streak).",
    defaultChannel: "OFFICIAL", defaultTarget: "MEMBER", periodic: false, canPin: false,
    placeholders: ["nome", "dias"], defaultEnabled: true, requires: ["GAMIFICATION"],
    defaultText: "🔥 {nome}, você está há {dias} dias seguidos participando! Que constância bonita de ver. Orgulho da sua caminhada — segue firme! 💪",
  },
  // ───────────────────────── Reengajamento & cuidado ─────────────────────────
  {
    event: "SUPER_EXPIRING", category: "RETENTION",
    label: "SUPER prestes a vencer", description: "DM gentil avisando que a assinatura SUPER vai expirar.",
    defaultChannel: "OFFICIAL", defaultTarget: "MEMBER", periodic: true, defaultIntervalMinutes: 1440, canPin: false,
    placeholders: ["nome", "dias", "link"], defaultEnabled: true,
    defaultText: "Oi, {nome}! Seu SUPER no SOS YOUTUBER vence em {dias} dia(s). Se quiser manter os benefícios ativos, é só renovar em {link}. Sem pressão — tô avisando com carinho pra você não ser pego de surpresa. 💛",
  },
  {
    event: "INACTIVITY_NUDGE", category: "RETENTION",
    label: "Sentimos sua falta", description: "DM acolhedor após um período sem participar.",
    defaultChannel: "OFFICIAL", defaultTarget: "MEMBER", periodic: true, defaultIntervalMinutes: 1440, canPin: false,
    placeholders: ["nome", "link"], defaultEnabled: true,
    defaultText: "Oi, {nome}! A gente sentiu sua falta por aqui. 🥹 Quando quiser voltar a colaborar nas filas, é só acessar {link} — no seu tempo. Você é sempre bem-vindo(a)!",
  },
  {
    event: "GOOD_MORNING", category: "RETENTION",
    label: "Bom dia motivacional (diário)", description: "Todo dia de manhã, uma saudação + frase motivacional que NUNCA se repete (400+ combinações). Vale nos grupos.",
    defaultChannel: "EVOLUTION", defaultTarget: "ALL_GROUPS", periodic: true, defaultIntervalMinutes: 1440, canPin: false,
    placeholders: ["mensagem"], defaultEnabled: true, requires: [],
    defaultText: "{mensagem}",
  },
  {
    event: "GOOD_NIGHT", category: "RETENTION",
    label: "Boa noite motivacional (diário)", description: "Toda noite, uma despedida + frase motivacional que nunca se repete. Fecha o dia com carinho.",
    defaultChannel: "EVOLUTION", defaultTarget: "ALL_GROUPS", periodic: true, defaultIntervalMinutes: 1440, canPin: false,
    placeholders: ["mensagem"], defaultEnabled: true, requires: [],
    defaultText: "{mensagem}",
  },
  // ───────────────────────── Suporte & humano ─────────────────────────
  {
    event: "SUPPORT_AUTO", category: "SUPPORT",
    label: "Suporte automático", description: "Primeira resposta do assistente no suporte.",
    defaultChannel: "OFFICIAL", defaultTarget: "MEMBER", periodic: false, canPin: false,
    placeholders: ["nome"], defaultEnabled: true,
    defaultText: "Oi, {nome}! 🤖 Sou o assistente do SOS YOUTUBER. Me conta em uma frase o que você precisa (acesso, filas, grupo ou pagamento) que eu te ajudo. Se preferir falar com uma pessoa, é só escrever \"humano\". 💛",
  },
  {
    event: "SUPPORT_HANDOFF", category: "SUPPORT",
    label: "Transbordo para humano", description: "Confirma que um atendente humano foi acionado.",
    defaultChannel: "OFFICIAL", defaultTarget: "MEMBER", periodic: false, canPin: false,
    placeholders: ["nome"], defaultEnabled: true,
    defaultText: "Combinado, {nome}! Já estou chamando um atendente humano para continuar com você por aqui. Pode aguardar só um instante, tá? Obrigado pela paciência. 💛",
  },
  {
    event: "SUPPORT_OFFHOURS", category: "SUPPORT",
    label: "Fora do horário de atendimento", description: "Resposta quando não há humano disponível no momento.",
    defaultChannel: "OFFICIAL", defaultTarget: "MEMBER", periodic: false, canPin: false,
    placeholders: ["nome"], defaultEnabled: true,
    defaultText: "Oi, {nome}! No momento estamos fora do horário de atendimento humano, mas seu recado já ficou registrado. 🌙 Respondemos assim que possível — e, para dúvidas rápidas, posso tentar te ajudar agora mesmo.",
  },
  // ───────────────────────── Administração / global ─────────────────────────
  {
    event: "BROADCAST_GLOBAL", category: "BROADCAST",
    label: "Recado global (todos os grupos)", description: "Mensagem do Owner enviada a todos os grupos SOS YOUTUBER (manual ou agendada).",
    defaultChannel: "EVOLUTION", defaultTarget: "ALL_GROUPS", periodic: false, canPin: false,
    placeholders: ["mensagem", "link"], defaultEnabled: false,
    defaultText: "📣 Recado do SOS YOUTUBER:\n{mensagem}\n\nAcesse {link}. Obrigado a todos! 💛",
  },
];

export const AUTOMATION_EVENTS: readonly AutomationEvent[] = AUTOMATION_CATALOG.map((a) => a.event);

const CATALOG_BY_EVENT = new Map<AutomationEvent, AutomationMeta>(AUTOMATION_CATALOG.map((a) => [a.event, a]));

/** Metadados de um evento (lança se o evento não existe — erro de programação). */
export function automationMeta(event: AutomationEvent): AutomationMeta {
  const meta = CATALOG_BY_EVENT.get(event);
  if (!meta) throw new Error(`UNKNOWN_AUTOMATION_EVENT:${event}`);
  return meta;
}

export function isAutomationEvent(value: string): value is AutomationEvent {
  return CATALOG_BY_EVENT.has(value as AutomationEvent);
}

/** Catálogo agrupado por categoria, na ordem de AUTOMATION_CATEGORIES (para o painel). */
export function automationsByCategory(): Array<{ category: AutomationCategory; items: AutomationMeta[] }> {
  return AUTOMATION_CATEGORIES.map((category) => ({
    category,
    items: AUTOMATION_CATALOG.filter((a) => a.category === category),
  }));
}

/**
 * Render do texto: substitui {chave} pelos valores. Placeholders desconhecidos
 * ficam intactos (para o Owner enxergar o que escreveu, em vez de sumir).
 * Corta no limite do WhatsApp. Não re-expande valores (uma passada só).
 */
export function renderTemplate(text: string, vars: Record<string, string | number>): string {
  const rendered = text.replace(/\{(\w+)\}/g, (match, key: string) =>
    Object.prototype.hasOwnProperty.call(vars, key) ? String(vars[key]) : match
  );
  return rendered.length > WHATSAPP_TEXT_LIMIT ? rendered.slice(0, WHATSAPP_TEXT_LIMIT) : rendered;
}

/** Placeholders usados num texto que NÃO são válidos para o evento (validação do painel). */
export function unknownPlaceholders(event: AutomationEvent, text: string): string[] {
  const known = new Set(automationMeta(event).placeholders);
  const used = Array.from(text.matchAll(/\{(\w+)\}/g), (m) => m[1]);
  return [...new Set(used.filter((key) => !known.has(key)))];
}

/** Formata a lista do ranking de XP em linhas com medalhas (helper de WEEKLY_XP_RANK/MONTHLY_TOP). */
export function formatXpRanking(entries: ReadonlyArray<{ name: string; xp: number }>, limit = 10): string {
  const medals = ["🥇", "🥈", "🥉"];
  return entries
    .slice(0, Math.max(0, limit))
    .map((entry, index) => `${medals[index] ?? `${index + 1}.`} ${entry.name} — ${entry.xp} XP`)
    .join("\n");
}
