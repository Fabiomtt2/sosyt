import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createDatabase, type AppDatabase } from "./db.js";
import { randomUUID } from "node:crypto";

describe("Owner e acesso por grupo", () => {
  let db: AppDatabase, app: Awaited<ReturnType<typeof buildApp>>, ownerToken: string;
  const ownerBody = { name: "Fabio0", identifier: "+55 71 [9]9999-0001", groupCode: "#", secret: "test-owner-secret-32-characters-long" };
  const authorization = (token: string) => ({ authorization: `Bearer ${token}` });
  beforeEach(async () => {
    db = createDatabase(":memory:");
    app = await buildApp(loadConfig({
      NODE_ENV: "test", DATABASE_PATH: ":memory:", AUTH_DEV_MODE: "true", PAYMENTS_DEV_MODE: "true", REQUIRE_GROUP_MEMBERSHIP: "true",
      OWNER_FABIO_NAME: ownerBody.name, OWNER_FABIO_ID: "fabio0", OWNER_FABIO_SECRET: ownerBody.secret, OWNER_FABIO_WHATSAPP: "5571999990001",
      OWNER_RAFAEL_NAME: "Rafael0", OWNER_RAFAEL_ID: "rafael0", OWNER_RAFAEL_SECRET:"rafael-own-secret-32-characters-long", OWNER_RAFAEL_WHATSAPP: "5571999990002", OWNER_WHATSAPP: "5571999999000",
      MERCADO_PAGO_ACCESS_TOKEN: undefined, YOUTUBE_API_KEY: undefined
    }), db);
    const login = await app.inject({ method: "POST", url: "/admin/login", payload: ownerBody });
    expect(login.statusCode).toBe(200); ownerToken = login.json().token;
  });
  afterEach(async () => { await app.close(); db.close(); });
  const requestCode = (phone = "5571999999001", groupCode = "1") => app.inject({ method: "POST", url: "/auth/request-code", payload: { name: "Pessoa", phone, groupCode } });
  const approve = (phone = "5571999999001", groupCode = "1") => app.inject({ method: "POST", url: "/admin/members", headers: authorization(ownerToken), payload: { phone, groupCode } });
  async function participant() {
    await approve();
    const login = await app.inject({ method: "POST", url: "/auth/login", payload: { name: "Pessoa", phone: "5571999999001", groupCode: "1" } });
    expect(login.statusCode).toBe(200); return login.json().token as string;
  }
  it("hashtag sozinha não concede privilégio e Owner não usa sessão de participante", async () => {
    expect((await app.inject({ method: "POST", url: "/admin/login", payload: { ...ownerBody, secret: "wrong" } })).statusCode).toBe(401);
    expect((await requestCode("5571999999001", "0")).statusCode).toBe(400);
    expect((await app.inject({ method: "GET", url: "/dashboard", headers: authorization(ownerToken) })).statusCode).toBe(401);
    const token = await participant();
    expect((await app.inject({ method: "GET", url: "/admin/overview", headers: authorization(token) })).statusCode).toBe(401);
  });
  it("Fabio0 e Rafael0 têm identidades separadas; sosyout funciona apenas no modo dev", async () => {
    const dev = await app.inject({ method:"POST", url:"/admin/login", payload:{ ...ownerBody, secret:"sosyout" } });
    expect(dev.statusCode).toBe(200);
    expect((await app.inject({method:"POST",url:"/admin/login",payload:{...ownerBody,name:"Rafael0"}})).statusCode).toBe(401);
    const rafael=await app.inject({method:"POST",url:"/admin/login",payload:{name:"Rafael0",identifier:"+55 71 [9] 9999-0002",groupCode:"#",secret:"rafael-own-secret-32-characters-long"}});
    expect(rafael.statusCode).toBe(200);
    expect((await app.inject({method:"POST",url:"/admin/login",payload:{...ownerBody,identifier:"5571999990099"}})).statusCode).toBe(401);
    expect((await app.inject({url:"/admin/overview",headers:authorization(rafael.json().token)})).json().owner).toEqual({name:"Rafael0",canonicalName:"Rafael0",groupCode:"#"});
    const forged=app.jwt.sign({sub:"owner:rafael",purpose:"owner",aud:"conexao-owner",jti:"wrong-version"});
    expect((await app.inject({url:"/admin/overview",headers:authorization(forged)})).statusCode).toBe(401);
  });
  it("login Owner rejeita marcador de grupo inválido", async () => {
    expect((await app.inject({ method:"POST", url:"/admin/login", payload:{ ...ownerBody, groupCode:"0" } })).statusCode).toBe(400);
  });

  it("resolve Owner por nome canônico ou alias sem zero + WhatsApp correto", async () => {
    for (const name of ["Fabio0", "Fábio"]) {
      const result = await app.inject({ method:"POST", url:"/auth/role", payload:{ name, phone:"+55 71 99999-0001" } });
      expect(result.statusCode).toBe(200);
      expect(result.json()).toEqual({ role:"owner" });
    }
    for (const name of ["Rafael0", "Rafael"]) {
      const result = await app.inject({ method:"POST", url:"/auth/role", payload:{ name, phone:"+55 71 99999-0002" } });
      expect(result.statusCode).toBe(200);
      expect(result.json()).toEqual({ role:"owner" });
    }
    expect((await app.inject({ method:"POST", url:"/auth/role", payload:{ name:"Fábio", phone:"+55 71 99999-0002" } })).json()).toEqual({ role:"user" });
    expect((await app.inject({ method:"POST", url:"/auth/role", payload:{ name:"Rafael", phone:"+55 71 99999-0001" } })).json()).toEqual({ role:"user" });
    expect((await app.inject({ method:"POST", url:"/auth/role", payload:{ name:"Pessoa", phone:"+1 202 555 0187" } })).json()).toEqual({ role:"user" });
  });

  it("aceita aliases também no login Owner e encaminha ao mesmo dashboard", async () => {
    const fabio = await app.inject({ method:"POST", url:"/admin/login", payload:{ ...ownerBody, name:"Fábio" } });
    expect(fabio.statusCode).toBe(200);
    expect((await app.inject({ url:"/admin/overview", headers:authorization(fabio.json().token) })).json().owner).toEqual({ name:"Fábio", canonicalName:"Fabio0", groupCode:"#" });
    const rafael = await app.inject({ method:"POST", url:"/admin/login", payload:{ name:"Rafael", identifier:"+55 71 99999-0002", groupCode:"#", secret:"rafael-own-secret-32-characters-long" } });
    expect(rafael.statusCode).toBe(200);
    expect((await app.inject({ url:"/admin/overview", headers:authorization(rafael.json().token) })).json().owner).toEqual({ name:"Rafael", canonicalName:"Rafael0", groupCode:"#" });
  });
  it("login direto exige aprovação do número no grupo informado; participante não ganha privilégio por tentativa de acesso", async () => {
    const direct = (groupCode = "1") => app.inject({ method:"POST", url:"/auth/login", payload:{ name:"Pessoa", phone:"5571999999001", groupCode } });
    expect((await direct()).statusCode).toBe(403);
    expect((await requestCode()).statusCode).toBe(403);
    await approve();
    expect((await direct("2")).statusCode).toBe(403);
    expect((await direct()).statusCode).toBe(200);
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
    expect((await app.inject({ method:"POST", url:"/auth/login", payload:{ name:"Pessoa Solicitante", phone:"5571999999001", groupCode:"2" } })).statusCode).toBe(200);
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
  it("grupos ficam entre 1 e 99; consentimento é obrigatório", async () => {
    expect((await app.inject({ method: "POST", url: "/admin/groups", headers: authorization(ownerToken), payload: { code: "0" } })).statusCode).toBe(400);
    expect((await app.inject({ method: "POST", url: "/admin/groups", headers: authorization(ownerToken), payload: { code: "100" } })).statusCode).toBe(400);
    expect((await app.inject({ method: "POST", url: "/admin/groups", headers: authorization(ownerToken), payload: { code: "99" } })).statusCode).toBe(200);
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
