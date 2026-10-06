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
  const approve = (phone = "5571999999001", groupCode = "1", name = "Pessoa") => app.inject({ method: "POST", url: "/admin/members", headers: authorization(ownerToken), payload: { phone, groupCode, name } });
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
  it("solicitação aceita grupo de três dígitos, persiste, bloqueia reenvio por 120 min e aprovação libera o mesmo acompanhamento", async () => {
    const body = { name: "Pessoa Solicitante", phone: "5571999999001", groupCode: "123", consent: true };
    const result = await app.inject({ method: "POST", url: "/participation/request", payload: body });
    expect(result.statusCode).toBe(200);
    expect(result.json()).toMatchObject({ status:"PENDING", message:"Sua solicitação de cadastro foi registrada e será validada em breve." });
    expect(result.json().requestToken).toBeTypeOf("string");
    expect(Date.parse(result.json().blockedUntil)-Date.now()).toBeGreaterThan(119*60_000);

    const duplicate = await app.inject({ method: "POST", url: "/participation/request", payload: body });
    expect(duplicate.statusCode).toBe(423);
    expect(duplicate.json()).toMatchObject({ code:"REQUEST_RETRY_BLOCKED", status:"PENDING" });
    expect(duplicate.json().requestToken).toBeTypeOf("string");

    const overview = (await app.inject({ method: "GET", url: "/admin/overview", headers: authorization(ownerToken) })).json();
    expect(overview.metrics.requestsTotal).toBe(1);
    expect(overview.metrics.pendingRequests).toBe(1);
    expect((db.prepare("SELECT duplicate_attempts AS n FROM participation_requests WHERE phone=?").get("5571999999001") as {n:number}).n).toBe(1);

    const before = await app.inject({ method:"POST", url:"/participation/status", payload:{ token:result.json().requestToken } });
    expect(before.statusCode).toBe(200);
    expect(before.json()).toMatchObject({ status:"PENDING", phone:"5571999999001", preferredGroup:"123" });
    expect(db.prepare("SELECT 1 FROM groups WHERE code='123'").get()).toBeTruthy();

    const decision = await app.inject({ method: "POST", url: `/admin/requests/${overview.requests[0].id}/decision`, headers: authorization(ownerToken), payload: { status: "APPROVED", groupCode: "123" } });
    expect(decision.statusCode).toBe(200);
    const after = await app.inject({ method:"POST", url:"/participation/status", payload:{ token:result.json().requestToken } });
    expect(after.statusCode).toBe(200);
    expect(after.json()).toMatchObject({ status:"APPROVED", approvedGroup:"123" });
    expect((await app.inject({ method:"POST", url:"/auth/login", payload:{ name:"Pessoa Solicitante", phone:"5571999999001", groupCode:"123" } })).statusCode).toBe(200);
  });

  it("grupo verificado exige aprovação Owner, presença do membro e Owner admin antes de liberar acesso", async () => {
    const body={ name:"Pessoa Verificada",phone:"5571999999022",groupCode:"1",consent:true };
    const requestResult=await app.inject({method:"POST",url:"/participation/request",payload:body});
    expect(requestResult.statusCode).toBe(200);
    const requestRow=db.prepare("SELECT id FROM participation_requests WHERE phone=?").get(body.phone) as {id:string};
    const stamp=new Date().toISOString();
    db.prepare("INSERT INTO whatsapp_group_verifications (provider,group_code,external_group_id,subject,owner_admin_count,verified_at) VALUES ('WPPCONNECT','1','g1','SOS YOUTUBER 1',0,?)").run(stamp);
    db.prepare("INSERT INTO whatsapp_member_verifications (provider,group_code,phone,external_group_id,verified_at,revoked_at) VALUES ('WPPCONNECT','1',?,'g1',?,NULL)").run(body.phone,stamp);

    const firstDecision=await app.inject({method:"POST",url:`/admin/requests/${requestRow.id}/decision`,headers:authorization(ownerToken),payload:{status:"APPROVED",groupCode:"1"}});
    expect(firstDecision.statusCode).toBe(200);
    expect(firstDecision.json()).toMatchObject({accessGranted:false,verification:{required:true,memberVerified:true,ownerAdminVerified:false,accessReady:false}});
    expect((await app.inject({method:"POST",url:"/auth/login",payload:{name:body.name,phone:body.phone,groupCode:"1"}})).statusCode).toBe(403);
    const pendingStatus=await app.inject({method:"POST",url:"/participation/status",payload:{token:requestResult.json().requestToken}});
    expect(pendingStatus.json()).toMatchObject({status:"PENDING",ownerApproved:true,verificationPending:true});

    db.prepare("UPDATE whatsapp_group_verifications SET owner_admin_count=1,verified_at=? WHERE provider='WPPCONNECT' AND group_code='1'").run(new Date().toISOString());
    const secondDecision=await app.inject({method:"POST",url:`/admin/requests/${requestRow.id}/decision`,headers:authorization(ownerToken),payload:{status:"APPROVED",groupCode:"1"}});
    expect(secondDecision.json()).toMatchObject({accessGranted:true,verification:{required:true,memberVerified:true,ownerAdminVerified:true,accessReady:true}});
    expect((await app.inject({method:"POST",url:"/auth/login",payload:{name:body.name,phone:body.phone,groupCode:"1"}})).statusCode).toBe(200);
  });

  it("número já autorizado não abre nova solicitação de cadastro", async () => {
    await approve("5571999999001","1","Pessoa");
    const before=(db.prepare("SELECT COUNT(*) AS n FROM participation_requests").get() as {n:number}).n;
    const result = await app.inject({ method:"POST", url:"/participation/request", payload:{ name:"Pessoa",phone:"5571999999001",groupCode:"1",consent:true } });
    expect(result.statusCode).toBe(409);
    expect(result.json()).toMatchObject({ code:"ALREADY_REGISTERED", alreadyApproved:true, groupCode:"1" });
    expect(result.json().message).toContain("Esse número já foi registrado");
    expect((db.prepare("SELECT COUNT(*) AS n FROM participation_requests").get() as {n:number}).n).toBe(before);
  });

  it("autorização manual excepcional exige nome e registra autoria Owner", async () => {
    const missing=await app.inject({method:"POST",url:"/admin/members",headers:authorization(ownerToken),payload:{phone:"5571999999011",groupCode:"1"}});
    expect(missing.statusCode).toBe(400);
    const approved=await approve("5571999999011","1","Pessoa Manual");
    expect(approved.statusCode).toBe(200);
    const row=db.prepare("SELECT status,source,approved_by_owner_name AS ownerName,approved_at AS approvedAt FROM participation_requests WHERE phone=?").get("5571999999011") as {status:string;source:string;ownerName:string;approvedAt:string};
    expect(row).toMatchObject({status:"APPROVED",source:"OWNER_MANUAL",ownerName:"Fabio0"});
    expect(Date.parse(row.approvedAt)).toBeGreaterThan(0);
  });

  it("Owner configura integração sem expor segredos e o token Meta continua explicitamente validável", async () => {
    const missing = await app.inject({ method:"POST",url:"/admin/integrations/whatsapp/validate",headers:authorization(ownerToken) });
    expect(missing.statusCode).toBe(409);
    expect(missing.json().message).toContain("System User Access Token");

    const saved = await app.inject({
      method:"POST",url:"/admin/integrations/whatsapp",headers:authorization(ownerToken),
      payload:{ mode:"META_GROUPS",businessAccountId:"123456789012345",phoneNumberId:"987654321098765",businessPhone:"+5571999990001",graphVersion:"v23.0",accessToken:"test-system-user-access-token-123456789",appSecret:"meta-app-secret-test",wppUrl:"http://127.0.0.1:21465",wppSession:"sos-youtube" }
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.json()).toMatchObject({ mode:"META_GROUPS",accessTokenConfigured:true,appSecretConfigured:true,verifyTokenConfigured:false,wppSession:"sos-youtube" });
    expect(JSON.stringify(saved.json())).not.toContain("test-system-user-access-token");
    expect(JSON.stringify(saved.json())).not.toContain("meta-app-secret-test");

    const generated = await app.inject({ method:"POST",url:"/admin/integrations/whatsapp/verify-token",headers:authorization(ownerToken) });
    expect(generated.statusCode).toBe(200);
    expect(generated.json().verifyToken).toBeTypeOf("string");
    expect(generated.json().verifyToken.length).toBeGreaterThan(20);

    const state = await app.inject({ method:"GET",url:"/admin/integrations/whatsapp",headers:authorization(ownerToken) });
    expect(state.statusCode).toBe(200);
    expect(state.json()).toMatchObject({ mode:"META_GROUPS",accessTokenConfigured:true,appSecretConfigured:true,verifyTokenConfigured:true,officialReady:true });
    expect(state.json()).not.toHaveProperty("accessToken");
    expect(state.json()).not.toHaveProperty("appSecret");
    expect(state.json()).not.toHaveProperty("verifyToken");

    const evolution = await app.inject({
      method:"POST",url:"/admin/integrations/whatsapp",headers:authorization(ownerToken),
      payload:{ mode:"EVOLUTION",evolutionUrl:"https://evolution.example.test",evolutionInstance:"sos-youtuber",evolutionApiKey:"evolution-secret-api-key-123" }
    });
    expect(evolution.statusCode).toBe(200);
    expect(evolution.json()).toMatchObject({ mode:"EVOLUTION",evolutionUrl:"https://evolution.example.test",evolutionInstance:"sos-youtuber",evolutionApiKeyConfigured:true });
    expect(JSON.stringify(evolution.json())).not.toContain("evolution-secret-api-key-123");

    const evolutionState = await app.inject({ method:"GET",url:"/admin/integrations/whatsapp",headers:authorization(ownerToken) });
    expect(evolutionState.json()).toMatchObject({ mode:"EVOLUTION",evolutionApiKeyConfigured:true });
    expect(evolutionState.json()).not.toHaveProperty("evolutionApiKey");

    const webhook = await app.inject({ method:"GET",url:`/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=${encodeURIComponent(generated.json().verifyToken)}&hub.challenge=12345` });
    expect(webhook.statusCode).toBe(200);
    expect(webhook.body).toBe("12345");
    const overview = await app.inject({ method:"GET",url:"/admin/overview",headers:authorization(ownerToken) });
    expect(overview.json().whatsapp.configured).toBe(true);
  });
  it("Owner salva e troca provedor Pix sem expor segredos", async () => {
    const mp = await app.inject({
      method:"POST",url:"/admin/integrations/payments",headers:authorization(ownerToken),
      payload:{ provider:"MERCADO_PAGO",environment:"SANDBOX",mercadoPagoAccessToken:"mp-access-token-secret-12345",mercadoPagoWebhookSecret:"mp-webhook-secret-12345" }
    });
    expect(mp.statusCode).toBe(200);
    expect(mp.json()).toMatchObject({provider:"MERCADO_PAGO",environment:"SANDBOX",ready:true,mercadoPagoAccessTokenConfigured:true,mercadoPagoWebhookSecretConfigured:true});
    expect(JSON.stringify(mp.json())).not.toContain("mp-access-token-secret");
    expect(JSON.stringify(mp.json())).not.toContain("mp-webhook-secret");

    const pagbank = await app.inject({
      method:"POST",url:"/admin/integrations/payments",headers:authorization(ownerToken),
      payload:{ provider:"PAGBANK",environment:"PRODUCTION",pagBankToken:"pagbank-production-token-12345" }
    });
    expect(pagbank.statusCode).toBe(200);
    expect(pagbank.json()).toMatchObject({provider:"PAGBANK",environment:"PRODUCTION",ready:true,pagBankTokenConfigured:true});
    expect(JSON.stringify(pagbank.json())).not.toContain("pagbank-production-token");

    const state = await app.inject({method:"GET",url:"/admin/integrations/payments",headers:authorization(ownerToken)});
    expect(state.statusCode).toBe(200);
    expect(state.json()).toMatchObject({provider:"PAGBANK",environment:"PRODUCTION",ready:true,mercadoPagoAccessTokenConfigured:true,pagBankTokenConfigured:true});
    expect(state.json()).not.toHaveProperty("pagBankToken");
    expect(state.json()).not.toHaveProperty("mercadoPagoAccessToken");
  });

  it("grupo separa habilitação interna, link salvo e prova externa", async () => {
    const linkOnly = await app.inject({method:"POST",url:"/admin/groups",headers:authorization(ownerToken),payload:{code:"77",joinUrl:"https://chat.whatsapp.com/TestGroupInvite77"}});
    expect(linkOnly.statusCode).toBe(200);
    expect(linkOnly.json().group).toMatchObject({code:"77",enabled:0,joinUrl:"https://chat.whatsapp.com/TestGroupInvite77"});
    db.prepare("INSERT INTO whatsapp_group_verifications (provider,group_code,external_group_id,subject,owner_admin_count,verified_at) VALUES ('WPPCONNECT','77','external-77','SOS YOUTUBER 77',1,?)").run(new Date().toISOString());
    db.prepare("UPDATE groups SET whatsapp_group_id='external-77',membership_mode='WPPCONNECT',last_synced_at=? WHERE code='77'").run(new Date().toISOString());
    const overview=(await app.inject({method:"GET",url:"/admin/overview",headers:authorization(ownerToken)})).json();
    const group=overview.groups.find((item:{code:string})=>item.code==="77");
    expect(group).toMatchObject({code:"77",enabled:0,joinUrl:"https://chat.whatsapp.com/TestGroupInvite77",whatsappGroupId:"external-77",verificationProvider:"WPPCONNECT",ownerAdminCount:1});
    const publicGroups=(await app.inject({method:"GET",url:"/public/groups"})).json();
    expect(publicGroups.groups).not.toContain("77");
    expect(publicGroups.groupLinks).not.toHaveProperty("77");
    const enabled=await app.inject({method:"POST",url:"/admin/groups",headers:authorization(ownerToken),payload:{code:"77",enabled:true}});
    expect(enabled.json().group).toMatchObject({enabled:1,joinUrl:"https://chat.whatsapp.com/TestGroupInvite77"});
    const publicEnabled=(await app.inject({method:"GET",url:"/public/groups"})).json();
    expect(publicEnabled.groupLinks["77"]).toBe("https://chat.whatsapp.com/TestGroupInvite77");
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
  it("grupos ficam entre 1 e 999; consentimento é obrigatório", async () => {
    expect((await app.inject({ method: "POST", url: "/admin/groups", headers: authorization(ownerToken), payload: { code: "0" } })).statusCode).toBe(400);
    expect((await app.inject({ method: "POST", url: "/admin/groups", headers: authorization(ownerToken), payload: { code: "1000" } })).statusCode).toBe(400);
    expect((await app.inject({ method: "POST", url: "/admin/groups", headers: authorization(ownerToken), payload: { code: "999" } })).statusCode).toBe(200);
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
    for (const provider of ["DEMO","MERCADO_PAGO","ASAAS","PAGBANK"]) db.prepare("INSERT INTO payments (id,user_id,provider,status,amount_cents,credits_millis,extra_passes,created_at,approved_at) VALUES (?,?,?,'APPROVED',2000,20000,1,?,?)").run(randomUUID(),userId,provider,now,now);
    const stats = (await app.inject({ method: "GET", url: "/admin/overview", headers: authorization(ownerToken) })).json().metrics;
    expect(stats).toMatchObject({ registeredUsers: 1, activeUsers30d: 1, playlistsCreatedMonth: 1, completedCyclesMonth: 1, approvedPurchasesMonth: 3, demoPurchasesMonth: 1, revenueCentsMonth: 6000 });
  });
  it("exportação CSV é exclusiva do Owner", async () => {
    const token = await participant();
    expect((await app.inject({ method: "GET", url: "/admin/users.csv", headers: authorization(token) })).statusCode).toBe(401);
    const csv = await app.inject({ method: "GET", url: "/admin/users.csv", headers: authorization(ownerToken) });
    expect(csv.statusCode).toBe(200); expect(csv.body).toContain("5571999999001");
  });
});
