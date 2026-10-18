// AUDITORIA / variantes acolhedoras dos anúncios recorrentes (sem repetir).
//
// O dono quer que os anúncios do dia a dia (fila livre, upload, XP, nível, ranks)
// tenham o MESMO frescor das diárias de bom dia/boa noite: mesma função e alvo, mas
// variando o texto pra nunca ficar repetitivo. Reusamos o motor de não-repetição
// (bot-motivational) e damos a cada evento um poço de variantes.
//
// Cada variante usa os MESMOS placeholders do catálogo ({nome}, {fila}, {url}, ...),
// então o render e as guardas de privacidade continuam valendo (UPLOAD nunca expõe
// telefone: só nome, sala, posição e a URL do vídeo que a pessoa subiu para o ciclo).
//
// Tudo é dado (não código fixo): o Owner pode acrescentar/editar variantes no painel.
import type { AppDatabase } from "./db.js";
import { varyFrom } from "./bot-motivational.js";

/** Horário das diárias (America/Bahia), como o dono definiu. */
export const DAILY_SCHEDULE = {
  // Janelas definidas pelo dono: o bot manda UMA mensagem variada por dia em cada
  // janela, em qualquer dia da semana. Se o servidor reiniciar ou a cota adiar, ele
  // ainda consegue mandar dentro da janela — por isso ela é larga, não um instante.
  MORNING: { hour: 6, minute: 0, until: 12 },   // bom dia entre 06:00 e 11:59
  NIGHT: { hour: 18, minute: 0, until: 23 },    // boa noite entre 18:00 e 22:59
  timeZone: "America/Bahia",
} as const;

/**
 * Poços de variantes por evento. Placeholders iguais aos do catálogo — o render do
 * dispatch substitui depois. Mínimo de 5 por evento para não cansar.
 */
