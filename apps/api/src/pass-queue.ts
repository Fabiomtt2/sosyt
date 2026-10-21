import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { AppDatabase } from "./db.js";
import { ROOT_ITEM_QUANTITY } from "./inventory.js";
import { isRootOwner } from "./super.js";
import { QUEUE_LIFETIME_MS } from "./queues.js";

export type JoinedPassQueue = { id: string; number: number; status: string; vacancies: number };
const fail = (statusCode: number, message: string, code: string): never => {
  throw Object.assign(new Error(message), { statusCode, code });
};

/** Additive ledger: existing passes and historical extra-URL uses are preserved. */
export function initializePassQueues(db: AppDatabase): void {
  db.exec(`CREATE TABLE IF NOT EXISTS queue_pass_requests (
    user_id TEXT NOT NULL REFERENCES users(id), reference_id TEXT NOT NULL,
    result_json TEXT NOT NULL, created_at TEXT NOT NULL,
    PRIMARY KEY(user_id,reference_id)
  );
  CREATE TABLE IF NOT EXISTS queue_contribution_allowances (
    user_id TEXT NOT NULL REFERENCES users(id), round_id TEXT NOT NULL REFERENCES rounds(id),
    extra_urls INTEGER NOT NULL DEFAULT 0 CHECK(extra_urls >= 0), updated_at TEXT NOT NULL,
    PRIMARY KEY(user_id,round_id)
  );`);
}

export function queuePassBalance(db: AppDatabase, userId: string): number {
  if (isRootOwner(db, userId)) return ROOT_ITEM_QUANTITY;
  const row = db.prepare("SELECT extra_slot_passes AS passes FROM wallets WHERE user_id=?").get(userId) as { passes: number } | undefined;
  return row?.passes ?? 0;
}

/** Each use grants one additional URL in an already joined OPEN queue; never joins or creates one. */
export function extraUrlAllowance(db: AppDatabase, userId: string, roundId: string): number {
  return (db.prepare("SELECT extra_urls AS n FROM queue_contribution_allowances WHERE user_id=? AND round_id=?").get(userId,roundId) as {n:number}|undefined)?.n ?? 0;
}

export function joinNextQueueWithPass(db: AppDatabase, userId: string, referenceId: string,targetRoundId?:string) {
  z.string().uuid().parse(referenceId);
  if(targetRoundId)z.string().uuid().parse(targetRoundId);
  if (!db.prepare("SELECT 1 FROM users WHERE id=? AND deleted_at IS NULL").get(userId))
    fail(404, "Participante não encontrado.", "USER_NOT_FOUND");
  return db.transaction(() => {
    const previous = db.prepare("SELECT result_json AS result FROM queue_pass_requests WHERE user_id=? AND reference_id=?")
      .get(userId, referenceId) as { result: string } | undefined;
    if (previous) {
      const queue=JSON.parse(previous.result) as JoinedPassQueue;
      if(targetRoundId&&queue.id!==targetRoundId)fail(409,"Esta referência já foi usada em outra fila.","QUEUE_REFERENCE_CONFLICT");
      return {queue,passesAvailable:queuePassBalance(db,userId),extraUrlsGranted:extraUrlAllowance(db,userId,queue.id),replayed:true};
    }
    const unlimited = isRootOwner(db, userId);
    const wallet = db.prepare("SELECT payment_hold AS hold FROM wallets WHERE user_id=?").get(userId) as { hold: number } | undefined;
    if (!unlimited && wallet?.hold) fail(409, "Seu acesso a itens está em análise pela equipe. Fale com o suporte.", "PAYMENT_HOLD");
    if (!unlimited && queuePassBalance(db, userId) < 1)
      fail(409, "Você precisa de um Passe para liberar mais uma URL nesta fila.", "PASS_REQUIRED");
    const target = db.prepare(`SELECT r.id,r.display_number AS displayNumber,r.status,r.created_at AS createdAt,
      (SELECT COUNT(*) FROM submissions s WHERE s.round_id=r.id) AS count
      FROM rounds r JOIN round_participants rp ON rp.round_id=r.id AND rp.user_id=? AND rp.left_at IS NULL
      WHERE r.status='OPEN' AND r.closed_at IS NULL AND (? IS NULL OR r.id=?)
      AND NOT EXISTS(SELECT 1 FROM playlist_watch_progress p WHERE p.round_id=r.id AND p.user_id=? AND p.finalized_at IS NOT NULL)
      ORDER BY r.display_number,r.sequence LIMIT 1`).get(userId,targetRoundId??null,targetRoundId??null,userId) as
      {id:string;displayNumber:number;status:string;createdAt:string;count:number}|undefined;
    if(!target || Date.parse(target.createdAt)+QUEUE_LIFETIME_MS<=Date.now())
      fail(409,"Use Passe somente em uma fila aberta da qual você já participa. Para mudar de fila, use Pular.","PASS_CURRENT_QUEUE_REQUIRED");
    if(target.count>=10)fail(409,"Esta fila já está completa. O Passe só libera URL em uma fila com vaga.","QUEUE_FULL");
    const now = new Date().toISOString();
    if (!unlimited) {
      const debit = db.prepare("UPDATE wallets SET extra_slot_passes=extra_slot_passes-1,updated_at=? WHERE user_id=? AND extra_slot_passes>0")
        .run(now, userId);
      if (!debit.changes) fail(409, "Você precisa de um Passe para liberar mais uma URL nesta fila.", "PASS_REQUIRED");
    }
    db.prepare(`INSERT INTO queue_contribution_allowances(user_id,round_id,extra_urls,updated_at) VALUES(?,?,1,?)
      ON CONFLICT(user_id,round_id) DO UPDATE SET extra_urls=extra_urls+1,updated_at=excluded.updated_at`).run(userId,target.id,now);
    const queue: JoinedPassQueue = { id: target.id, number: target.displayNumber, status: target.status, vacancies:
      Math.max(0, 10 - (db.prepare("SELECT COUNT(*) AS n FROM submissions WHERE round_id=?").get(target.id) as { n: number }).n) };
    db.prepare("INSERT INTO wallet_ledger(id,user_id,kind,amount_millis,reference_id,created_at) VALUES(?,?,'QUEUE_PASS_USED',0,?,?)")
      .run(randomUUID(), userId, "queue-pass:" + referenceId, now);
    db.prepare("INSERT INTO queue_pass_requests(user_id,reference_id,result_json,created_at) VALUES(?,?,?,?)")
      .run(userId, referenceId, JSON.stringify(queue), now);
    return { queue, passesAvailable: queuePassBalance(db, userId), extraUrlsGranted:extraUrlAllowance(db,userId,target.id), replayed: false };
  })();
}
