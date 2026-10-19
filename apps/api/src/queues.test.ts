// AUDITORIA / multi-fila: numeração confirmada pelo owner, visibilidade restrita,
// item "Pular" (nunca desperdiçado) e presentes de inventário.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "./app.js";
import { loadConfig, type Config } from "./config.js";
import { createDatabase, type AppDatabase } from "./db.js";
import { normalizePhone } from "./phone.js";
import { activeRounds, openRound, closeRound, myRounds, joinRound, lowestFreeNumber } from "./queues.js";
import { grantItem, itemQuantity, giftItem, ITEM_SKIP } from "./inventory.js";

describe("multi-fila", () => {
  let db: AppDatabase; let app: Awaited<ReturnType<typeof buildApp>>; let config: Config;
  beforeEach(async () => {
    config = loadConfig({ NODE_ENV: "test", DATABASE_PATH: ":memory:", AUTH_DEV_MODE: "true", REQUIRE_GROUP_MEMBERSHIP: "false",
      JWT_SECRET: "queues-secret-32-characters-ok!!!", AUTH_CODE_PEPPER: "queues-pepper-32-characters-ok!!!", YOUTUBE_API_KEY: undefined });
    db = createDatabase(":memory:"); app = await buildApp(config, db);
  });
  afterEach(async () => { await app.close(); db.close(); });
  const auth = (t: string) => ({ authorization: `Bearer ${t}` });
  async function register(phone: string) {
    const normalized = normalizePhone(phone), stamp = new Date().toISOString();
    db.prepare("INSERT OR IGNORE INTO groups(code,enabled,membership_mode) VALUES ('12',1,'OWNER')").run();
    db.prepare("INSERT INTO group_memberships(phone,group_code,approved_at,source) VALUES (?, '12', ?, 'TEST') ON CONFLICT(phone) DO NOTHING").run(normalized, stamp);
    const req = await app.inject({ method: "POST", url: "/auth/request-code", payload: { name: "Pessoa", phone } });
    const ver = await app.inject({ method: "POST", url: "/auth/verify", payload: { phone, code: req.json().devCode } });
    return { token: ver.json().token as string, id: ver.json().user.id as string };
  }
  const numbers = () => activeRounds(db).map((r) => r.displayNumber);

  // ---- NUMERAÇÃO (a regra confirmada) ----
  it("fila nova ocupa o MENOR número livre", () => {
    expect(numbers()).toEqual([1]);          // a inicial
    openRound(db); openRound(db);
    expect(numbers()).toEqual([1, 2, 3]);
  });

  it("caso (B): encerra a 2 com outra OPEN viva -> a 3 desce para 2", () => {
    openRound(db); openRound(db);                       // 1,2,3 (a 1 e OPEN)
    const r2 = activeRounds(db).find((r) => r.displayNumber === 2)!;
    closeRound(db, r2.id);                               // existe OPEN -> compacta
    expect(numbers()).toEqual([1, 2]);
    // a antiga 3 e quem agora ocupa o 2
    const r3 = activeRounds(db).find((r) => r.displayNumber === 2)!;
    expect(r3.sequence).toBe(3);
  });

  it("caso (C): encerra a 1 -> antiga 3 ocupa 1, 2 continua e nova OPEN ocupa 3", () => {
    openRound(db); openRound(db);                        // 1(OPEN),2,3
    db.prepare("UPDATE rounds SET status='READY' WHERE display_number IN (2,3)").run();
    const r1 = activeRounds(db).find((r) => r.displayNumber === 1)!;
    closeRound(db, r1.id);                               // sem OPEN -> cria nova no menor livre (1)
    expect(numbers()).toEqual([1, 2, 3]);
    const novaUm = activeRounds(db).find((r) => r.displayNumber === 1)!;
    expect(novaUm.status).toBe("READY");
    expect(novaUm.sequence).toBe(3);
    const novaTres=activeRounds(db).find(r=>r.displayNumber===3)!;
    expect(novaTres.status).toBe("OPEN");
    expect(novaTres.sequence).toBeGreaterThan(3);          // e mesmo a fila nova
    const dois = activeRounds(db).find((r) => r.displayNumber === 2)!;
    expect(dois.sequence).toBe(2);                       // a 2 MANTEVE o numero
  });

  it("lowestFreeNumber enxerga buracos", () => {
    openRound(db); openRound(db);
    const r2 = activeRounds(db).find((r) => r.displayNumber === 2)!;
    db.prepare("UPDATE rounds SET closed_at=? WHERE id=?").run(new Date().toISOString(), r2.id);
    expect(lowestFreeNumber(db)).toBe(2);
  });

  // ---- VISIBILIDADE ----
  it("só vejo as filas em que estou; quem está na 1 NÃO vê a 2", async () => {
    const a = await register("71991000001");
    const r1 = activeRounds(db)[0];
    joinRound(db, r1.id, a.id, "FREE");
    openRound(db);                                       // existe uma Fila 2 no sistema
    const view = await app.inject({ method: "GET", url: "/queues/mine", headers: auth(a.token) });
    expect(view.json().queues.map((q: { number: number }) => q.number)).toEqual([1]);
    expect(view.json().canSkip).toBe(false);
  });

  // ---- ITEM "PULAR" ----
  it("sem o item, não entra em outra fila", async () => {
    const a = await register("71991000002");
    joinRound(db, activeRounds(db)[0].id, a.id, "FREE");
    const res = await app.inject({ method: "POST", url: "/queues/skip", headers: auth(a.token) });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("SKIP_REQUIRED");
  });

  it("com o item entra na próxima fila livre e passa a ver as DUAS", async () => {
    const a = await register("71991000003");
    joinRound(db, activeRounds(db)[0].id, a.id, "FREE");
    openRound(db);                                       // Fila 2 existe e esta livre
    grantItem(db, { userId: a.id, itemCode: ITEM_SKIP, delta: 1, kind: "OWNER_ADJUST" });
    const res = await app.inject({ method: "POST", url: "/queues/skip", headers: auth(a.token) });
    expect(res.statusCode).toBe(200);
    expect(res.json().queue.number).toBe(2);
    expect(itemQuantity(db, a.id, ITEM_SKIP)).toBe(0);   // consumiu 1
    const view = await app.inject({ method: "GET", url: "/queues/mine", headers: auth(a.token) });
    expect(view.json().queues.map((q: { number: number }) => q.number)).toEqual([1, 2]);
  });

  it("sem fila livre o Pular CRIA uma nova — o item nunca é desperdiçado", async () => {
    const a = await register("71991000004");
    joinRound(db, activeRounds(db)[0].id, a.id, "FREE"); // so existe a Fila 1, e ele ja esta nela
    expect(activeRounds(db).length).toBe(1);
    grantItem(db, { userId: a.id, itemCode: ITEM_SKIP, delta: 1, kind: "OWNER_ADJUST" });
    const res = await app.inject({ method: "POST", url: "/queues/skip", headers: auth(a.token) });
    expect(res.statusCode).toBe(200);
    expect(res.json().queue.number).toBe(2);             // criou a Fila 2
    expect(activeRounds(db).length).toBe(2);
    expect(myRounds(db, a.id).map((r) => r.displayNumber)).toEqual([1, 2]);
  });

  it("segundo Pular leva a uma fila em que ele AINDA não está", async () => {
    const a = await register("71991000005");
    joinRound(db, activeRounds(db)[0].id, a.id, "FREE");
    grantItem(db, { userId: a.id, itemCode: ITEM_SKIP, delta: 2, kind: "OWNER_ADJUST" });
    const first = await app.inject({ method: "POST", url: "/queues/skip", headers: auth(a.token) });
    const second = await app.inject({ method: "POST", url: "/queues/skip", headers: auth(a.token) });
    expect(first.json().queue.number).toBe(2);
    expect(second.json().queue.number).toBe(3);          // nao repete a 2
    expect(myRounds(db, a.id).map((r) => r.displayNumber)).toEqual([1, 2, 3]);
  });

  // ---- PRESENTES ----
  it("presentear move o item entre inventários, sem criar nem sumir", () => {
    const now = new Date().toISOString();
    for (const id of ["u-x", "u-y"]) db.prepare("INSERT INTO users(id,name,phone,group_code,created_at,updated_at) VALUES (?,?,?,?,?,?)").run(id, id, "55719" + id.slice(-1).repeat(8), "1", now, now);
    grantItem(db, { userId: "u-x", itemCode: ITEM_SKIP, delta: 3, kind: "OWNER_ADJUST" });
    giftItem(db, "u-x", "u-y", ITEM_SKIP, 2);
    expect(itemQuantity(db, "u-x", ITEM_SKIP)).toBe(1);
    expect(itemQuantity(db, "u-y", ITEM_SKIP)).toBe(2);
  });

  it("não presenteia o que não tem, nem para si mesmo", () => {
    const now = new Date().toISOString();
    db.prepare("INSERT INTO users(id,name,phone,group_code,created_at,updated_at) VALUES ('u-z','z','5571900000099','1',?,?)").run(now, now);
    expect(() => giftItem(db, "u-z", "u-z", ITEM_SKIP, 1)).toThrow(/si mesmo/i);
    expect(() => giftItem(db, "u-z", "u-x", ITEM_SKIP, 1)).toThrow();
  });
});
