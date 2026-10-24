import { assertFreeQueueEntryAllowed } from "./active-access.js";
// Filas conservam UUID/histórico; o número é apenas o rótulo exibido.
// Regra de Fábio em 15/10/2026 (substitui a compactação em cascata do Claude):
// novas filas usam o menor número livre. Ao fechar uma fila, a última fila
// pode ocupar a lacuna sem renumerar as intermediárias (1 fecha: 3 vira 1,
// 2 continua 2). Se restar apenas a 2, ela permanece 2 até uma nova ocupar 1.
// Todas as filas podem ser consultadas. Tarefas exigem inscrição/contribuição
// ou acesso Pular; as contribuições anteriores permanecem intactas.
import { randomUUID } from "node:crypto";
import type { AppDatabase } from "./db.js";

export const SLOTS_PER_ROUND = 10;
export const QUEUE_LIFETIME_MS=3*24*60*60_000;

export type QueueRow = { id: string; sequence: number; status: string; displayNumber: number; createdAt: string; closedAt?: string };

/** Filas ativas (não encerradas), já ordenadas pelo número de exibição. */
export function activeRounds(db: AppDatabase): QueueRow[] {
  return db.prepare(`SELECT id,sequence,status,display_number AS displayNumber,created_at AS createdAt,closed_at AS closedAt
    FROM rounds WHERE closed_at IS NULL ORDER BY display_number, sequence`).all() as QueueRow[];
}

/** Menor inteiro positivo não usado por uma fila ativa. */
export function lowestFreeNumber(db: AppDatabase): number {
  const used = new Set(activeRounds(db).map((r) => r.displayNumber));
  let n = 1;
  while (used.has(n)) n += 1;
  return n;
}

/**
 * AUDITORIA / O NUMERO DA FILA E IDENTIDADE, NAO POSICAO NUMA LISTA.
 *
 * Aqui existia `reuseClosedNumber`: ao fechar uma fila, ele pegava a fila de MAIOR
 * numero e a renomeava para o numero vago, para a numeracao nunca ter buraco. A
 * intencao era boa; o efeito, nao: o numero trocava de dono enquanto as pessoas usavam
 * a fila. Quem estava na "Fila 4" de manha estava em outra fila a tarde, com o mesmo
 * nome.
 *
 * O dano real apareceu no grupo. O bot anuncia "Novo video do Clay na sala 1, posicao
 * 5" e guarda avisos com o numero; depois de um fechamento, cada um desses avisos
 * passava a apontar para outra fila. Foi exatamente a mensagem contraditoria que o dono
 * fotografou — "a fila deste registro ja foi encerrada" logo acima de "Fila 1: 4/10
 * recebendo links" — e que eu, na primeira passada, tratei como problema de texto.
 *
 * Decisao do dono depois de eu apresentar o custo dos dois lados: a fila nasce com um
 * numero e morre com ele. Fila NOVA continua pegando o menor numero livre (a regra do
 * "enche a 1 antes da 2" segue valendo, via lowestFreeNumber), mas fila existente nunca
 * e renomeada. Buraco temporario na numeracao e aceitavel; identidade movel nao era.
 *
 * Isto reverte uma decisao deliberada do ASTRA, que tinha teste proprio
 * ("closing 2 moves 3 into 2 without moving 1"). O teste foi reescrito para a regra
 * nova, com o porque registrado.
 */

