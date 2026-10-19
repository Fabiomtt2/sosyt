import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDatabase, type AppDatabase } from "./db.js";
import { assertFreeQueueEntryAllowed, isBypassCooldownForJoinedQueue } from "./active-access.js";
import { activeRounds, currentRoundFor, joinRound, leaveRound, openRound } from "./queues.js";

describe("intervalo de novas filas preserva acessos já conquistados", () => {
  let db: AppDatabase, one: string, two: string;
  const user = "cooldown-queue-fixture";
  const finish = (round: string) => {
    const now = new Date().toISOString();
    db.prepare("INSERT INTO playlist_watch_progress(round_id,user_id,watched_seconds_json,durations_json,percent,finalized_at,finalize_reason,updated_at) VALUES(?,?,'[]','[]',100,?,'COMPLETE',?)")
      .run(round, user, now, now);
    db.prepare("UPDATE users SET cooldown_until=? WHERE id=?").run(new Date(Date.now() + 1800000).toISOString(), user);
  };
  beforeEach(() => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-15T15:00:00Z"));
    db = createDatabase(":memory:"); const now = new Date().toISOString();
    db.prepare("INSERT INTO users(id,name,phone,group_code,created_at,updated_at) VALUES(?,'Pessoa','5571999000081','1',?,?)").run(user, now, now);
    db.prepare("INSERT INTO wallets(user_id,updated_at) VALUES(?,?)").run(user, now);
    one = activeRounds(db)[0].id; two = openRound(db);
    joinRound(db, one, user, "FREE"); joinRound(db, two, user, "PASS");
  });
  afterEach(() => { db.close(); vi.useRealTimers(); });

  it("concluir a FREE1 mantém a PASS2 disponível", () => {
    finish(one);
    expect(isBypassCooldownForJoinedQueue(db, user)).toBe(true);
    expect(isBypassCooldownForJoinedQueue(db, user, two)).toBe(true);
    expect(() => assertFreeQueueEntryAllowed(db, user, two)).not.toThrow();
  });

  it("concluir a PASS2 mantém a FREE1 original disponível", () => {
    finish(two);
    expect(isBypassCooldownForJoinedQueue(db, user, one)).toBe(true);
    expect(() => assertFreeQueueEntryAllowed(db, user, one)).not.toThrow();
  });

  it("finalizar todas impede contornar o intervalo com uma nova participaçãoFREE", () => {
    finish(one); finish(two);
    db.prepare("UPDATE rounds SET status='READY' WHERE id IN (?,?)").run(one, two);
    openRound(db);
    expect(isBypassCooldownForJoinedQueue(db, user)).toBe(false);
    expect(() => currentRoundFor(db, user)).toThrow(/Aguarde o intervalo/);
    expect(db.prepare("SELECT COUNT(*) AS n FROM round_participants WHERE user_id=?").get(user)).toEqual({ n: 2 });
  });

  it("acesso pendente de uma fila não autoriza obter outra FREE durante intervalo", () => {
    finish(one);
    const unjoined = openRound(db);
    expect(() => assertFreeQueueEntryAllowed(db, user, unjoined)).toThrow(/Aguarde o intervalo/);
    expect(() => assertFreeQueueEntryAllowed(db, user)).toThrow(/Aguarde o intervalo/);
  });

  it("sair ou fechar a última fila pendente revoga a exceção imediatamente", () => {
    finish(one); leaveRound(db, two, user);
    expect(isBypassCooldownForJoinedQueue(db, user)).toBe(false);
    joinRound(db, two, user, "PASS");
    db.prepare("UPDATE rounds SET closed_at=? WHERE id=?").run(new Date().toISOString(), two);
    expect(isBypassCooldownForJoinedQueue(db, user)).toBe(false);
  });

  it("depois do intervalo o ingresso FREE volta a ser permitido", () => {
    finish(one); finish(two);
    db.prepare("UPDATE rounds SET status='READY' WHERE id IN (?,?)").run(one, two);
    const next = openRound(db); vi.advanceTimersByTime(1800001);
    expect(currentRoundFor(db, user)?.id).toBe(next);
  });

  it("Root ignora o intervalo sem fabricar progresso", () => {
    finish(one); finish(two); const now = new Date().toISOString();
    db.prepare("INSERT INTO owner_access(id,user_id,phone,normalized_name,role,active,created_at,updated_at) VALUES('root-cooldown',?,'root-cooldown-phone','root','ROOT_OWNER',1,?,?)").run(user, now, now);
    expect(isBypassCooldownForJoinedQueue(db, user)).toBe(true);
    expect(() => assertFreeQueueEntryAllowed(db, user)).not.toThrow();
  });
});
