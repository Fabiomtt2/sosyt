import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createDatabase, type AppDatabase } from "./db.js";
import { randomUUID } from "node:crypto";

describe("Owner e acesso por grupo", () => {
  let db: AppDatabase, app: Awaited<ReturnType<typeof buildApp>>, ownerToken: string;
  const ownerBody = { name: "Fábio", identifier: "fabio", groupCode: "#", secret: "test-owner-secret-32-characters-long" };
  const authorization = (token: string) => ({ authorization: `Bearer ${token}` });
  beforeEach(async () => {
    db = createDatabase(":memory:");
    app = await buildApp(loadConfig({
      NODE_ENV: "test", DATABASE_PATH: ":memory:", AUTH_DEV_MODE: "true", PAYMENTS_DEV_MODE: "true", REQUIRE_GROUP_MEMBERSHIP: "true",
      OWNER_FABIO_ID: ownerBody.identifier, OWNER_FABIO_SECRET: ownerBody.secret, OWNER_RAFAEL_SECRET:"rafael-own-secret-32-characters-long", OWNER_WHATSAPP: "5571999999000",
      MERCADO_PAGO_ACCESS_TOKEN: undefined, YOUTUBE_API_KEY: undefined
    }), db);
    const login = await app.inject({ method: "POST", url: "/admin/login", payload: ownerBody });
    expect(login.statusCode).toBe(200); ownerToken = login.json().token;
  });
  afterEach(async () => { await app.close(); db.close(); });
  const requestCode = (phone = "5571999999001", groupCode = "1") => app.inject({ method: "POST", url: "/auth/request-code", payload: { name: "Pessoa", phone, groupCode } });
  const approve = (phone = "5571999999001", groupCode = "1") => app.inject({ method: "POST", url: "/admin/members", headers: authorization(ownerToken), payload: { phone, groupCode } });
  async function participant() {
    await approve(); const code = (await requestCode()).json().devCode;
    const login = await app.inject({ method: "POST", url: "/auth/verify", payload: { phone: "5571999999001", code } });
    expect(login.statusCode).toBe(200); return login.json().token as string;
  }
  it("hashtag sozinha não concede privilégio e Owner não usa sessão de participante", async () => {
    expect((await app.inject({ method: "POST", url: "/admin/login", payload: { ...ownerBody, secret: "wrong" } })).statusCode).toBe(401);
    expect((await requestCode("5571999999001", "0")).statusCode).toBe(400);
    expect((await app.inject({ method: "GET", url: "/dashboard", headers: authorization(ownerToken) })).statusCode).toBe(401);
    const token = await participant();
    expect((await app.inject({ method: "GET", url: "/admin/overview", headers: authorization(token) })).statusCode).toBe(401);
  });
  it("Fábio e Rafael têm credenciais e sujeitos separados; nome/# não bastam", async () => {
    expect((await app.inject({method:"POST",url:"/admin/login",payload:{...ownerBody,name:"Rafael"}})).statusCode).toBe(401);
    const rafael=await app.inject({method:"POST",url:"/admin/login",payload:{name:"Rafael",identifier:"rafael",groupCode:"#",secret:"rafael-own-secret-32-characters-long"}});
    expect(rafael.statusCode).toBe(200);
    expect((await app.inject({url:"/admin/overview",headers:authorization(rafael.json().token)})).json().owner).toEqual({name:"Rafael",groupCode:"#"});
    expect((await app.inject({method:"POST",url:"/admin/login",payload:{...ownerBody,groupCode:"0"}})).statusCode).toBe(400);
    const forged=app.jwt.sign({sub:"owner:rafael",purpose:"owner",aud:"conexao-owner",jti:"wrong-version"});
    expect((await app.inject({url:"/admin/overview",headers:authorization(forged)})).statusCode).toBe(401);
  });
  it("cadastro exige aprovação do número no grupo informado", async () => {
    expect((await requestCode()).statusCode).toBe(403); await approve();
    expect((await requestCode("5571999999001", "2")).statusCode).toBe(403);
    expect((await requestCode()).statusCode).toBe(200);
  });
  it("solicitação registra pessoa uma vez, gera contato e aprovação libera login", async () => {
    const body = { name: "Pessoa Solicitante", phone: "5571999999001", groupCode: "2", consent: true };
    const result = await app.inject({ method: "POST", url: "/participation/request", payload: body });
    expect(result.statusCode).toBe(200); expect(result.json().whatsappUrl).toContain("https://wa.me/5571999999000");
    await app.inject({ method: "POST", url: "/participation/request", payload: body });
    const overview = (await app.inject({ method: "GET", url: "/admin/overview", headers: authorization(ownerToken) })).json();
    expect(overview.metrics.requestsTotal).toBe(1); expect(overview.metrics.pendingRequests).toBe(1);
    const decision = await app.inject({ method: "POST", url: `/admin/requests/${overview.requests[0].id}/decision`, headers: authorization(ownerToken), payload: { status: "APPROVED", groupCode: "2" } });
    expect(decision.statusCode).toBe(200);
    expect((await requestCode("5571999999001", "2")).statusCode).toBe(200);
  });
  it("revogação e grupo desativado interrompem sessão existente", async () => {
    const token = await participant();
    expect((await app.inject({ method: "GET", url: "/dashboard", headers: authorization(token) })).statusCode).toBe(200);
    await app.inject({ method: "POST", url: "/admin/groups", headers: authorization(ownerToken), payload: { code: "1", enabled: false } });
    expect((await app.inject({ method: "GET", url: "/dashboard", headers: authorization(token) })).statusCode).toBe(403);
    await app.inject({ method: "POST", url: "/admin/groups", headers: authorization(ownerToken), payload: { code: "1", enabled: true } });
    await app.inject({ method: "DELETE", url: "/admin/members/5571999999001", headers: authorization(ownerToken) });
    expect((await app.inject({ method: "GET", url: "/dashboard", headers: authorization(token) })).statusCode).toBe(403);
  });
  it("troca de grupo invalida sessão com grupo anterior", async () => {
    const token = await participant(); await approve("5571999999001", "2");
    expect((await app.inject({ method: "GET", url: "/dashboard", headers: authorization(token) })).statusCode).toBe(403);
  });
  it("Owner não pode cadastrar grupo zero; consentimento é obrigatório", async () => {
    expect((await app.inject({ method: "POST", url: "/admin/groups", headers: authorization(ownerToken), payload: { code: "0" } })).statusCode).toBe(400);
    expect((await app.inject({ method: "POST", url: "/participation/request", payload: { name: "Pessoa", phone: "5571999999001" } })).statusCode).toBe(400);
    expect((await app.inject({ method: "POST", url: "/admin/login", payload: { ...ownerBody, name: "Outra Pessoa" } })).statusCode).toBe(401);
  });
  it("indicadores contam exportação real e excluem dinheiro simulado", async () => {
    const token = await participant();
    const view = (await app.inject({ method: "GET", url: "/dashboard", headers: authorization(token) })).json();
    const userId = view.user.id, now = new Date().toISOString();
    const cycleId = view.openRound.id;
    db.prepare("UPDATE rounds SET status='READY',completed_at=? WHERE id=?").run(now,cycleId);
    db.prepare("INSERT INTO playlist_exports (id,round_id,user_id,status,youtube_playlist_id,created_at,updated_at) VALUES (?,?,?,'SUCCESS','test-playlist',?,?)").run(randomUUID(),cycleId,userId,now,now);
    for (const provider of ["DEMO","MERCADO_PAGO"]) db.prepare("INSERT INTO payments (id,user_id,provider,status,amount_cents,credits_millis,extra_passes,created_at,approved_at) VALUES (?,?,?,'APPROVED',2000,20000,1,?,?)").run(randomUUID(),userId,provider,now,now);
    const stats = (await app.inject({ method: "GET", url: "/admin/overview", headers: authorization(ownerToken) })).json().metrics;
    expect(stats).toMatchObject({ registeredUsers: 1, activeUsers30d: 1, playlistsCreatedMonth: 1, completedCyclesMonth: 1, approvedPurchasesMonth: 1, demoPurchasesMonth: 1, revenueCentsMonth: 2000 });
  });
  it("exportação CSV é exclusiva do Owner", async () => {
    const token = await participant();
    expect((await app.inject({ method: "GET", url: "/admin/users.csv", headers: authorization(token) })).statusCode).toBe(401);
    const csv = await app.inject({ method: "GET", url: "/admin/users.csv", headers: authorization(ownerToken) });
    expect(csv.statusCode).toBe(200); expect(csv.body).toContain("5571999999001");
  });
});