/** Cria uma fila nova no menor número livre. Retorna o id. */
export function openRound(db: AppDatabase): string {
  const id = randomUUID();
  const now = new Date().toISOString();
  const seq = (db.prepare("SELECT COALESCE(MAX(sequence),0) AS s FROM rounds").get() as { s: number }).s + 1;
  const insert = db.prepare("INSERT INTO rounds (id,sequence,status,created_at,display_number) VALUES (?,?, 'OPEN', ?, ?)");
  // AUDITORIA / CORRIDA QUE CRIAVA DUAS FILAS COM O MESMO NUMERO.
  //
  // `ensureOpenQueue` e chamado de quatro lugares (tick, fechamento, expiracao e
  // entrada em fila). Duas execucoes proximas calculavam o mesmo "menor numero livre"
  // e inseriam as duas — nascia uma segunda "Fila 2". Agora ha indice unico entre filas
  // ativas; sem este laco, a corrida deixaria de duplicar mas passaria a ESTOURAR.
  // Reconsultar e tentar o proximo numero resolve sem travar ninguem.
  for (let tentativa = 0; tentativa < 50; tentativa += 1) {
    try {
      insert.run(id, seq, now, lowestFreeNumber(db));
      return id;
    } catch (cause) {
      const conflito = cause instanceof Error && /UNIQUE constraint failed: rounds\.display_number/i.test(cause.message);
      if (!conflito) throw cause;
    }
  }
  throw Object.assign(new Error("Não foi possível abrir uma fila agora. Tente novamente."), { statusCode: 503, code: "QUEUE_NUMBER_EXHAUSTED" });
}

/** Garante ao menos uma fila OPEN. Retorna true se precisou criar. */
export function ensureOpenQueue(db: AppDatabase): boolean {
  const open = db.prepare("SELECT id FROM rounds WHERE status='OPEN' AND closed_at IS NULL LIMIT 1").get();
  if (open) return false;
  openRound(db);
  return true;
}

/** Encerra sem apagar dados e mantém o número das filas intermediárias. */
export function closeRound(db: AppDatabase, roundId: string): void {
  db.transaction(() => {
    const round = db.prepare("SELECT display_number AS number FROM rounds WHERE id=? AND closed_at IS NULL")
      .get(roundId) as { number: number } | undefined;
    if (!round) return;
    db.prepare("UPDATE rounds SET closed_at=? WHERE id=? AND closed_at IS NULL").run(new Date().toISOString(), roundId);
    if(round.number===1&&!activeRounds(db).some(row=>row.displayNumber===1))openRound(db);
    ensureOpenQueue(db);
  })();
}

/** Remove expired queues from active navigation, keeping URLs and immutable credit history. */
export function expireRounds(db:AppDatabase,now=Date.now()):number{
 return db.transaction(()=>{
  const cutoff=new Date(now-QUEUE_LIFETIME_MS).toISOString();
  const expired=db.prepare("SELECT id FROM rounds WHERE closed_at IS NULL AND created_at<=?").all(cutoff) as {id:string}[];
  if(!expired.length)return 0;
  const stamp=new Date(now).toISOString();
  for(const row of expired)db.prepare("UPDATE rounds SET closed_at=? WHERE id=? AND closed_at IS NULL").run(stamp,row.id);
  if(!activeRounds(db).some(row=>row.displayNumber===1))openRound(db);
  ensureOpenQueue(db);
  return expired.length;
 })();
}

/** Completion is personal. Queues stay visible for their full 72-hour lifetime. */
export function closeRoundIfFullyConsumed(db: AppDatabase, roundId: string): boolean {
  const round=db.prepare("SELECT created_at AS createdAt,closed_at AS closedAt FROM rounds WHERE id=?").get(roundId) as {createdAt:string;closedAt?:string}|undefined;
  if(!round||round.closedAt||Date.parse(round.createdAt)+QUEUE_LIFETIME_MS>Date.now())return false;
  expireRounds(db);
  return Boolean(db.prepare("SELECT 1 FROM rounds WHERE id=? AND closed_at IS NOT NULL").get(roundId));
}

// ---------- participação ----------

export class QueueEntryError extends Error {
  readonly statusCode = 409;
  constructor(readonly code: "QUEUE_CLOSED" | "QUEUE_ALREADY_COMPLETED" | "QUEUE_ALREADY_JOINED" | "QUEUE_FULL" | "QUEUE_NOT_OPEN" | "QUEUE_ROOT_NO_SPAWN", message: string) {
    super(message);
    this.name = "QueueEntryError";
  }
}

