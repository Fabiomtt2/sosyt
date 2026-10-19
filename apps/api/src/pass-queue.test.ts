import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDatabase, type AppDatabase } from "./db.js";
import { activeRounds, joinRound, myRounds, openRound } from "./queues.js";
import { initializePassQueues, joinNextQueueWithPass, queuePassBalance } from "./pass-queue.js";

describe("Passe para fila adicional: transação e continuidade", () => {
  let db: AppDatabase;
  const user = "pass-fixture";
  const authUser = () => {
    const now = new Date().toISOString();
    db.prepare("INSERT INTO users(id,name,phone,group_code,created_at,updated_at) VALUES(?,'Pessoa','5571999000011','1',?,?)").run(user, now, now);
    db.prepare("INSERT INTO wallets(user_id,extra_slot_passes,updated_at) VALUES(?,2,?)").run(user, now);
    joinRound(db, activeRounds(db)[0].id, user);
  };
  beforeEach(() => { db = createDatabase(":memory:"); initializePassQueues(db); authUser(); });
  afterEach(() => db.close());

  it("2 Passes abrem2 filas adicionais e mantêm a primeira com sua URL", () => {
    const first = activeRounds(db)[0], now = new Date().toISOString();
    db.prepare("INSERT INTO submissions(id,round_id,slot,user_id,youtube_url,video_id,created_at) VALUES('pass-original-url',?,1,?,'https://youtu.be/abcdefghijk','abcdefghijk',?)").run(first.id, user, now);
    const two = joinNextQueueWithPass(db, user, randomUUID());
    const three = joinNextQueueWithPass(db, user, randomUUID());
    expect(two.queue.number).toBe(2); expect(three.queue.number).toBe(3);
    expect(myRounds(db, user).map(row => row.id)).toEqual([first.id, two.queue.id, three.queue.id]);
    expect(queuePassBalance(db, user)).toBe(0);
    expect(db.prepare("SELECT round_id AS roundId FROM submissions WHERE id='pass-original-url'").get()).toEqual({ roundId: first.id });
    expect(db.prepare("SELECT source FROM round_participants WHERE round_id=? AND user_id=?").get(two.queue.id, user)).toEqual({ source: "PASS" });
  });

  it("entra em fila existente com vaga sem criar outra", () => {
    const other = openRound(db), count = activeRounds(db).length;
    const result = joinNextQueueWithPass(db, user, randomUUID());
    expect(result.queue.id).toBe(other); expect(activeRounds(db)).toHaveLength(count);
    expect(queuePassBalance(db, user)).toBe(1);
  });

  it("retry do mesmo recibo não duplica gasto, entrada ou ledger", () => {
    const reference = randomUUID(), first = joinNextQueueWithPass(db, user, reference);
    const retry = joinNextQueueWithPass(db, user, reference);
    expect(retry.replayed).toBe(true); expect(retry.queue).toEqual(first.queue);
    expect(queuePassBalance(db, user)).toBe(1); expect(myRounds(db, user)).toHaveLength(2);
    expect(db.prepare("SELECT COUNT(*) AS n FROM wallet_ledger WHERE kind='QUEUE_PASS_USED'").get()).toEqual({ n: 1 });
  });

  it("sem Passe não abre fila nem modifica participação", () => {
    db.prepare("UPDATE wallets SET extra_slot_passes=0 WHERE user_id=?").run(user);
    const before = activeRounds(db);
    expect(() => joinNextQueueWithPass(db, user, randomUUID())).toThrow(/precisa de um Passe/);
    expect(activeRounds(db)).toEqual(before); expect(myRounds(db, user)).toHaveLength(1);
  });

  it("carteira em análise não consome o Passe", () => {
    db.prepare("UPDATE wallets SET payment_hold=1 WHERE user_id=?").run(user);
    expect(() => joinNextQueueWithPass(db, user, randomUUID())).toThrow(/em análise/);
    expect(queuePassBalance(db, user)).toBe(2); expect(activeRounds(db)).toHaveLength(1);
  });

  it("falha ao persistir recibo reverte fila criada e consumo", () => {
    db.exec("CREATE TRIGGER reject_pass BEFORE INSERT ON queue_pass_requests BEGIN SELECT RAISE(ABORT,'fixture failure'); END;");
    expect(() => joinNextQueueWithPass(db, user, randomUUID())).toThrow(/fixture failure/);
    expect(queuePassBalance(db, user)).toBe(2); expect(activeRounds(db)).toHaveLength(1);
    expect(myRounds(db, user)).toHaveLength(1);
    expect(db.prepare("SELECT COUNT(*) AS n FROM wallet_ledger WHERE kind='QUEUE_PASS_USED'").get()).toEqual({ n: 0 });
  });

  it("ROOT usa sem consumir saldo persistido e continua com referência idempotente", () => {
    const now = new Date().toISOString();
    db.prepare("INSERT INTO owner_access(id,user_id,phone,normalized_name,role,active,created_at,updated_at) VALUES('root-pass',?,'root-pass-fixture','root','ROOT_OWNER',1,?,?)").run(user, now, now);
    const reference = randomUUID(), first = joinNextQueueWithPass(db, user, reference);
    expect(first.passesAvailable).toBe(Number.MAX_SAFE_INTEGER);
    expect(joinNextQueueWithPass(db, user, reference).queue).toEqual(first.queue);
    expect(db.prepare("SELECT extra_slot_passes AS n FROM wallets WHERE user_id=?").get(user)).toEqual({ n: 2 });
  });
});
