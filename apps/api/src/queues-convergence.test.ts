import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDatabase, type AppDatabase } from "./db.js";
import { randomUUID } from "node:crypto";
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

  // AUDITORIA / estes dois fixavam o renomeamento (fechar a 1 movia a 3 para 1). A
  // garantia que importa — a 2 nunca se mexe e a contagem fica certa — continua aqui.
  // O que muda: ninguem e renomeado; o numero 1 volta a existir como fila NOVA.
  it("fechar a 1 não renomeia ninguém; o número 1 volta como fila nova", () => {
    const one = initial(), two = openRound(db), three = openRound(db);
    closeRound(db, one);
    expect(label(two), "a 2 nunca se mexe").toBe(2);
    expect(label(three), "a 3 continua sendo a 3").toBe(3);
    const nova = activeRounds(db).find(row => row.displayNumber === 1);
    expect(nova, "o número 1 volta a existir").toBeTruthy();
    expect(nova!.id).not.toBe(one);                     // e e outra fila, nao a antiga
    expect(nova!.status).toBe("OPEN");
    expect(activeRounds(db)).toHaveLength(3);
  });

  it("o mesmo quando todas estão READY: nasce uma 1 aberta e as outras ficam onde estão", () => {
    const one = initial(), two = openRound(db), three = openRound(db);
    db.prepare("UPDATE rounds SET status='READY'").run();
    closeRound(db, one);
    expect(label(two)).toBe(2);
    expect(label(three)).toBe(3);
    expect(activeRounds(db).map(row => [row.displayNumber, row.status]))
      .toEqual([[1, "OPEN"], [2, "READY"], [3, "READY"]]);
  });

  // AUDITORIA / REGRA NOVA, DECIDIDA PELO DONO: o numero da fila e IDENTIDADE.
  //
  // Este teste fixava o oposto — fechar a 2 renomeava a 3 para 2, mantendo a numeracao
  // compacta. A intencao era evitar buracos; o efeito era o numero trocar de dono
  // enquanto as pessoas usavam a fila, e todo aviso que o bot ja tinha mandado ("Novo
  // video na sala 1, posicao 5") passava a apontar para outra fila. Foi a mensagem
  // contraditoria que o dono fotografou no grupo.
  it("fechar a 2 NAO renomeia a 3 — cada fila morre com o número com que nasceu", () => {
    const one = initial(), two = openRound(db), three = openRound(db);
    expect([label(one), label(two), label(three)]).toEqual([1, 2, 3]);
    closeRound(db, two);
    expect(label(one), "a 1 nunca se move").toBe(1);
    expect(label(three), "a 3 continua sendo a 3").toBe(3);
    // O buraco no 2 e aceitavel e temporario: a proxima fila nova o ocupa.
    expect(activeRounds(db).map(row => row.displayNumber)).toEqual([1, 3]);
    expect(label(openRound(db)), "fila nova pega o menor número livre").toBe(2);
  });

  it("uma 2 sozinha continua 2 e a fila nova ocupa o 1 livre", () => {
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
  // AUDITORIA / o ROOT tem Pular ILIMITADO. Sem esta trava, cada toque dele no botao
  // abria mais uma fila — foi assim que a producao ganhou filas 3 e 4 que participante
  // nenhum conseguia encher, diluindo o grupo ate nenhuma fechar.
  it("ROOT com Pular infinito NAO fabrica filas, mas participante que paga continua criando", () => {
    const round = initial();
    joinRound(db, round, "a", "PASS");
    // participante comum: a promessa do item pago fica intacta
    const nova = skipTargetFor(db, "a");
    expect(nova.id).not.toBe(round);

    // mesmo cenario, agora como ROOT
    const agora = new Date().toISOString();
    db.prepare(`INSERT INTO owner_access (id,user_id,phone,normalized_name,role,active,created_at,updated_at)
      VALUES (?,?,?,?,'ROOT_OWNER',1,?,?)`).run(randomUUID(), "b", "15550000002", "b", agora, agora);
    for (const r of activeRounds(db)) joinRound(db, r.id, "b", "PASS");
    const antes = activeRounds(db).length;
    expect(() => skipTargetFor(db, "b")).toThrowError(QueueEntryError);
    try { skipTargetFor(db, "b"); } catch (error) { expect(error).toMatchObject({ code: "QUEUE_ROOT_NO_SPAWN", statusCode: 409 }); }
    expect(activeRounds(db).length, "o ROOT nao pode ter criado fila").toBe(antes);
  });
});
