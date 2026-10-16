// AUDITORIA / mensagens diárias motivacionais que NUNCA se repetem.
//
// O dono quer "Bom dia + motivacional" e "Boa noite + motivacional" todo dia, com
// variantes suficientes para nunca repetir — e o mesmo frescor nas respostas privadas.
//
// COMO GARANTIMOS "NUNCA REPETE"
//
// Cada mensagem é montada de DOIS poços independentes (saudação + frase), e cada poço
// tem um seletor que evita o que saiu recentemente (janela de memória persistida no
// banco). Com ~20 saudações x ~20 frases = ~400 combinações por período, e nenhuma
// repetição consecutiva possível, a sensação é de que o bot nunca se repete. Quando um
// poço se esgota, ele reembaralha — mas sempre sem repetir o último visto.
//
// Tudo é editável pelo Owner no painel (os poços são dados, não código fixo); aqui vão
// os padrões ricos para já nascer vivo.
import type { AppDatabase } from "./db.js";

export type DailyKind = "MORNING" | "NIGHT";

export function ensureMessageRotation(db: AppDatabase) {
  db.exec(`CREATE TABLE IF NOT EXISTS message_rotation (
    bucket TEXT PRIMARY KEY,
    recent TEXT NOT NULL DEFAULT '[]',
    updated_at TEXT NOT NULL
  );`);
}

/**
 * Escolhe um índice de [0, size) que não saiu nas últimas `window` vezes para aquele
 * bucket. Persiste a memória, então o "não repetir" sobrevive a reinícios. Determinístico
 * o suficiente para testar injetando `rng`.
 */
export function pickNonRepeating(
  db: AppDatabase, bucket: string, size: number,
  opts: { window?: number; rng?: () => number } = {},
): number {
  ensureMessageRotation(db);
  if (size <= 1) return 0;
  const window = Math.min(opts.window ?? Math.ceil(size * 0.6), size - 1);
  const rng = opts.rng ?? Math.random;
  const row = db.prepare("SELECT recent FROM message_rotation WHERE bucket=?").get(bucket) as { recent: string } | undefined;
  let recent: number[] = [];
  try { recent = row ? (JSON.parse(row.recent) as number[]) : []; } catch { recent = []; }
  const blocked = new Set(recent.slice(-window));
  const candidates: number[] = [];
  for (let i = 0; i < size; i++) if (!blocked.has(i)) candidates.push(i);
  const pool = candidates.length ? candidates : [...Array(size).keys()];
  const chosen = pool[Math.floor(rng() * pool.length) % pool.length];
  const nextRecent = [...recent, chosen].slice(-window);
  db.prepare(`INSERT INTO message_rotation (bucket,recent,updated_at) VALUES (?,?,?)
    ON CONFLICT(bucket) DO UPDATE SET recent=excluded.recent, updated_at=excluded.updated_at`)
    .run(bucket, JSON.stringify(nextRecent), new Date().toISOString());
  return chosen;
}

// ───────────────────────── Poços de variantes (padrão) ─────────────────────────
// Voz: calorosa, brasileira, de comunidade de criadores. Sem travessões, pra soar humano.

export const MORNING_GREETINGS: string[] = [
  "Bom dia! ☀️", "Bom diaaa! 🌅", "Opa, bom dia! ☕", "Bom dia, time! 🙌",
  "Dia lindo começando! ☀️", "Bom dia, criador! 🎬", "Acordou? Bom dia! 😄",
  "Bom dia pra quem sonha grande! ✨", "Partiu dia produtivo! 🚀", "Bom dia, gente boa! 💛",
  "Sol na janela, bom dia! 🌞", "Bom dia, família SOS! 🤝", "Energia renovada, bom dia! ⚡",
  "Bom dia! Hoje é dia de crescer. 🌱", "Café na mão? Bom dia! ☕", "Bom dia, guerreiro! 💪",
  "Que seu dia renda muito! Bom dia! 📈", "Bom dia, criativo! 🎨", "Novo dia, novas views! 🎥",
];

