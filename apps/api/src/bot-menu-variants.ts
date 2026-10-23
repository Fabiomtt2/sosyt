// AUDITORIA / O MENU NAO PODE SER UM DISCO RISCADO.
//
// Queixa do dono, literal: "o bot envia a mesma mensagem padrão. É acolhedora mas não
// há variação como as outras com as mesmas opções de 1 a 5". As diárias (bom dia/boa
// noite) e os anuncios (fila, upload, ranking) ja tinham poco de variantes; a saudacao,
// a ajuda e o "nao entendi" eram UMA string fixa cada — justamente as mensagens que a
// pessoa ve mais vezes, e por isso as que mais cansam.
//
// O que varia e o que NAO varia (decisao de design, nao preguica):
//   - varia a ABERTURA (acolhimento) e o FECHAMENTO (como chamar uma pessoa);
//   - NAO varia o bloco numerado 1..5. Ele e funcional: o classificador casa digito
//     exato, e a pessoa decora "3 e senha". Embaralhar isso seria trocar frescor por
//     confusao.
//
// Abertura e fechamento rodam em BUCKETS SEPARADOS do motor de nao-repeticao. Isso
// multiplica as combinacoes em vez de somar: 10 aberturas x 6 fechos = 60 mensagens
// distintas de saudacao antes de qualquer repeticao de par.
import type { AppDatabase } from "./db.js";
import { varyFrom } from "./bot-motivational.js";

/** O bloco numerado e a parte CONTRATUAL da mensagem: estavel de proposito. */
const OPTIONS_BLOCK = [
  "1. ENTRAR — quero participar do projeto",
  "2. FILA — como funcionam as filas de 10 links",
  "3. SENHA — não consigo entrar na minha conta",
  "4. STATUS — quero saber como está meu cadastro",
  "5. MOEDAS — pontos, níveis e recompensas",
].join("\n");

const GREETING_OPENINGS = [
  "Oi! 👋 Que bom te ver por aqui! Eu sou o bot do SOS YOUTUBER e tô aqui pra te ajudar no que precisar. 💛",
  "Olá! 😊 Seja bem-vindo(a) ao SOS YOUTUBER! Sou o bot da comunidade e posso resolver bastante coisa com você agora mesmo.",
  "E aí! 🙌 Chegou no lugar certo. Eu sou o bot do SOS YOUTUBER — me diz o que você precisa que eu cuido disso.",
  "Oi, tudo bem? 💛 Aqui é o bot do SOS YOUTUBER. Pode falar comigo com suas palavras, sem formalidade.",
  "Bem-vindo(a)! ✨ Sou o assistente do SOS YOUTUBER. Tô aqui o dia todo pra te ajudar a crescer junto com a galera.",
  "Oi! 🎬 Eu sou o bot do SOS YOUTUBER, a comunidade onde os canais se ajudam de verdade. Como posso te ajudar?",
  "Olá! 🚀 Que alegria te ver aqui. Sou o bot do SOS YOUTUBER e resolvo a maior parte das coisas na hora.",
  "Oi! 💪 Bot do SOS YOUTUBER falando. Me conta o que você quer fazer que eu te levo até lá.",
  "Oi, seja bem-vindo(a)! 🌟 Aqui é o bot do SOS YOUTUBER. Pode me chamar sempre que precisar, sem cerimônia.",
  "Olá! 🤝 Sou o bot do SOS YOUTUBER. A gente cresce em comunidade por aqui — e eu tô aqui pra facilitar o seu caminho.",
];

const HELP_OPENINGS = [
  "Claro, tô aqui pra isso! 💛 Me diz o que você precisa:",
  "Pode contar comigo! 🙌 Escolhe por onde começamos:",
  "Sem problema, vamos resolver juntos. 💪 O que você precisa agora?",
  "Tô à disposição! 😊 Me aponta o caminho:",
  "Bora resolver! 🚀 Me diz qual desses é o seu caso:",
  "Com certeza! ✨ Diz aí o que te ajuda mais agora:",
  "Tamo junto! 🤝 Qual desses assuntos é o seu?",
  "Claro que sim! 🎯 Escolhe uma opção (palavra ou número):",
];

const UNKNOWN_OPENINGS = [
  "Recebi sua mensagem! 💛 Não entendi direito dessa vez, mas não vou te deixar sem resposta.",
  "Oi! 😅 Essa eu não consegui entender bem — mas vamos resolver do mesmo jeito.",
  "Chegou sua mensagem! 💛 Confesso que não captei o que você quis dizer. Me ajuda a te ajudar?",
  "Hmm, essa me pegou! 🤔 Não entendi, mas não vou te deixar na mão.",
  "Li sua mensagem, mas não consegui interpretar direito. 💛 Vamos tentar de outro jeito?",
  "Desculpa, não entendi essa! 😊 Me diz de um jeito mais curtinho que eu resolvo.",
  "Recebi! 📨 Só não ficou claro pra mim o que você precisa. Pode escolher uma opção?",
];

const CLOSINGS = [
  "E se preferir falar com uma pessoa de verdade, é só escrever *Tenho dúvidas* que eu chamo alguém da equipe. 🙋",
  "Se nada disso resolver, escreve *Tenho dúvidas* que uma pessoa da equipe te atende. 💛",
  "Quer falar com alguém do time? Escreve *Tenho dúvidas* que eu chamo na hora. 🙋",
  "Prefere conversar com uma pessoa? Manda *Tenho dúvidas* que a equipe assume daqui. 💛",
  "E se for algo que eu não resolvo, escreve *Tenho dúvidas* — tem gente de verdade do outro lado. 🤝",
  "Se precisar de atendimento humano, é só escrever *Tenho dúvidas*. Sem fila, sem robô. 🙋",
];

/** Intencoes cujo texto passa a variar. As demais seguem com a resposta unica. */
const POOLS: Record<string, { openings: string[]; prompt?: string }> = {
  GREETING: { openings: GREETING_OPENINGS, prompt: "Me diz o que você quer (pode escrever com suas palavras ou mandar o número):" },
  HELP: { openings: HELP_OPENINGS },
  UNKNOWN: { openings: UNKNOWN_OPENINGS, prompt: "Pode tentar de um jeito mais simples? Escolha uma opção (palavra ou número):" },
};

/**
 * Monta a mensagem variada. Devolve `undefined` quando a intencao nao tem poco, para
 * o chamador cair na resposta unica de sempre (nenhum fluxo perde texto por isso).
 */
export function variedInboundReply(db: AppDatabase, intent: string): string | undefined {
  const pool = POOLS[intent];
  if (!pool) return undefined;
  const opening = varyFrom(db, `menu-open:${intent}`, pool.openings);
  const closing = varyFrom(db, "menu-close", CLOSINGS);
  return [opening, pool.prompt, OPTIONS_BLOCK, closing].filter(Boolean).join("\n\n");
}

/** Quantas mensagens distintas existem por intencao (o painel mostra ao Owner). */
export function menuVariantCount(): Array<{ intent: string; combinations: number }> {
  return Object.entries(POOLS).map(([intent, pool]) => ({ intent, combinations: pool.openings.length * CLOSINGS.length }));
}
