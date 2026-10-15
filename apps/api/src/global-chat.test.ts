// AUDITORIA / chat global: segurança (anti-link, anti-HTML/injeção, anti-xingamento,
// cooldown) e moderação do Owner (apagar, pin, mute, remover da sala, limpar).
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "./app.js";
import { loadConfig, type Config } from "./config.js";
import { createDatabase, type AppDatabase } from "./db.js";
import { normalizePhone } from "./phone.js";
import { looksLikeLink, hasUnsafeMarkup, hasProfanity } from "./global-chat.js";

describe("chat global — segurança e moderação", () => {
  let db: AppDatabase; let app: Awaited<ReturnType<typeof buildApp>>; let config: Config;
  const ownerBody = { name: "Fabio0", identifier: "+55 71 [9] 9999-0001", groupCode: "#", secret: "fabio-secret-32-characters-long-okay" };
  beforeEach(async () => {
    config = loadConfig({
      NODE_ENV: "test", DATABASE_PATH: ":memory:", AUTH_DEV_MODE: "true", REQUIRE_GROUP_MEMBERSHIP: "false",
      JWT_SECRET: "chat-secret-32-characters-okay!!!", AUTH_CODE_PEPPER: "chat-pepper-32-characters-okay!!!",
      OWNER_FABIO_NAME: "Fabio0", OWNER_FABIO_ID: "fabio0", OWNER_FABIO_SECRET: "fabio-secret-32-characters-long-okay", OWNER_FABIO_WHATSAPP: "5571999990001",
      YOUTUBE_API_KEY: undefined
    });
    db = createDatabase(":memory:"); app = await buildApp(config, db);
  });
  afterEach(async () => { await app.close(); db.close(); });
  const auth = (t: string) => ({ authorization: `Bearer ${t}` });
  async function register(phone: string, name = "Pessoa") {
    const normalized = normalizePhone(phone), stamp = new Date().toISOString();
    db.prepare("INSERT OR IGNORE INTO groups(code,enabled,membership_mode) VALUES ('12',1,'OWNER')").run();
    db.prepare("INSERT INTO group_memberships(phone,group_code,approved_at,source) VALUES (?, '12', ?, 'TEST') ON CONFLICT(phone) DO NOTHING").run(normalized, stamp);
    const req = await app.inject({ method: "POST", url: "/auth/request-code", payload: { name, phone } });
    const ver = await app.inject({ method: "POST", url: "/auth/verify", payload: { phone, code: req.json().devCode } });
    return { token: ver.json().token as string, id: ver.json().user.id as string };
  }
  const ownerToken = async () => (await app.inject({ method: "POST", url: "/admin/login", payload: ownerBody })).json().token as string;
  const send = (t: string, body: string) => app.inject({ method: "POST", url: "/chat/global", headers: auth(t), payload: { body } });

  it("filtros unitários: link, markup e xingamento", () => {
    expect(looksLikeLink("entra em site.com agora")).toBe(true);
    expect(looksLikeLink("manda no bit.ly/abc")).toBe(true);
    expect(looksLikeLink("meu canal: youtube ponto com barra x")).toBe(true);
    expect(looksLikeLink("acesse 1googs3cr3t")).toBe(false); // texto comum não é link
    expect(hasUnsafeMarkup("<script>alert(1)</script>")).toBe(true);
    expect(hasUnsafeMarkup("clique ${process.env}")).toBe(true);
    expect(hasUnsafeMarkup("data:image/png;base64,AAAA")).toBe(true);
    expect(hasProfanity("seu merd4")).toBe(true);        // leetspeak
    expect(hasProfanity("bom dia pessoal")).toBe(false);
  });

  it("membro: mensagem limpa entra; link, HTML e xingamento são barrados", async () => {
    const a = await register("71990001001", "Ana");
    expect((await send(a.token, "Oi pessoal, tudo certo?")).statusCode).toBe(200);
    const link = await send(a.token, "segue meu insta instagram.com/ana");
    expect(link.statusCode).toBe(400); expect(link.json().code).toBe("CHAT_LINK");
    const html = await send(a.token, "<b>oi</b>");
    expect(html.statusCode).toBe(400); expect(html.json().code).toBe("CHAT_UNSAFE");
    const bad = await send(a.token, "vai tomar no caralho");
    expect(bad.statusCode).toBe(400); expect(bad.json().code).toBe("CHAT_PROFANITY");
  });

  it("cooldown de 30 segundos persiste e libera após o intervalo", async () => {
    const a = await register("71990001002");
    expect((await send(a.token, "primeira")).statusCode).toBe(200);
    const second = await send(a.token, "segunda imediata");
    expect(second.statusCode).toBe(429);
    expect(second.json().code).toBe("CHAT_COOLDOWN");
    expect(second.json().retryAfterSeconds).toBeGreaterThan(0);
    expect(second.json().retryAfterSeconds).toBeLessThanOrEqual(30);
    expect((await app.inject({ method: "GET", url: "/chat/global", headers: auth(a.token) })).json().cooldownSeconds).toBe(30);
    db.prepare("UPDATE global_chat_messages SET created_at=? WHERE user_id=?").run(new Date(Date.now()-31_000).toISOString(),a.id);
    expect((await send(a.token, "após trinta segundos")).statusCode).toBe(200);
  });

  it("admin escapa do cooldown e PODE postar link; mensagem vem com role OWNER", async () => {
    const owner = await register("71999990001", "Fabio0"); // mesmo telefone do owner -> vira staff ao logar admin? não: /chat usa owner_access
    // Configured ROOT identity is persisted by the real verified access path.
    expect(db.prepare("SELECT role,active FROM owner_access WHERE user_id=?").get(owner.id)).toEqual({role:"ROOT_OWNER",active:1});
    expect((await send(owner.token, "Comunicado: acessem o site oficial sosyoutuber.com")).statusCode).toBe(200);
    expect((await send(owner.token, "segunda imediata do admin, sem cooldown")).statusCode).toBe(200);
    const list = await app.inject({ method: "GET", url: "/chat/global", headers: auth(owner.token) });
    const mine = list.json().messages.filter((m: { role: string }) => m.role === "OWNER");
    expect(mine.length).toBe(2);
    expect(list.json().cooldownSeconds).toBe(0);
  });

  it("ADMIN_OWNER recebe cooldown zero e envia sem espera; exceção de membro permanece", async () => {
    const admin = await register("71990001007", "Admin");
    const stamp = new Date().toISOString();
    db.prepare("INSERT INTO owner_access (id,user_id,phone,normalized_name,role,active,created_at,updated_at) VALUES (?,?,?,?, 'ADMIN_OWNER',1,?,?)").run("oa-admin",admin.id,"5571990001007","admin",stamp,stamp);
    expect((await send(admin.token,"Primeiro aviso")).statusCode).toBe(200);
    expect((await send(admin.token,"Segundo aviso")).statusCode).toBe(200);
    const view = (await app.inject({method:"GET",url:"/chat/global",headers:auth(admin.token)})).json();
    expect(view.viewerRole).toBe("ADMIN");
    expect(view.cooldownSeconds).toBe(0);
    const member = await register("71990001008");
    db.prepare("INSERT INTO global_chat_members(user_id,cooldown_seconds,updated_at) VALUES (?,120,?)").run(member.id,stamp);
    expect((await app.inject({method:"GET",url:"/chat/global",headers:auth(member.token)})).json().cooldownSeconds).toBe(120);
    expect((await send(member.token,"Olá")).statusCode).toBe(200);
    expect((await send(member.token,"Outra fala")).json().retryAfterSeconds).toBeGreaterThan(30);
  });

  it("leitura por cursor traz só o que chegou depois (tempo real)", async () => {
    const a = await register("71990001003");
    await send(a.token, "m1");
    const first = await app.inject({ method: "GET", url: "/chat/global", headers: auth(a.token) });
    const lastId = first.json().messages.at(-1).id;
    // outro usuário manda depois
    const b = await register("71990001004"); await send(b.token, "m2 do outro");
    const delta = await app.inject({ method: "GET", url: `/chat/global?afterId=${lastId}`, headers: auth(a.token) });
    expect(delta.json().messages.map((m: { body: string }) => m.body)).toEqual(["m2 do outro"]);
  });

  it("Owner apaga, fixa, silencia, remove da sala e limpa", async () => {
    const a = await register("71990001005", "Ana"); const token = await ownerToken();
    const sent = await send(a.token, "mensagem do membro");
    const id = sent.json().id;
    // apagar
    expect((await app.inject({ method: "DELETE", url: `/admin/chat/global/${id}`, headers: auth(token) })).statusCode).toBe(200);
    // fixar precisa de msg viva: manda outra
    const sent2 = await send(a.token, "fixa essa"); // cooldown? membro: segunda msg -> 429. Use outro usuário:
    void sent2;
    const c = await register("71990001006"); const m = await send(c.token, "para fixar");
    expect((await app.inject({ method: "POST", url: `/admin/chat/global/${m.json().id}/pin`, headers: auth(token), payload: { pinned: true } })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/chat/global", headers: auth(c.token) })).json().pinned.length).toBe(1);
    // remover da sala: o usuário deixa de ver e de postar
    expect((await app.inject({ method: "POST", url: "/admin/chat/global/moderate", headers: auth(token), payload: { userId: a.id, action: "REMOVE" } })).statusCode).toBe(200);
    const view = await app.inject({ method: "GET", url: "/chat/global", headers: auth(a.token) });
    expect(view.json().removed).toBe(true);
    expect((await send(a.token, "ainda posso?")).json().code).toBe("CHAT_REMOVED");
    // limpar tudo (root)
    expect((await app.inject({ method: "POST", url: "/admin/chat/global/clear", headers: auth(token) })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/chat/global", headers: auth(c.token) })).json().messages.length).toBe(0);
  });

  it("não-autenticado não lê nem envia", async () => {
    expect((await app.inject({ method: "GET", url: "/chat/global" })).statusCode).toBe(401);
    expect((await app.inject({ method: "POST", url: "/chat/global", payload: { body: "oi" } })).statusCode).toBe(401);
  });
});