export function joinRound(db: AppDatabase, roundId: string, userId: string, source: "FREE" | "SKIP" | "PASS" = "FREE"): void {
  const round = db.prepare("SELECT closed_at AS closedAt,created_at AS createdAt FROM rounds WHERE id=?").get(roundId) as { closedAt: string | null;createdAt:string } | undefined;
  if (!round || round.closedAt || Date.parse(round.createdAt)+QUEUE_LIFETIME_MS<=Date.now()) throw new QueueEntryError("QUEUE_CLOSED", "Esta fila já foi encerrada.");
  const progress = db.prepare("SELECT finalized_at AS finalizedAt FROM playlist_watch_progress WHERE round_id=? AND user_id=?")
    .get(roundId, userId) as { finalizedAt: string | null } | undefined;
  if (progress?.finalizedAt) throw new QueueEntryError("QUEUE_ALREADY_COMPLETED", "Você já concluiu esta fila.");
  db.prepare(`INSERT INTO round_participants (round_id,user_id,joined_at,left_at,source) VALUES (?,?,?,NULL,?)
    ON CONFLICT(round_id,user_id) DO UPDATE SET source=CASE WHEN round_participants.left_at IS NOT NULL THEN excluded.source ELSE round_participants.source END,left_at=NULL`).run(roundId, userId, new Date().toISOString(), source);
}
/** Explicit abandonment: one penalty, no history deletion or retry extension. */
export function applyAbandonmentCooldown(db: AppDatabase, userId: string): string | undefined {
  if(db.prepare("SELECT 1 FROM owner_access WHERE user_id=? AND active=1 AND role='ROOT_OWNER'").get(userId))return;
  const previous=db.prepare("SELECT cooldown_until AS until FROM users WHERE id=?").get(userId) as {until?:string}|undefined;
  const until=new Date(Math.max(Date.now()+60*60_000,Date.parse(previous?.until??"")||0)).toISOString();
  db.prepare("UPDATE users SET cooldown_until=?,cooldown_reason='Abandono voluntário de fila: 60 minutos',updated_at=? WHERE id=?").run(until,new Date().toISOString(),userId);
  return until;
}
export function leaveRound(db: AppDatabase, roundId: string, userId: string): void {
  db.transaction(() => {
    const result = db.prepare("UPDATE round_participants SET left_at=? WHERE round_id=? AND user_id=? AND left_at IS NULL")
      .run(new Date().toISOString(), roundId, userId);
    if (result.changes) { applyAbandonmentCooldown(db,userId); closeRoundIfFullyConsumed(db, roundId); }
  })();
}
/** Resume only the original membership after voluntary departure, never a completed task. */
export function resumeRound(db:AppDatabase,roundId:string,userId:string){
 return db.transaction(()=>{
  const row=db.prepare("SELECT rp.left_at AS leftAt,r.closed_at AS closedAt,p.finalized_at AS finalizedAt,p.finalize_reason AS reason FROM round_participants rp JOIN rounds r ON r.id=rp.round_id LEFT JOIN playlist_watch_progress p ON p.round_id=r.id AND p.user_id=rp.user_id WHERE r.id=? AND rp.user_id=?").get(roundId,userId) as {leftAt?:string;closedAt?:string;finalizedAt?:string;reason?:string}|undefined;
  if(!row||row.closedAt)throw new QueueEntryError("QUEUE_CLOSED","Esta fila já foi encerrada ou não pertence ao seu histórico.");
  if(row.finalizedAt&&row.reason!=="ABANDONED")throw new QueueEntryError("QUEUE_ALREADY_COMPLETED","Você já concluiu esta fila.");
  if(!row.leftAt&&!row.finalizedAt)return {ok:true,replayed:true};
  assertFreeQueueEntryAllowed(db,userId);
  db.prepare("UPDATE playlist_watch_progress SET finalized_at=NULL,finalize_reason=NULL WHERE round_id=? AND user_id=? AND finalize_reason='ABANDONED'").run(roundId,userId);
  db.prepare("UPDATE round_participants SET left_at=NULL WHERE round_id=? AND user_id=?").run(roundId,userId);
  return {ok:true,replayed:false};
 })();
}
export function isParticipant(db: AppDatabase, roundId: string, userId: string): boolean {
  return Boolean(db.prepare(`SELECT 1 FROM round_participants rp JOIN rounds r ON r.id=rp.round_id
    WHERE rp.round_id=? AND rp.user_id=? AND rp.left_at IS NULL AND r.closed_at IS NULL`).get(roundId, userId));
}

