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
      OWNER_RAFAEL_NAME: "Rafael0", OWNER_RAFAEL_ID: "rafael0", OWNER_RAFAEL_SECRET:"rafael-own-secret-32-characters-long", OWNER_RAFAEL_WHATSAPP: "5571999990002",
      OWNER_WHATSAPP: "5571999999000", MERCADO_PAGO_ACCESS_TOKEN: undefined, YOUTUBE_API_KEY: undefined
    }), db);
    const login = await app.inject({ method: "POST", url: "/admin/login", payload: ownerBody });
    expect(login.statusCode).toBe(200); ownerToken = login.json().token;
  });
  afterEach(async () => { await app.close(); db.close(); });
  const requestCode = (phone = "5571999999001") => app.inject({ method: "POST", url: "/auth/request-code", payload: { name: "Pessoa", phone } });
  const approve = (phone = "5571999999001", groupCode = "1", name = "Pessoa") => app.inject({ method: "POST", url: "/admin/members", headers: authorization(ownerToken), payload: { phone, groupCode, name } });
  async function participant() {
    await approve();
    const login = await app.inject({ method: "POST", url: "/auth/login", payload: { name: "Pessoa", phone: "5571999999001" } });
    expect(login.statusCode).toBe(200); return login.json().token as string;
  }
  it("hashtag sozinha não concede privilégio e Owner não usa sessão de participante", async () => {
    expect((await app.inject({ method: "POST", url: "/admin/login", payload: { ...ownerBody, secret: "wrong" } })).statusCode).toBe(401);
    expect((await requestCode("5571999999001")).statusCode).toBe(403);
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
    expect((await app.inject({url:"/admin/overview",headers:authorization(rafael.json().token)})).json().owner).toMatchObject({
      name:"Rafael0",canonicalName:"Rafael0",groupCode:"#",role:"ROOT_OWNER",
      permissions:{canConfigure:true,canManageOwners:true,canOperate:true,canViewSensitive:true,canAdjustWallet:true,canExport:true}
    });
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
    expect((await app.inject({ url:"/admin/overview", headers:authorization(fabio.json().token) })).json().owner).toMatchObject({
      name:"Fábio",canonicalName:"Fabio0",groupCode:"#",role:"ROOT_OWNER",permissions:{canConfigure:true,canManageOwners:true}
    });
    const rafael = await app.inject({ method:"POST", url:"/admin/login", payload:{ name:"Rafael", identifier:"+55 71 99999-0002", groupCode:"#", secret:"rafael-own-secret-32-characters-long" } });
    expect(rafael.statusCode).toBe(200);
    expect((await app.inject({ url:"/admin/overview", headers:authorization(rafael.json().token) })).json().owner).toMatchObject({
      name:"Rafael",canonicalName:"Rafael0",groupCode:"#",role:"ROOT_OWNER",permissions:{canConfigure:true,canManageOwners:true}
    });
  });
  it("Administrador delegado vem de usuário Fabio/Fábio/Rafael verificado e não recebe configurações sensíveis", async () => {
    const adminPhone="5571999999014";
    await approve(adminPhone,"1","Rafael");
    const participantLogin=await app.inject({
      method:"POST",url:"/auth/login",
      payload:{name:"Rafael",phone:adminPhone,groupCode:"1"}
    });
    expect(participantLogin.statusCode).toBe(200);
    const participantToken=participantLogin.json().token as string;
    const adminUserId=participantLogin.json().user.id as string;

    const promoted=await app.inject({
      method:"POST",url:"/admin/owners",headers:authorization(ownerToken),payload:{userId:adminUserId}
    });
    expect(promoted.statusCode).toBe(200);
    expect(promoted.json()).toMatchObject({userId:adminUserId,name:"Rafael",phone:adminPhone,role:"ADMIN_OWNER"});

    // O intervalo de participante não pode prender um Owner/Admin fora do painel.
    // /dashboard usa authGuard e deve respeitar o cooldown; /admin/elevate usa
    // apenas a identidade de participante para reemitir a sessão administrativa.
    db.prepare("UPDATE users SET cooldown_until=?,cooldown_reason=? WHERE id=?")
      .run(new Date(Date.now()+120*60_000).toISOString(),"Teste de retorno ao painel",adminUserId);
    expect((await app.inject({method:"GET",url:"/dashboard",headers:authorization(participantToken)})).statusCode).toBe(423);

    const elevated=await app.inject({method:"POST",url:"/admin/elevate",headers:authorization(participantToken)});
    expect(elevated.statusCode).toBe(200);
    expect(elevated.json()).toMatchObject({role:"owner",ownerRole:"ADMIN_OWNER"});
    const adminToken=elevated.json().token as string;

    const overview=await app.inject({method:"GET",url:"/admin/overview",headers:authorization(adminToken)});
    expect(overview.statusCode).toBe(200);
    expect(overview.json().owner).toMatchObject({
      name:"Rafael",role:"ADMIN_OWNER",
      permissions:{
        canConfigure:false,canManageOwners:false,canOperate:true,
        canViewSensitive:false,canAdjustWallet:false,canExport:false,canParticipate:true
      }
    });

    expect((await app.inject({method:"GET",url:"/admin/integrations/whatsapp",headers:authorization(adminToken)})).statusCode).toBe(403);
    expect((await app.inject({method:"GET",url:"/admin/integrations/payments",headers:authorization(adminToken)})).statusCode).toBe(403);
    expect((await app.inject({method:"GET",url:"/admin/users.csv",headers:authorization(adminToken)})).statusCode).toBe(403);
    expect((await app.inject({
      method:"POST",url:`/admin/participants/${adminPhone}/wallet-adjustment`,
      headers:authorization(adminToken),payload:{amountCoins:1,reason:"Tentativa restrita do administrador"}
    })).statusCode).toBe(403);
    expect((await app.inject({method:"GET",url:`/admin/participants/${adminPhone}`,headers:authorization(adminToken)})).statusCode).toBe(200);

    const otherPhone="5571999999015";
    await approve(otherPhone,"1","Pessoa");
    const otherLogin=await app.inject({
      method:"POST",url:"/auth/login",
      payload:{name:"Pessoa",phone:otherPhone,groupCode:"1"}
    });
    expect(otherLogin.statusCode).toBe(200);
    const forbiddenPromotion=await app.inject({
      method:"POST",url:"/admin/owners",headers:authorization(ownerToken),
      payload:{userId:otherLogin.json().user.id}
    });
    expect(forbiddenPromotion.statusCode).toBe(403);

    const team=await app.inject({method:"GET",url:"/admin/owners",headers:authorization(ownerToken)});
    expect(team.statusCode).toBe(200);
    expect(team.json().candidates.some((item:{name:string})=>item.name==="Pessoa")).toBe(false);

    const revoked=await app.inject({method:"DELETE",url:`/admin/owners/${promoted.json().id}`,headers:authorization(ownerToken)});
    expect(revoked.statusCode).toBe(200);
    expect((await app.inject({method:"GET",url:"/admin/overview",headers:authorization(adminToken)})).statusCode).toBe(401);
    expect((await app.inject({method:"POST",url:"/admin/elevate",headers:authorization(participantToken)})).statusCode).toBe(403);
  });

  it("Owner persiste o mesmo catálogo de 34 avatares do participante", async () => {
    const saved=await app.inject({
      method:"PUT",url:"/admin/profile/avatar",headers:authorization(ownerToken),
      payload:{kind:"PRESET",presetId:"avatar-34"}
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.json().avatar).toEqual({kind:"PRESET",presetId:"avatar-34"});
    const overview=(await app.inject({method:"GET",url:"/admin/overview",headers:authorization(ownerToken)})).json();
    expect(overview.owner.avatar).toEqual({kind:"PRESET",presetId:"avatar-34"});
    expect((await app.inject({method:"DELETE",url:"/admin/profile/avatar",headers:authorization(ownerToken)})).statusCode).toBe(200);
    const cleared=(await app.inject({method:"GET",url:"/admin/overview",headers:authorization(ownerToken)})).json();
    expect(cleared.owner.avatar).toBeUndefined();
  });

  it("expõe nome e ícone do canal conectado no painel e no detalhe administrativo", async () => {
    const phone="5571999999031";
    await approve(phone,"1","Criadora Canal");
    const login=await app.inject({method:"POST",url:"/auth/login",payload:{name:"Criadora Canal",phone}});
    expect(login.statusCode).toBe(200);
    const userId=login.json().user.id as string;
    db.prepare(`INSERT INTO youtube_connections (user_id,refresh_token_cipher,scope,channel_id,channel_title,channel_thumbnail_url,updated_at)
      VALUES (?,?,?,?,?,?,?)`).run(userId,"cipher-test","scope-test","channel-31","Canal da Criadora","https://example.test/channel.jpg",new Date().toISOString());

    const overview=await app.inject({method:"GET",url:"/admin/overview",headers:authorization(ownerToken)});
    expect(overview.statusCode).toBe(200);
    const row=overview.json().users.find((item:{phone:string})=>item.phone===phone);
    expect(row).toMatchObject({
      youtubeChannelId:"channel-31",
      youtubeChannelTitle:"Canal da Criadora",
      youtubeChannelThumbnailUrl:"https://example.test/channel.jpg"
    });

    const detail=await app.inject({method:"GET",url:`/admin/participants/${phone}`,headers:authorization(ownerToken)});
    expect(detail.statusCode).toBe(200);
    expect(detail.json().profile.youtubeChannel).toEqual({
      id:"channel-31",
      title:"Canal da Criadora",
      thumbnailUrl:"https://example.test/channel.jpg"
    });
  });

  it("login resolve o grupo pelo número aprovado e não aceita grupo escolhido pelo cliente", async () => {
    const direct=() => app.inject({method:"POST",url:"/auth/login",payload:{name:"Pessoa",phone:"5571999999001"}});
    expect((await direct()).statusCode).toBe(403);
    expect((await requestCode()).statusCode).toBe(403);
    await approve();
    expect((await direct()).statusCode).toBe(200);
    expect((await requestCode()).statusCode).toBe(200);
  });
  it("solicitação não pede grupo; o bot detecta até três dígitos e a aprovação usa essa detecção", async () => {
    const body={name:"Pessoa Solicitante",phone:"5571999999001",consent:true};
    const result=await app.inject({method:"POST",url:"/participation/request",payload:body});
    expect(result.statusCode).toBe(200);
    expect(result.json()).toMatchObject({status:"PENDING",groupDetectionSource:"NONE"});
    expect(result.json().requestToken).toBeTypeOf("string");
    expect(Date.parse(result.json().blockedUntil)-Date.now()).toBeGreaterThan(119*60_000);

    const duplicate=await app.inject({method:"POST",url:"/participation/request",payload:body});
    expect(duplicate.statusCode).toBe(423);
    expect(duplicate.json()).toMatchObject({code:"REQUEST_RETRY_BLOCKED",status:"PENDING"});

    const stamp=new Date().toISOString();
    db.prepare("INSERT OR IGNORE INTO groups (code,enabled,membership_mode) VALUES ('123',1,'OWNER')").run();
    db.prepare("INSERT INTO whatsapp_group_verifications (provider,group_code,external_group_id,subject,owner_admin_count,verified_at) VALUES ('WPPCONNECT','123','g123','SOS YOUTUBER 123',0,?)").run(stamp);
    db.prepare("INSERT INTO whatsapp_member_verifications (provider,group_code,phone,external_group_id,verified_at,revoked_at) VALUES ('WPPCONNECT','123',?,'g123',?,NULL)").run(body.phone,stamp);

    const detected=await app.inject({method:"POST",url:"/participation/status",payload:{token:result.json().requestToken}});
    expect(detected.statusCode).toBe(200);
    expect(detected.json()).toMatchObject({status:"PENDING",phone:body.phone,preferredGroup:"123"});

    const overview=(await app.inject({method:"GET",url:"/admin/overview",headers:authorization(ownerToken)})).json();
    expect(overview.metrics.requestsTotal).toBe(1);
    expect((db.prepare("SELECT duplicate_attempts AS n FROM participation_requests WHERE phone=?").get(body.phone) as {n:number}).n).toBe(1);

    const decision=await app.inject({method:"POST",url:`/admin/requests/${overview.requests[0].id}/decision`,headers:authorization(ownerToken),payload:{status:"APPROVED"}});
    expect(decision.statusCode).toBe(200);
    expect(decision.json()).toMatchObject({accessGranted:true,verification:{memberVerified:true,accessReady:true}});

    const after=await app.inject({method:"POST",url:"/participation/status",payload:{token:result.json().requestToken}});
    expect(after.json()).toMatchObject({status:"APPROVED",approvedGroup:"123"});
    expect((await app.inject({method:"POST",url:"/auth/login",payload:{name:body.name,phone:body.phone}})).statusCode).toBe(200);
  });

  it("grupo verificado bloqueia até o número aparecer e não exige papel admin do provedor", async () => {
    const body={name:"Pessoa Verificada",phone:"5571999999022",consent:true};
    const requestResult=await app.inject({method:"POST",url:"/participation/request",payload:body});
    expect(requestResult.statusCode).toBe(200);
    const requestRow=db.prepare("SELECT id FROM participation_requests WHERE phone=?").get(body.phone) as {id:string};
    const stamp=new Date().toISOString();
    db.prepare("INSERT INTO whatsapp_group_verifications (provider,group_code,external_group_id,subject,owner_admin_count,verified_at) VALUES ('WPPCONNECT','1','g1','SOS YOUTUBER 1',0,?)").run(stamp);

    const withoutMember=await app.inject({method:"POST",url:`/admin/requests/${requestRow.id}/decision`,headers:authorization(ownerToken),payload:{status:"APPROVED"}});
    expect(withoutMember.statusCode).toBe(409);
    expect(withoutMember.json()).toMatchObject({code:"GROUP_NOT_DETECTED"});
    expect((await app.inject({method:"POST",url:"/auth/login",payload:{name:body.name,phone:body.phone}})).statusCode).toBe(403);

    db.prepare("INSERT INTO whatsapp_member_verifications (provider,group_code,phone,external_group_id,verified_at,revoked_at) VALUES ('WPPCONNECT','1',?,'g1',?,NULL)").run(body.phone,stamp);
    const detected=await app.inject({method:"POST",url:"/participation/status",payload:{token:requestResult.json().requestToken}});
    expect(detected.json()).toMatchObject({preferredGroup:"1",status:"PENDING"});

    const withMember=await app.inject({method:"POST",url:`/admin/requests/${requestRow.id}/decision`,headers:authorization(ownerToken),payload:{status:"APPROVED"}});
    expect(withMember.statusCode).toBe(200);
    expect(withMember.json()).toMatchObject({accessGranted:true,verification:{required:true,memberVerified:true,ownerAdminVerified:false,accessReady:true}});
    expect((await app.inject({method:"POST",url:"/auth/login",payload:{name:body.name,phone:body.phone}})).statusCode).toBe(200);
  });

  it("número já autorizado não abre nova solicitação de cadastro", async () => {
    await approve("5571999999001","1","Pessoa");
    const before=(db.prepare("SELECT COUNT(*) AS n FROM participation_requests").get() as {n:number}).n;
    const result = await app.inject({ method:"POST", url:"/participation/request", payload:{ name:"Pessoa",phone:"5571999999001",groupCode:"1",consent:true } });
    expect(result.statusCode).toBe(409);
    expect(result.json()).toMatchObject({ code:"ALREADY_REGISTERED", alreadyApproved:true });
    expect(result.json().groupCode).toBeUndefined();
    expect(result.json().message).toContain("Esse número já possui acesso registrado");
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
      payload:{ mode:"META_GROUPS",businessAccountId:"123456789012345",phoneNumberId:"987654321098765",businessPhone:"+5571999990001",graphVersion:"v23.0",
        otpTemplate:"sos_codigo",ownerAlertTemplate:"sos_pendente",decisionTemplate:"sos_decisao",templateLanguage:"pt_BR",
        accessToken:"test-system-user-access-token-123456789",appSecret:"meta-app-secret-test",wppUrl:"http://127.0.0.1:21465",wppSession:"sos-youtube" }
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.json()).toMatchObject({
      mode:"META_GROUPS",accessTokenConfigured:true,appSecretConfigured:true,verifyTokenConfigured:false,wppSession:"sos-youtube",
      otpTemplate:"sos_codigo",ownerAlertTemplate:"sos_pendente",decisionTemplate:"sos_decisao",templateLanguage:"pt_BR"
    });
    expect(JSON.stringify(saved.json())).not.toContain("test-system-user-access-token");
    expect(JSON.stringify(saved.json())).not.toContain("meta-app-secret-test");
    const publicGroups=await app.inject({method:"GET",url:"/public/groups"});
    expect(publicGroups.statusCode).toBe(200);
    expect(publicGroups.json().whatsappJoinUrl).toContain("https://wa.me/5571999990001");

    const generated = await app.inject({ method:"POST",url:"/admin/integrations/whatsapp/verify-token",headers:authorization(ownerToken) });
    expect(generated.statusCode).toBe(200);
    expect(generated.json().verifyToken).toBeTypeOf("string");
    expect(generated.json().verifyToken.length).toBeGreaterThan(20);

    const state = await app.inject({ method:"GET",url:"/admin/integrations/whatsapp",headers:authorization(ownerToken) });
    expect(state.statusCode).toBe(200);
    expect(state.json()).toMatchObject({ mode:"META_GROUPS",accessTokenConfigured:true,appSecretConfigured:true,verifyTokenConfigured:true,officialReady:false,senderValidationRequired:true });
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
    expect(overview.json().whatsapp).toMatchObject({
      configured:false,otpConfigured:true,ownerAlertsConfigured:true,decisionTemplateConfigured:true
    });
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
    const rows=[
      {provider:"DEMO",product:"COINS_LAUNCH",credits:10000,passes:1},
      {provider:"MERCADO_PAGO",product:"COINS_LAUNCH",credits:10000,passes:1},
      {provider:"ASAAS",product:"PASS_SINGLE",credits:0,passes:1},
      {provider:"PAGBANK",product:"LEGACY",credits:20000,passes:1}
    ];
    for (const row of rows) db.prepare("INSERT INTO payments (id,user_id,provider,product_code,status,amount_cents,credits_millis,extra_passes,created_at,approved_at) VALUES (?,?,?,?,'APPROVED',2000,?,?,?,?)").run(randomUUID(),userId,row.provider,row.product,row.credits,row.passes,now,now);
    const stats = (await app.inject({ method: "GET", url: "/admin/overview", headers: authorization(ownerToken) })).json().metrics;
    expect(stats).toMatchObject({
      registeredUsers:1,activeUsers30d:1,playlistsCreatedMonth:1,completedCyclesMonth:1,
      approvedPurchasesMonth:3,demoPurchasesMonth:1,revenueCentsMonth:6000,
      coinsPackagePurchasesMonth:1,passPurchasesMonth:1,
      coinsPackageRevenueCentsMonth:2000,passRevenueCentsMonth:2000,legacyRevenueCentsMonth:2000
    });
  });
  it("exportação CSV é exclusiva do Owner", async () => {
    const token = await participant();
    expect((await app.inject({ method: "GET", url: "/admin/users.csv", headers: authorization(token) })).statusCode).toBe(401);
    const csv = await app.inject({ method: "GET", url: "/admin/users.csv", headers: authorization(ownerToken) });
    expect(csv.statusCode).toBe(200); expect(csv.body).toContain("5571999999001");
  });
  it("Owner e participante consultam o mesmo tempo global persistido",async()=>{
    const token=await participant();
    const dashboard=(await app.inject({url:"/dashboard",headers:authorization(token)})).json();
    db.prepare("INSERT INTO watch_time_totals(user_id,verified_millis,rewarded_coins,updated_at) VALUES (?,?,?,?)")
      .run(dashboard.user.id,1_250_000,1,new Date().toISOString());
    const self=(await app.inject({url:"/dashboard",headers:authorization(token)})).json();
    const owner=(await app.inject({url:"/admin/participants/5571999999001",headers:authorization(ownerToken)})).json();
    expect(owner.watchRewards).toEqual({verifiedSeconds:1250,coins:1,secondsToNextReward:1150});
    expect(owner.watchRewards).toEqual(self.watchRewards);
  });

});
