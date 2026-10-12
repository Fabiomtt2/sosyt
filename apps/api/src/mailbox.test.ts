// AUDITORIA / correio interno: DMs, avisos globais do Owner e moderação.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "./app.js";
import { loadConfig, type Config } from "./config.js";
import { createDatabase, type AppDatabase } from "./db.js";
import { normalizePhone } from "./phone.js";

describe("correio interno", () => {
  let db: AppDatabase; let app: Awaited<ReturnType<typeof buildApp>>; let config: Config;
  const ownerBody = { name: "Fabio0", identifier: "+55 71 [9] 9999-0001", groupCode: "#", secret: "fabio-secret-32-characters-long-okay" };
  beforeEach(async () => {
    config = loadConfig({
      NODE_ENV: "test", DATABASE_PATH: ":memory:", AUTH_DEV_MODE: "true", REQUIRE_GROUP_MEMBERSHIP: "false",
      JWT_SECRET: "mail-secret-32-characters-okay!!!", AUTH_CODE_PEPPER: "mail-pepper-32-characters-okay!!!",
      OWNER_FABIO_NAME: "Fabio0", OWNER_FABIO_ID: "fabio0", OWNER_FABIO_SECRET: "fabio-secret-32-characters-long-okay", OWNER_FABIO_WHATSAPP: "5571999990001",
      YOUTUBE_API_KEY: undefined
    });
    db = createDatabase(":memory:");
    app = await buildApp(config, db);
  });
  afterEach(async () => { await app.close(); db.close(); });
  const auth = (t: string) => ({ authorization: `Bearer ${t}` });

  async function register(phone: string, name = "Pessoa") {
    const normalized = normalizePhone(phone), stamp = new Date().toISOString();
    db.prepare("INSERT OR IGNORE INTO groups(code,enabled,membership_mode) VALUES ('12',1,'OWNER')").run();
    db.prepare("INSERT INTO group_memberships(phone,group_code,approved_at,source) VALUES (?, '12', ?, 'TEST') ON CONFLICT(phone) DO NOTHING").run(normalized, stamp);
    const req = await app.inject({ method: "POST", url: "/auth/request-code", payload: { name, phone } });
    const ver = await app.inject({ method: "POST", url: "/auth/verify", payload: { phone, code: req.json().devCode } });
    expect(ver.statusCode).toBe(200);
    return { token: ver.json().token as string, id: ver.json().user.id as string };
  }
  const ownerToken = async () => (await app.inject({ method: "POST", url: "/admin/login", payload: ownerBody })).json().token as string;

  it("DM chega na caixa do destinatário com identidade e conta como não-lido", async () => {
    const a = await register("71990000001", "Ana"); const b = await register("71990000002", "Bia");
    const sent = await app.inject({ method: "POST", url: "/mail/dm", headers: auth(a.token), payload: { toUserId: b.id, body: "Oi Bia!" } });
    expect(sent.statusCode).toBe(200);
    const inbox = await app.inject({ method: "GET", url: "/mail/inbox", headers: auth(b.token) });
    expect(inbox.json().unread).toBe(1);
    expect(inbox.json().threads[0]).toMatchObject({ lastBody: "Oi Bia!", unread: 1 });
    expect(inbox.json().threads[0].with).toMatchObject({ name: "Ana", groupCode: "12" });
  });

  it("abrir o thread marca como lido e mostra as duas pontas em ordem", async () => {
    const a = await register("71990000003", "Ana"); const b = await register("71990000004", "Bia");
    await app.inject({ method: "POST", url: "/mail/dm", headers: auth(a.token), payload: { toUserId: b.id, body: "1" } });
    await app.inject({ method: "POST", url: "/mail/dm", headers: auth(b.token), payload: { toUserId: a.id, body: "2" } });
    const thread = await app.inject({ method: "GET", url: `/mail/thread/${a.id}`, headers: auth(b.token) });
    expect(thread.json().messages.map((m: { body: string }) => m.body)).toEqual(["1", "2"]);
    expect((await app.inject({ method: "GET", url: "/mail/unread-count", headers: auth(b.token) })).json().unread).toBe(0);
  });

  it("aviso global do Owner chega a todos os correios", async () => {
    const a = await register("71990000005"); const b = await register("71990000006");
    const token = await ownerToken();
    const bc = await app.inject({ method: "POST", url: "/admin/mail/broadcast", headers: auth(token), payload: { body: "Bem-vindos à comunidade!" } });
    expect(bc.json().delivered).toBe(2);
    expect((await app.inject({ method: "GET", url: "/mail/unread-count", headers: auth(a.token) })).json().unread).toBe(1);
    const thread = await app.inject({ method: "GET", url: "/mail/thread/broadcast", headers: auth(b.token) });
    expect(thread.json().messages[0]).toMatchObject({ role: "OWNER", body: "Bem-vindos à comunidade!" });
  });

  it("não envia para si mesmo, destinatário inexistente ou corpo vazio", async () => {
    const a = await register("71990000007");
    expect((await app.inject({ method: "POST", url: "/mail/dm", headers: auth(a.token), payload: { toUserId: a.id, body: "eu" } })).statusCode).toBe(400);
    expect((await app.inject({ method: "POST", url: "/mail/dm", headers: auth(a.token), payload: { toUserId: "nao-existe-000", body: "oi" } })).statusCode).toBe(404);
    expect((await app.inject({ method: "POST", url: "/mail/dm", headers: auth(a.token), payload: { toUserId: a.id, body: "" } })).statusCode).toBe(400);
  });

  it("DM exige autenticação", async () => {
    const b = await register("71990000008");
    expect((await app.inject({ method: "POST", url: "/mail/dm", payload: { toUserId: b.id, body: "oi" } })).statusCode).toBe(401);
  });

  it("Owner modera: lista e remove (soft) uma mensagem", async () => {
    const a = await register("71990000009", "Ana"); const b = await register("71990000010", "Bia");
    const sent = await app.inject({ method: "POST", url: "/mail/dm", headers: auth(a.token), payload: { toUserId: b.id, body: "indevida" } });
    const token = await ownerToken();
    const listed = await app.inject({ method: "GET", url: "/admin/mail", headers: auth(token) });
    expect(listed.json().messages.some((m: { body: string }) => m.body === "indevida")).toBe(true);
    const del = await app.inject({ method: "DELETE", url: `/admin/mail/${sent.json().id}`, headers: auth(token) });
    expect(del.statusCode).toBe(200);
    // removida não aparece mais para o destinatário
    expect((await app.inject({ method: "GET", url: "/mail/inbox", headers: auth(b.token) })).json().unread).toBe(0);
  });
});
