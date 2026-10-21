import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDatabase, type AppDatabase } from "./db.js";
import { activeRounds, closeRound, closeRoundIfFullyConsumed, isParticipant, joinRound, leaveRound, myRounds, openRound, QUEUE_LIFETIME_MS, QueueEntryError, skipTargetFor } from "./queues.js";

// These tests exercise queue persistence and navigation, not watch-credit issuance.
describe("queue convergence: stable labels and preserved work", () => {
  let db: AppDatabase;
  const stamp = "2026-10-18T12:00:00.000Z";
  beforeEach(() => {
    db = createDatabase(":memory:");
    for (const [id, phone] of [["a", "15550000001"], ["b", "15550000002"]]) {
      db.prepare("INSERT INTO users(id,name,phone,group_code,created_at,updated_at) VALUES (?,?,?,'1',?,?)").run(id, id, phone, stamp, stamp);
    }
  });
  afterEach(() => db.close());
  const initial = () => activeRounds(db)[0].id;
  function progress(round: string, user: string, finalized = false) {
    db.prepare("INSERT INTO playlist_watch_progress(round_id,user_id,watched_seconds_json,durations_json,percent,updated_at,finalized_at) VALUES (?,?,?, ?,?,?,?)")
      .run(round, user, "[30]", "[100]", finalized ? 100 : 30, stamp, finalized ? stamp : null);
  }
  const label = (id: string) => activeRounds(db).find(row => row.id === id)?.displayNumber;

  it("closing 1 moves only 3 into 1 and preserves 2", () => {
    const one = initial(), two = openRound(db), three = openRound(db);
    closeRound(db, one);
    expect(label(three)).toBe(1);
    expect(label(two)).toBe(2);
    expect(activeRounds(db)).toHaveLength(2);
  });

  it("does the same when every queue is READY, then opens a new 3", () => {
    const one = initial(), two = openRound(db), three = openRound(db);
    db.prepare("UPDATE rounds SET status='READY'").run();
    closeRound(db, one);
    expect(label(three)).toBe(1);
    expect(label(two)).toBe(2);
    expect(activeRounds(db).map(row => [row.displayNumber, row.status])).toEqual([[1, "READY"], [2, "READY"], [3, "OPEN"]]);
  });

  it("closing 2 moves 3 into 2 without moving 1", () => {
    const one = initial(), two = openRound(db), three = openRound(db);
    closeRound(db, two);
    expect(label(one)).toBe(1);
    expect(label(three)).toBe(2);
  });

  it("a sole remaining 2 stays 2 and a new queue takes free label 1", () => {
    const one = initial(), two = openRound(db);
    closeRound(db, one);
    expect(label(two)).toBe(2);
    expect(activeRounds(db).find(row=>row.displayNumber===1)?.status).toBe("OPEN");
  });

  it("closing a missing or already closed id neither creates nor renumbers", () => {
    const one = initial();
    closeRound(db, "missing");
    expect(activeRounds(db).map(row => row.id)).toEqual([one]);
    closeRound(db, one);
    const after = activeRounds(db);
    closeRound(db, one);
    expect(activeRounds(db)).toEqual(after);
  });

  it("keeps the queue visible after completion and departure until its 72-hour expiry", () => {
    const round = initial();
    joinRound(db, round, "a"); joinRound(db, round, "b", "PASS");
    db.prepare("UPDATE rounds SET status='READY' WHERE id=?").run(round);
    progress(round, "a", true);
    expect(closeRoundIfFullyConsumed(db, round)).toBe(false);
    expect(myRounds(db, "a")).toEqual([]);
    expect(myRounds(db, "b").map(row => row.id)).toEqual([round]);
    leaveRound(db, round, "b");
    expect(isParticipant(db, round, "a")).toBe(true);
    expect(closeRoundIfFullyConsumed(db, round)).toBe(false);
    expect(db.prepare("SELECT finalized_at FROM playlist_watch_progress WHERE round_id=? AND user_id='a'").get(round)).toEqual({ finalized_at: stamp });
  });

  it("does not close OPEN work or close through an unrelated leave", () => {
    const round = initial();
    joinRound(db, round, "a");
    progress(round, "a", true);
    expect(closeRoundIfFullyConsumed(db, round)).toBe(false);
    db.prepare("UPDATE rounds SET status='READY' WHERE id=?").run(round);
    leaveRound(db, round, "b");
    expect(label(round)).toBe(1);
    expect(closeRoundIfFullyConsumed(db, round)).toBe(false);
    db.prepare("UPDATE rounds SET created_at=? WHERE id=?").run(new Date(Date.now()-QUEUE_LIFETIME_MS-1).toISOString(),round);
    expect(closeRoundIfFullyConsumed(db,round)).toBe(true);
    expect(db.prepare("SELECT finalized_at FROM playlist_watch_progress WHERE round_id=? AND user_id='a'").get(round)).toEqual({finalized_at:stamp});
  });

  it("preserves paid source while active and preserves URL/progress/ledger on reentry", () => {
    const round = initial();
    joinRound(db, round, "a", "PASS");
    joinRound(db, round, "a", "FREE");
    expect(db.prepare("SELECT source FROM round_participants WHERE round_id=? AND user_id='a'").get(round)).toEqual({ source: "PASS" });
    progress(round, "a");
    db.prepare("INSERT INTO submissions(id,round_id,slot,user_id,youtube_url,video_id,created_at) VALUES ('sub',?,1,'a','https://youtu.be/abcdefghijk','abcdefghijk',?)").run(round, stamp);
    db.prepare("INSERT INTO wallet_ledger(id,user_id,kind,amount_millis,reference_id,created_at) VALUES ('ledger','a','WATCH_TIME',1000,'observation-1',?)").run(stamp);
    const snapshot = () => [db.prepare("SELECT * FROM submissions").all(), db.prepare("SELECT * FROM playlist_watch_progress").all(), db.prepare("SELECT * FROM wallet_ledger").all()];
    const before = snapshot();
    leaveRound(db, round, "a");
    expect(isParticipant(db, round, "a")).toBe(false);
    expect(myRounds(db, "a")).toEqual([]);
    joinRound(db, round, "a", "SKIP");
    expect(isParticipant(db, round, "a")).toBe(true);
    expect(db.prepare("SELECT source FROM round_participants WHERE round_id=? AND user_id='a'").get(round)).toEqual({ source: "SKIP" });
    expect(snapshot()).toEqual(before);
  });

  it("refuses closed or personally finalized work without reviving a left row", () => {
    const round = initial();
    joinRound(db, round, "a"); progress(round, "a", true);
    leaveRound(db, round, "a");
    expect(() => joinRound(db, round, "a", "PASS")).toThrowError(QueueEntryError);
    try { joinRound(db, round, "a"); } catch (error) { expect(error).toMatchObject({ code: "QUEUE_ALREADY_COMPLETED", statusCode: 409 }); }
    expect(isParticipant(db, round, "a")).toBe(false);
    closeRound(db, round);
    expect(() => joinRound(db, round, "b")).toThrowError("Esta fila já foi encerrada.");
    try { joinRound(db, round, "b"); } catch (error) { expect(error).toMatchObject({ code: "QUEUE_CLOSED", statusCode: 409 }); }
    expect(myRounds(db, "a")).toEqual([]);
  });

  it("chooses a paid target without silently granting FREE membership", () => {
    const round = initial();
    const target = skipTargetFor(db, "a");
    expect(target.id).toBe(round);
    expect(myRounds(db, "a")).toEqual([]);
    expect(db.prepare("SELECT COUNT(*) AS n FROM round_participants").get()).toEqual({ n: 0 });
    joinRound(db, target.id, "a", "PASS");
    expect(myRounds(db, "a").map(row => row.id)).toEqual([round]);
    const next = skipTargetFor(db, "a");
    expect(next.id).not.toBe(round);
    expect(myRounds(db, "a").map(row => row.id)).toEqual([round]);
  });
});