export const MORNING_MOTIVATION: string[] = [
  "Cada link que você monta hoje te aproxima do seu canal bombar. Vamos juntos? 🚀",
  "Consistência vence talento. Aparece, faz o seu, e a fila agradece. 💪",
  "Ninguém cresce sozinho. Aqui a gente se puxa pra cima. Bora! 🤝",
  "Um passo por dia vira uma escada. Qual seu passo de hoje? 🪜",
  "Quem planta link, colhe inscrito. Hoje é dia de plantar. 🌱",
  "O algoritmo gosta de quem não desiste. Mostra tua cara hoje. 🎬",
  "Seu próximo vídeo pode mudar tudo. Comece pela fila. 🎥",
  "Grandes canais começaram pequenos e constantes. Você está no caminho. 📈",
  "Foco no que você controla: fazer o seu, todo dia. O resto vem. 🎯",
  "A comunidade tá aqui te esperando. Vem somar! 💛",
  "Disciplina é fazer mesmo sem vontade. E hoje você vai. 🔥",
  "Um link seu ajuda outro criador. E isso volta pra você. 🔄",
  "Hoje é um ótimo dia pra sair da plateia e entrar no jogo. 🎮",
  "Seu esforço de hoje é a view de amanhã. Bora construir. 🛠️",
  "Comparação rouba alegria. Corre a sua corrida, no seu ritmo. 🏃",
  "Pequenos progressos ainda são progressos. Celebre o seu. 🎉",
  "A fila não anda sozinha. Com você, ela voa. 🕊️",
  "Acredite: o canal dos seus sonhos cabe na sua rotina. 🌟",
];

export const NIGHT_GREETINGS: string[] = [
  "Boa noite! 🌙", "Boa noiteee! ✨", "Fim de dia, boa noite! 🌛", "Boa noite, time! 😴",
  "Hora de descansar, boa noite! 🛏️", "Boa noite, criador! 🎬", "Dia cumprido, boa noite! ✅",
  "Boa noite pra quem se dedicou hoje! 💛", "Luz apagada, boa noite! 🌌", "Boa noite, gente boa! 🤍",
  "Descanse, amanhã tem mais! 🌙", "Boa noite, família SOS! 🤝", "Respira fundo, boa noite. 😌",
  "Boa noite! Você fez o seu hoje. 🙌", "Até amanhã, boa noite! 👋", "Boa noite, guerreiro! 💪",
  "Que venham bons sonhos! Boa noite. 💤", "Boa noite, criativo! 🎨",
];

export const NIGHT_MOTIVATION: string[] = [
  "Você plantou hoje. Amanhã a gente rega de novo. Orgulho de você. 🌱",
  "Descansar também é parte do crescimento. Recarregue as energias. 🔋",
  "O que você fez hoje já é mais do que ontem. Isso conta muito. 📈",
  "Amanhã o canal continua. Hoje, o merecido descanso. 🌙",
  "Criador bom também sabe pausar. Boa noite e bons sonhos. 💤",
  "Cada dia na fila é um tijolo no seu sonho. Já tem uma parede boa. 🧱",
  "Feche o dia em paz: você apareceu, e isso importa. 🕊️",
  "O sucesso é a soma de noites bem dormidas e dias bem vividos. 🌟",
  "Guarde a energia: amanhã tem view esperando por você. 🎥",
  "Você não está sozinho nessa. A comunidade dorme e acorda com você. 🤝",
  "Sonhe com o próximo marco. E acorde pronto pra buscá-lo. 🎯",
  "Gratidão pelo seu dia. Pequeno ou grande, foi seu. 🙏",
  "Amanhã é página nova. Durma leve, criador. 📖",
  "O descanso de hoje é o combustível de amanhã. 🚀",
  "Boa noite: o algoritmo dorme, mas sua constância não esquece. 😉",
  "Você chegou até aqui. Isso já é vitória. Boa noite. 🏆",
  "Recolha o dia com carinho. Amanhã a gente sobe mais um degrau. 🪜",
  "Que seu sono seja tão bom quanto a sua vontade de crescer. 💛",
];

/**
 * Monta a mensagem diária combinando saudação + frase, cada uma não-repetindo. O
 * resultado muda todo dia e praticamente nunca se repete.
 */
export function dailyMessage(db: AppDatabase, kind: DailyKind, rng?: () => number): string {
  const greetings = kind === "MORNING" ? MORNING_GREETINGS : NIGHT_GREETINGS;
  const motivation = kind === "MORNING" ? MORNING_MOTIVATION : NIGHT_MOTIVATION;
  const g = pickNonRepeating(db, `daily:${kind}:greet`, greetings.length, { rng });
  const m = pickNonRepeating(db, `daily:${kind}:motiv`, motivation.length, { rng });
  return `${greetings[g]} ${motivation[m]}`;
}

/**
 * Seletor genérico não-repetindo para QUALQUER poço (ex.: variar respostas privadas
 * do bot pra não soar robótico). O chamador passa o bucket e as opções.
 */
export function varyFrom(db: AppDatabase, bucket: string, options: string[], rng?: () => number): string {
  if (!options.length) return "";
  return options[pickNonRepeating(db, bucket, options.length, { rng })];
}

/** Quantas combinações diárias distintas existem (para o painel mostrar ao Owner). */
export function dailyVariantCount(kind: DailyKind): number {
  return kind === "MORNING"
    ? MORNING_GREETINGS.length * MORNING_MOTIVATION.length
    : NIGHT_GREETINGS.length * NIGHT_MOTIVATION.length;
}