export const EVENT_VARIANTS: Record<string, string[]> = {
  WELCOME_DM: [
    "Oi! 👋 Que bom receber você no SOS YOUTUBER! Aqui a gente cresce colaborando, um vídeo de cada vez. 💛",
    "Seja bem-vindo ao SOS YOUTUBER! 😊 Vamos dar seu primeiro passo juntos, com calma e sem complicação. 💛",
    "Olá! Que bom que você chegou. 🌟 Sou o assistente do SOS YOUTUBER e vou ajudar você a começar. 💛",
    "Chega mais! 👋 No SOS YOUTUBER tem espaço para aprender e colaborar. Vou acompanhar você por aqui. 💛",
    "É um prazer ter você com a gente! 🙌 Vamos preparar seu acesso ao SOS YOUTUBER, passo a passo. 💛",
  ],
  QUEUE_OPEN: [
    "🚀 Fila nova no ar! A fila {fila} abriu agora. Tem lugar pra todo mundo colaborar, vem com calma: {link}",
    "✨ Abriu a fila {fila}! Bora montar mais um ciclo juntos? Sua vaga te espera em {link}",
    "🎬 Nova fila {fila} começando! Quanto mais gente, mais rápido todo mundo cresce. Participe: {link}",
    "📢 Fila {fila} liberada! Chega junto, tem espaço pra você. {link}",
    "🔥 Começou a fila {fila}! Um ciclo novo, uma chance nova pra todos. {link}",
    "🙌 Olha a fila {fila} aberta! Vem colaborar no seu tempo, a gente te espera. {link}",
  ],
  QUEUE_STATUS: [
    "📊 Agora: {abertas} fila(s) livre(s) e {ocupadas} posição(ões) ocupada(s). Quando quiser, é só {link} 💛",
    "📈 Situação das filas: {abertas} aberta(s), {ocupadas} lugar(es) já preenchido(s). Vem somar: {link}",
    "👀 Tem {abertas} fila(s) com espaço e {ocupadas} posição(ões) ocupada(s) agora. Bora? {link}",
    "🗂️ Filas livres: {abertas}. Já ocupadas: {ocupadas}. Sua vez pode ser agora: {link}",
    "💡 {abertas} fila(s) esperando por você, {ocupadas} já no jogo. Participe com calma: {link}",
  ],
  QUEUE_FILLING: [
    "⏳ A fila {fila} tá quase cheia! Faltam {vagas} vaga(s). Corre que ainda dá: {link}",
    "🔥 Olha a fila {fila} enchendo! Só mais {vagas} lugar(es). Garanta o seu: {link}",
    "🚨 Fila {fila} nas últimas {vagas} vaga(s)! Não fica de fora: {link}",
    "📣 Quase lá! A fila {fila} tem {vagas} vaga(s) sobrando. Vem fechar com a gente: {link}",
    "⚡ Reta final da fila {fila}: {vagas} vaga(s). Participe antes de encher: {link}",
  ],
  QUEUE_COMPLETE: [
    "🎉 Fila {fila} completa! Obrigado a cada um que colaborou. Juntos a gente fecha ciclo. 💛",
    "✅ Fechamos a fila {fila}! Que time. Já já tem fila nova pra continuar crescendo. 🚀",
    "🏁 Fila {fila} completinha! Orgulho dessa comunidade. Bora pra próxima! 🔥",
    "🙌 Ciclo da fila {fila} concluído! Cada link seu ajudou alguém. Gratidão. 💛",
    "🎬 Fila {fila} 100%! Missão cumprida, time. Descansa que amanhã tem mais. 😄",
  ],
  UPLOAD_NOTICE: [
    "✅ {nome} subiu o vídeo na sala {sala}, posição {posicao}! 🎥 Assiste e apoia: {url}",
    "🎬 Upload fresquinho do {nome} (sala {sala}, pos. {posicao})! Bora prestigiar: {url}",
    "🙌 {nome} acabou de enviar na sala {sala} (posição {posicao}). Dá aquela força: {url}",
    "📢 Novo vídeo do {nome} no ciclo, sala {sala}, posição {posicao}! Vem ver: {url}",
    "🔥 {nome} colaborou na sala {sala} (pos. {posicao})! Cada view conta: {url}",
    "💛 Chegou upload do {nome} (sala {sala}, posição {posicao}). Assiste com carinho: {url}",
  ],
  COINS_EARNED: [
    "🪙 Boa, {nome}! Você ganhou {moedas} moeda(s) pela sua participação. Continue assim! 🚀",
    "✨ {nome} faturou {moedas} moeda(s)! Seu esforço virou recompensa. 💪",
    "🎁 Caíram {moedas} moeda(s) pra você, {nome}! Obrigado por colaborar. 💛",
    "💰 {nome}, +{moedas} moeda(s) na conta! A comunidade agradece sua presença. 🙌",
    "🔥 Mandou bem, {nome}! {moedas} moeda(s) pelo seu empenho de hoje.",
  ],
  LEVEL_UP: [
    "🎉 Subiu de nível, {nome}! Agora você está no nível {nivel}. Orgulho! 🏆",
    "🚀 {nome} alcançou o nível {nivel}! Cada passo seu conta. Parabéns! ✨",
    "🏅 Nível {nivel} desbloqueado, {nome}! Você tá voando. Continue! 💪",
    "🌟 Uhul, {nome}! Bem-vindo(a) ao nível {nivel}. A evolução é sua. 💛",
    "🔥 {nome} evoluiu pro nível {nivel}! Isso é constância dando fruto. 👏",
  ],
  WEEKLY_XP_RANK: [
    "🏆 Ranking semanal de XP ({semana}):\n{ranking}\nParabéns aos destaques e a cada um que participou. Semana nova, chance nova! 🔥",
    "📊 Olha o TOP da semana ({semana})!\n{ranking}\nObrigado a todos que somaram. Bora pra próxima! 🚀",
    "⭐ Destaques de XP da semana ({semana}):\n{ranking}\nCada posição foi suada. Respeito a todos! 💛",
    "🔥 Ranking semanal fechado ({semana}):\n{ranking}\nTime forte! Semana que vem tem mais. 🙌",
  ],
  MONTHLY_TOP: [
    "👑 TOP do mês no SOS YOUTUBER:\n{ranking}\nQue mês! Gratidão a cada participante. O ranking global segue firme. 🌍",
    "🏆 Ranking global atualizado:\n{ranking}\nVocês são a prova de que juntos a gente cresce mais. 💛",
    "🌟 Destaques globais do mês:\n{ranking}\nParabéns aos líderes e a todo mundo que apareceu. 🔥",
    "📈 Fechamento do mês:\n{ranking}\nCada um de vocês construiu isso. Bora manter o ritmo! 🚀",
  ],
};

/**
 * Escolhe uma variante não-repetindo para o evento. Devolve o template (ainda com
 * placeholders) para o dispatch renderizar. Se o evento não tem poço, devolve
 * undefined e o chamador usa o defaultText do catálogo.
 */
export function pickEventVariant(db: AppDatabase, event: string): string | undefined {
  const pool = EVENT_VARIANTS[event];
  if (!pool || !pool.length) return undefined;
  return varyFrom(db, `event-variant:${event}`, pool);
}

/** Quais eventos têm variantes (para o painel exibir "x variantes" ao Owner). */
export function eventsWithVariants(): Array<{ event: string; count: number }> {
  return Object.entries(EVENT_VARIANTS).map(([event, pool]) => ({ event, count: pool.length }));
}
