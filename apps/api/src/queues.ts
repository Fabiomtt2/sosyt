// AUDITORIA / modelo multi-fila: numeração dinâmica, participação e visibilidade.
//
// Numeração (regra confirmada pelo owner):
//   1. Fila nova ocupa o MENOR número livre entre as filas ativas.
//   2. Ao encerrar, se o número NÃO for reocupado por uma fila nova, as filas
//      acima descem para fechar o buraco.
// O número é rótulo de exibição; a identidade da fila é sempre o `id` interno.
//
// Visibilidade: o participante só enxerga as filas em que está. Quem está na
// Fila 1 não vê a Fila 2 — a não ser que tenha usado o item "Pular".
import { randomUUID } from "node:crypto";
import type { AppDatabase } from "./db.js";

export const SLOTS_PER_ROUND = 10;

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

/** Fecha buracos: filas acima do número liberado descem uma posição. */
export function compactNumbers(db: AppDatabase): void {
  const rows = activeRounds(db);
  let expected = 1;
  const update = db.prepare("UPDATE rounds SET display_number=? WHERE id=?");
  for (const row of rows) {
    if (row.displayNumber !== expected) update.run(expected, row.id);
    expected += 1;
  }
}

/** Cria uma fila nova no menor número livre. Retorna o id. */
export function openRound(db: AppDatabase): string {
  const id = randomUUID();
  const now = new Date().toISOString();
  const seq = (db.prepare("SELECT COALESCE(MAX(sequence),0) AS s FROM rounds").get() as { s: number }).s + 1;
  db.prepare("INSERT INTO rounds (id,sequence,status,created_at,display_number) VALUES (?,?, 'OPEN', ?, ?)")
    .run(id, seq, now, lowestFreeNumber(db));
  return id;
}

/** Garante ao menos uma fila OPEN. Retorna true se precisou criar. */
export function ensureOpenQueue(db: AppDatabase): boolean {
  const open = db.prepare("SELECT id FROM rounds WHERE status='OPEN' AND closed_at IS NULL LIMIT 1").get();
  if (open) return false;
  openRound(db);
  return true;
}

/**
 * Encerra uma fila (soft-close: os dados permanecem, ela só sai de cena).
 * Aplica a regra 2: se nenhuma fila nova tomou o número liberado, compacta.
 */
export function closeRound(db: AppDatabase, roundId: string): void {
  db.transaction(() => {
    db.prepare("UPDATE rounds SET closed_at=? WHERE id=? AND closed_at IS NULL").run(new Date().toISOString(), roundId);
    const createdNew = ensureOpenQueue(db);   // pode reocupar o número liberado
    if (!createdNew) compactNumbers(db);
  })();
}

/** Uma fila só encerra quando TODOS os participantes concluíram 100%. */
export function closeRoundIfFullyConsumed(db: AppDatabase, roundId: string): boolean {
  const round = db.prepare("SELECT status, closed_at AS closedAt FROM rounds WHERE id=?").get(roundId) as { status: string; closedAt?: string } | undefined;
  if (!round || round.closedAt || round.status !== "READY") return false;
  const pending = db.prepare(`SELECT COUNT(*) AS n FROM round_participants rp
    LEFT JOIN playlist_watch_progress p ON p.round_id=rp.round_id AND p.user_id=rp.user_id
    WHERE rp.round_id=? AND rp.left_at IS NULL AND (p.finalized_at IS NULL)`).get(roundId) as { n: number };
  if (pending.n > 0) return false;
  closeRound(db, roundId);
  return true;
}

// ---------- participação ----------

export function joinRound(db: AppDatabase, roundId: string, userId: string, source: "FREE" | "SKIP" = "FREE"): void {
  db.prepare(`INSERT INTO round_participants (round_id,user_id,joined_at,left_at,source) VALUES (?,?,?,NULL,?)
    ON CONFLICT(round_id,user_id) DO UPDATE SET left_at=NULL`).run(roundId, userId, new Date().toISOString(), source);
}
export function leaveRound(db: AppDatabase, roundId: string, userId: string): void {
  db.prepare("UPDATE round_participants SET left_at=? WHERE round_id=? AND user_id=? AND left_at IS NULL")
    .run(new Date().toISOString(), roundId, userId);
}
export function isParticipant(db: AppDatabase, roundId: string, userId: string): boolean {
  return Boolean(db.prepare("SELECT 1 FROM round_participants WHERE round_id=? AND user_id=? AND left_at IS NULL").get(roundId, userId));
}

/** Filas ATIVAS em que o usuário está — a base da visibilidade e da navegação. */
export function myRounds(db: AppDatabase, userId: string): QueueRow[] {
  return db.prepare(`SELECT r.id,r.sequence,r.status,r.display_number AS displayNumber,r.created_at AS createdAt,r.closed_at AS closedAt
    FROM rounds r JOIN round_participants rp ON rp.round_id=r.id
    WHERE rp.user_id=? AND rp.left_at IS NULL AND r.closed_at IS NULL
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
export function currentRoundFor(db: AppDatabase, userId: string,preferredId?:string): QueueRow | undefined {
  const mine = myRounds(db, userId).filter((r) => r.status === "OPEN");
  if(preferredId) {const chosen=mine.find(round=>round.id===preferredId);if(chosen)return chosen;}
  if (mine.length) return mine[0];
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
export function skipTargetFor(db: AppDatabase, userId: string): QueueRow {
  if(!myRounds(db,userId).length) currentRoundFor(db,userId);
  const mineIds = new Set(myRounds(db, userId).map((r) => r.id));
  const candidate = activeRounds(db).find((r) => r.status === "OPEN" && !mineIds.has(r.id) && vacanciesIn(db, r.id) > 0);
  if (candidate) return candidate;
  const id = openRound(db);
  return db.prepare(`SELECT id,sequence,status,display_number AS displayNumber,created_at AS createdAt,closed_at AS closedAt
    FROM rounds WHERE id=?`).get(id) as QueueRow;
}