/** Filas ATIVAS em que o usuário está — a base da visibilidade e da navegação. */
export function myRounds(db: AppDatabase, userId: string): QueueRow[] {
  return db.prepare(`SELECT r.id,r.sequence,r.status,r.display_number AS displayNumber,r.created_at AS createdAt,r.closed_at AS closedAt
    FROM rounds r JOIN round_participants rp ON rp.round_id=r.id
    LEFT JOIN playlist_watch_progress p ON p.round_id=r.id AND p.user_id=rp.user_id
    WHERE rp.user_id=? AND rp.left_at IS NULL AND r.closed_at IS NULL AND p.finalized_at IS NULL
    ORDER BY r.display_number`).all(userId) as QueueRow[];
}

export function vacanciesIn(db: AppDatabase, roundId: string): number {
  const used = (db.prepare("SELECT COUNT(*) AS n FROM submissions WHERE round_id=?").get(roundId) as { n: number }).n;
  return Math.max(0, SLOTS_PER_ROUND - used);
}

/**
 * A fila "de trabalho" do usuário: a fila OPEN em que ele já está. Se não estiver
 * em nenhuma, a primeira fila OPEN com vaga (e ele entra nela). É o alvo das
 * contribuições — nunca "a fila mais nova do sistema".
 */
export function currentRoundFor(db: AppDatabase, userId: string,preferredId?:string,administrative=false): QueueRow | undefined {
  const mine = myRounds(db, userId).filter((r) => r.status === "OPEN");
  if(preferredId) {const chosen=mine.find(round=>round.id===preferredId);if(chosen)return chosen;}
  if (mine.length) return mine[0];
  if(!administrative)assertFreeQueueEntryAllowed(db,userId);
  ensureOpenQueue(db);
  const candidates = activeRounds(db).filter((r) => r.status === "OPEN" && vacanciesIn(db, r.id) > 0);
  const target = candidates[0];
  if (!target) return undefined;
  joinRound(db, target.id, userId, "FREE");
  return target;
}

/**
 * Variante de leitura de `currentRoundFor`: NÃO inscreve ninguém. O dashboard
 * precisa disso — só de olhar a tela, ninguém deve entrar numa fila.
 * `preferId` permite ao cliente pedir uma fila específica entre as dele.
 */
export function currentRoundViewFor(db: AppDatabase, userId: string, preferId?: string): QueueRow | undefined {
  const mine = myRounds(db, userId);
  if (preferId) {
    const chosen = mine.find((r) => r.id === preferId);
    if (chosen) return chosen;
  }
  const open = mine.find((r) => r.status === "OPEN");
  if (open) return open;
  if (mine.length) return mine[0];
  return activeRounds(db).find((r) => r.status === "OPEN" && vacanciesIn(db, r.id) > 0);
}

/**
 * Destino do "Pular": a próxima fila OPEN com vaga em que o usuário AINDA não
 * está; se não houver, cria uma nova. Não consome o item — quem consome é a rota.
 */
