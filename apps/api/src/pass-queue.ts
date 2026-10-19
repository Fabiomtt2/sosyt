import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { AppDatabase } from "./db.js";
import { ROOT_ITEM_QUANTITY } from "./inventory.js";
import { isRootOwner } from "./super.js";
import { joinRound, skipTargetFor } from "./queues.js";

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
  );`);
}

export function queuePassBalance(db: AppDatabase, userId: string): number {
  if (isRootOwner(db, userId)) return ROOT_ITEM_QUANTITY;
  const row = db.prepare("SELECT extra_slot_passes AS passes FROM wallets WHERE user_id=?").get(userId) as { passes: number } | undefined;
  return row?.passes ?? 0;
}

/** One Passe opens one additional queue, keeping every earlier membership and URL. */
export function joinNextQueueWithPass(db: AppDatabase, userId: string, referenceId: string) {
  z.string().uuid().parse(referenceId);
  if (!db.prepare("SELECT 1 FROM users WHERE id=? AND deleted_at IS NULL").get(userId))
    fail(404, "Participante não encontrado.", "USER_NOT_FOUND");
  return db.transaction(() => {
    const previous = db.prepare("SELECT result_json AS result FROM queue_pass_requests WHERE user_id=? AND reference_id=?")
      .get(userId, referenceId) as { result: string } | undefined;
    if (previous) return { queue: JSON.parse(previous.result) as JoinedPassQueue, passesAvailable: queuePassBalance(db, userId), replayed: true };
    const unlimited = isRootOwner(db, userId);
    const wallet = db.prepare("SELECT payment_hold AS hold FROM wallets WHERE user_id=?").get(userId) as { hold: number } | undefined;
    if (!unlimited && wallet?.hold) fail(409, "Seu acesso a itens está em análise pela equipe. Fale com o suporte.", "PAYMENT_HOLD");
    if (!unlimited && queuePassBalance(db, userId) < 1)
      fail(409, "Você precisa de um Passe para participar de outra fila.", "PASS_REQUIRED");
    const target = skipTargetFor(db, userId);
    const now = new Date().toISOString();
    if (!unlimited) {
      const debit = db.prepare("UPDATE wallets SET extra_slot_passes=extra_slot_passes-1,updated_at=? WHERE user_id=? AND extra_slot_passes>0")
        .run(now, userId);
      if (!debit.changes) fail(409, "Você precisa de um Passe para participar de outra fila.", "PASS_REQUIRED");
    }
    joinRound(db, target.id, userId, "PASS");
    const queue: JoinedPassQueue = { id: target.id, number: target.displayNumber, status: target.status, vacancies:
      Math.max(0, 10 - (db.prepare("SELECT COUNT(*) AS n FROM submissions WHERE round_id=?").get(target.id) as { n: number }).n) };
    db.prepare("INSERT INTO wallet_ledger(id,user_id,kind,amount_millis,reference_id,created_at) VALUES(?,?,'QUEUE_PASS_USED',0,?,?)")
      .run(randomUUID(), userId, "queue-pass:" + referenceId, now);
    db.prepare("INSERT INTO queue_pass_requests(user_id,reference_id,result_json,created_at) VALUES(?,?,?,?)")
      .run(userId, referenceId, JSON.stringify(queue), now);
    return { queue, passesAvailable: queuePassBalance(db, userId), replayed: false };
  })();
}