export function skipTargetFor(db: AppDatabase, userId: string,targetRoundId?:string,allowReady=false): QueueRow {
  if(targetRoundId){
    const selected=activeRounds(db).find(round=>round.id===targetRoundId);
    if(!selected||Date.parse(selected.createdAt)+QUEUE_LIFETIME_MS<=Date.now())throw new QueueEntryError("QUEUE_CLOSED","Esta fila já encerrou seu prazo de três dias.");
    if(db.prepare("SELECT 1 FROM round_participants WHERE round_id=? AND user_id=? AND left_at IS NULL").get(targetRoundId,userId))throw new QueueEntryError("QUEUE_ALREADY_JOINED","Você já tem acesso a esta fila. Abra-a sem gastar outro item.");
    if(db.prepare("SELECT 1 FROM playlist_watch_progress WHERE round_id=? AND user_id=? AND finalized_at IS NOT NULL").get(targetRoundId,userId))throw new QueueEntryError("QUEUE_ALREADY_COMPLETED","Você já concluiu esta fila. O histórico continua disponível para consulta.");
    if(selected.status!=="OPEN"&&!(allowReady&&selected.status==="READY"))throw new QueueEntryError("QUEUE_NOT_OPEN","O Passe abre uma fila com vagas. Use Pular para acompanhar uma fila já completa.");
    if(selected.status==="OPEN"&&vacanciesIn(db,selected.id)<1)throw new QueueEntryError("QUEUE_FULL","Esta fila acabou de ser preenchida. Atualize antes de escolher.");
    return selected;
  }
  const mineIds = new Set((db.prepare(`SELECT rp.round_id AS id FROM round_participants rp
    LEFT JOIN playlist_watch_progress p ON p.round_id=rp.round_id AND p.user_id=rp.user_id
    WHERE rp.user_id=? AND (rp.left_at IS NULL OR p.finalized_at IS NOT NULL)`).all(userId) as Array<{ id: string }>).map(row => row.id));
  const candidate = activeRounds(db).find((r) => r.status === "OPEN" && Date.parse(r.createdAt)+QUEUE_LIFETIME_MS>Date.now() && !mineIds.has(r.id) && vacanciesIn(db, r.id) > 0);
  if (candidate) return candidate;
  // AUDITORIA / O ROOT TESTANDO NAO PODE POLUIR A PRODUCAO COM FILAS VAZIAS.
  //
  // O Pular promete nunca ser desperdicado: se a pessoa ja esta em todas as filas
  // abertas, ele cria uma nova. Para quem PAGA o item isso e justo e fica como esta.
  //
  // Mas o ROOT tem Pular ilimitado (ver queue-skip.ts: `root ? ROOT_ITEM_QUANTITY`).
  // Cada toque dele no botao abria mais uma fila — foi assim que surgiram filas 3 e 4
  // que participante nenhum consegue encher. Com poucos ativos, cada fila extra dilui
  // o grupo: ninguem chega aos 10 links, nenhuma fecha, ninguem recebe.
  //
  // Entao o ilimitado perde justamente o poder de CRIAR. O ROOT continua podendo
  // pular para qualquer fila existente com vaga; so nao fabrica filas sem querer.
  // A recusa acontece antes de consumeItem e dentro da transacao: nada e cobrado.
  if (db.prepare("SELECT 1 FROM owner_access WHERE user_id=? AND active=1 AND role='ROOT_OWNER'").get(userId)) {
    throw new QueueEntryError("QUEUE_ROOT_NO_SPAWN",
      "Seu Pular é ilimitado, então criar uma fila nova aqui encheria o sistema de filas vazias que ninguém fecha. Você já está em todas as filas abertas com vaga — espere uma encher ou abra uma fila pelo painel, de propósito.");
  }
  const id = openRound(db);
  return db.prepare(`SELECT id,sequence,status,display_number AS displayNumber,created_at AS createdAt,closed_at AS closedAt
    FROM rounds WHERE id=?`).get(id) as QueueRow;
}
