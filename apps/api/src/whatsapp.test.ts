import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";
import { buildApp } from "./app.js";
import { loadConfig, type Config } from "./config.js";
import { createDatabase, type AppDatabase } from "./db.js";
import { flushWhatsAppOutbox, publicWhatsAppNumber, queueParticipationDecision, syncOfficialWhatsAppGroups, whatsappJoinUrl } from "./whatsapp.js";

describe("bot oficial WhatsApp", () => {
  let db: AppDatabase, config: Config, app: Awaited<ReturnType<typeof buildApp>>;
  beforeEach(async () => {
    config = loadConfig({ NODE_ENV: "test", DATABASE_PATH: ":memory:", AUTH_DEV_MODE: "true", REQUIRE_GROUP_MEMBERSHIP:"true", ALLOWED_GROUP_CODES:"1,2,10",
      OWNER_FABIO_SECRET:"fabio-secret-exclusive-32-characters", OWNER_RAFAEL_SECRET:"rafael-secret-exclusive-32-characters", OWNER_FABIO_WHATSAPP:"5571999999101",OWNER_RAFAEL_WHATSAPP:"5571999999102",
      OWNER_WHATSAPP:"5571999999103", WHATSAPP_APP_SECRET:"test-meta-application-secret", WHATSAPP_ACCESS_TOKEN:"test-provider-token", WHATSAPP_VERIFY_TOKEN:"test-webhook-verify-token",WHATSAPP_PHONE_NUMBER_ID:"123456",WHATSAPP_BUSINESS_ACCOUNT_ID:"654321",WHATSAPP_OTP_TEMPLATE:"sos_codigo",WHATSAPP_OWNER_ALERT_TEMPLATE:"sos_pendente",WHATSAPP_DECISION_TEMPLATE:"sos_decisao" });
    db=createDatabase(":memory:"); app=await buildApp(config,db);
  });
  afterEach(async () => { await app.close(); db.close(); vi.unstubAllGlobals(); });
  function payload(id: string, text: string, phoneId = "123456", timestamp = Math.floor(Date.now()/1000)) {
    return {object:"whatsapp_business_account",entry:[{id:"654321",changes:[{field:"messages",value:{metadata:{phone_number_id:phoneId},messages:[{id,from:"5571999999001",type:"text",timestamp:String(timestamp),text:{body:text}}]}}]}]};
  }
  const sign = (raw: string) => "sha256="+createHmac("sha256",config.WHATSAPP_APP_SECRET!).update(raw).digest("hex");
  function post(body: unknown, raw=JSON.stringify(body)) { return app.inject({method:"POST",url:"/webhooks/whatsapp",headers:{"content-type":"application/json","x-hub-signature-256":sign(raw)},payload:raw}); }
  const count = (table: string) => (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as {n:number}).n;
  it("verifica desafio e recusa assinatura inválida sem alterar dados",async () => {
    expect((await app.inject({url:"/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=test-webhook-verify-token&hub.challenge=123"})).body).toBe("123");
    expect((await app.inject({url:"/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=123"})).statusCode).toBe(403);
    expect((await app.inject({method:"POST",url:"/webhooks/whatsapp",payload:payload("m1","Quero participar"),headers:{"x-hub-signature-256":"sha256="+"0".repeat(64)}})).statusCode).toBe(401);
    expect(count("whatsapp_received")).toBe(0);
  });
  it("acolhe, recebe nome, cria pendência e alerta dois Owners sem duplicar webhook",async () => {
    const intro=payload("m1","Olá! Quero participar do projeto SOS YouTube.");
    expect((await post(intro,JSON.stringify(intro,null,2))).statusCode).toBe(200);
    await post(intro); expect(count("whatsapp_outbox")).toBe(2);
    await post(payload("m2","Luiza")); await post(payload("m2","Luiza"));
    expect(count("participation_requests")).toBe(1); expect(count("whatsapp_outbox")).toBe(6);
    const row=db.prepare("SELECT * FROM participation_requests").get() as Record<string,unknown>;
    expect(row).toMatchObject({name:"Luiza",phone:"5571999999001",source:"WHATSAPP",status:"PENDING"}); expect(row.whatsapp_verified_at).toBeTruthy();
    expect(count("group_memberships")).toBe(0);
    const sent: any[]=[]; vi.stubGlobal("fetch",vi.fn(async (_url,options) => { sent.push(JSON.parse(options.body)); return new Response(JSON.stringify({messages:[{id:`sent-${sent.length}`}]}),{status:200}); }));
    await flushWhatsAppOutbox(db,config);
    expect(sent).toHaveLength(6); expect(sent.filter((s)=>s.type==="template").map((s)=>s.to).sort()).toEqual(["5571999999101","5571999999102"]);
    expect(sent.find((s)=>s.type==="template").template.components[0].parameters.map((p:any)=>p.text)).toEqual(["Luiza","5571999999001","1"]);
    expect(sent.filter((s)=>s.type==="text").some((s)=>s.text.body.includes("validado em breve"))).toBe(true);
    await flushWhatsAppOutbox(db,config); expect(sent).toHaveLength(6);
  });
  it("nova conversa no bot não duplica nem reabre cadastro pendente durante o bloqueio",async () => {
    await post(payload("retry-m1","Quero participar"));
    await post(payload("retry-m2","Lia"));
    const first=db.prepare("SELECT id,status,retry_block_until AS blockedUntil FROM participation_requests WHERE phone=?").get("5571999999001") as {id:string;status:string;blockedUntil:string};
    expect(first.status).toBe("PENDING");
    expect(Date.parse(first.blockedUntil)).toBeGreaterThan(Date.now());

    await post(payload("retry-m3","Quero participar"));
    await post(payload("retry-m4","Lia"));
    expect(count("participation_requests")).toBe(1);
    const alerts=db.prepare("SELECT COUNT(*) AS n FROM whatsapp_outbox WHERE payload LIKE '%sos_pendente%'").get() as {n:number};
    expect(alerts.n).toBe(2);
    const received=db.prepare("SELECT payload FROM whatsapp_outbox WHERE dedupe_key='retry-m4:received'").get() as {payload:string};
    expect(JSON.parse(received.payload).text.body).toContain("já está registrado");
  });

  it("usa Rafael como número público quando não há OWNER_WHATSAPP dedicado", async () => {
    config.OWNER_WHATSAPP=undefined;
    expect(publicWhatsAppNumber(config)).toBe("5571999999102");
    expect(whatsappJoinUrl(config)).toContain("https://wa.me/5571999999102");
  });

  it("prioriza o número administrativo configurado para novo registro",async () => {
    config.OWNER_ALERT_WHATSAPP="5511998765432";
    await post(payload("alert-m1","Quero participar"));
    await post(payload("alert-m2","Nina"));
    const alerts=db.prepare("SELECT recipient,payload FROM whatsapp_outbox WHERE payload LIKE '%sos_pendente%'").all() as Array<{recipient:string;payload:string}>;
    expect(alerts).toHaveLength(1);
    expect(alerts[0].recipient).toBe("5511998765432");
    const params=JSON.parse(alerts[0].payload).template.components[0].parameters.map((p:any)=>p.text);
    expect(params).toEqual(["Nina","5571999999001","1"]);
  });
  it("notifica automaticamente a decisão do Owner e atualiza o estágio da conversa",async () => {
    await post(payload("decision-m1","Quero participar"));
    await post(payload("decision-m2","Luiza"));
    const requestRow=db.prepare("SELECT id FROM participation_requests WHERE phone=?").get("5571999999001") as {id:string};
    const login=await app.inject({method:"POST",url:"/admin/login",payload:{name:"Fabio0",identifier:"+55 71 [9]9999-9101",groupCode:"#",secret:"fabio-secret-exclusive-32-characters"}});
    expect(login.statusCode).toBe(200);
    const decision=await app.inject({method:"POST",url:`/admin/requests/${requestRow.id}/decision`,headers:{authorization:`Bearer ${login.json().token}`},payload:{status:"APPROVED",groupCode:"1"}});
    expect(decision.statusCode).toBe(200);
    const stage=db.prepare("SELECT stage FROM whatsapp_conversations WHERE phone=?").get("5571999999001") as {stage:string};
    expect(stage.stage).toBe("APPROVED");
    const job=db.prepare("SELECT payload FROM whatsapp_outbox WHERE dedupe_key LIKE 'decision:%'").get() as {payload:string};
    const decisionPayload=JSON.parse(job.payload);
    expect(decisionPayload.type).toBe("text");
    expect(decisionPayload.text.body).toContain("aprovado no SOS YOUTUBER 1");
    expect(decisionPayload.text.body).toContain("Nenhuma credencial adicional é necessária.");
    expect(count("login_codes")).toBe(0);
    expect(db.prepare("SELECT 1 FROM whatsapp_outbox WHERE dedupe_key LIKE 'approval-credential:%'").get()).toBeUndefined();
  });
  it("usa template de decisão fora da janela e deduplica o aviso",async () => {
    await post(payload("late-m1","Quero participar"));
    await post(payload("late-m2","Caio"));
    const row=db.prepare("SELECT id FROM participation_requests WHERE phone=?").get("5571999999001") as {id:string};
    db.prepare("UPDATE participation_requests SET whatsapp_verified_at=? WHERE id=?").run(new Date(Date.now()-25*3600_000).toISOString(),row.id);
    expect(queueParticipationDecision(db,config,row.id,"DECLINED")).toBe(true);
    expect(queueParticipationDecision(db,config,row.id,"DECLINED")).toBe(true);
    const jobs=db.prepare("SELECT payload FROM whatsapp_outbox WHERE dedupe_key LIKE 'decision:%'").all() as Array<{payload:string}>;
    expect(jobs).toHaveLength(1);
    const decisionPayload=JSON.parse(jobs[0].payload);
    expect(decisionPayload.type).toBe("template");
    expect(decisionPayload.template.name).toBe("sos_decisao");
    expect(decisionPayload.template.components[0].parameters.map((p:any)=>p.text)).toEqual(["Caio","NÃO APROVADO","-",config.WEB_APP_URL]);
  });
  it("descobre grupos SOS e registra prova de presença sem aprovar participante automaticamente",async () => {
    let detailParticipants=[{wa_id:"5571999999001"}];
    vi.stubGlobal("fetch",vi.fn(async (url:string) => {
      if (url.includes("/123456/groups?")) return new Response(JSON.stringify({data:{groups:[{id:"group-2",subject:"SOS YOUTUBER 2"},{id:"other",subject:"Outro grupo"}]}}),{status:200});
      if (url.includes("/group-2?")) return new Response(JSON.stringify({id:"group-2",subject:"SOS YOUTUBER 2",participants:detailParticipants}),{status:200});
      return new Response("{}",{status:404});
    }));
    expect(await syncOfficialWhatsAppGroups(db,config)).toEqual({discovered:2,linked:1,memberships:1});
    expect(db.prepare("SELECT whatsapp_group_id AS groupId,membership_mode AS mode FROM groups WHERE code='2'").get()).toEqual({groupId:"group-2",mode:"META_GROUPS_API"});
    expect(db.prepare("SELECT provider,owner_admin_count AS ownerAdminCount FROM whatsapp_group_verifications WHERE group_code='2'").get()).toEqual({provider:"META_GROUPS_API",ownerAdminCount:0});
    expect(db.prepare("SELECT provider,group_code AS groupCode,revoked_at AS revokedAt FROM whatsapp_member_verifications WHERE phone='5571999999001'").get()).toEqual({provider:"META_GROUPS_API",groupCode:"2",revokedAt:null});
    expect(db.prepare("SELECT 1 FROM group_memberships WHERE phone='5571999999001'").get()).toBeUndefined();
    detailParticipants=[];
    await syncOfficialWhatsAppGroups(db,config);
    expect((db.prepare("SELECT revoked_at AS revokedAt FROM whatsapp_member_verifications WHERE phone='5571999999001'").get() as {revokedAt?:string}).revokedAt).toBeTruthy();
  });
  it("webhook oficial registra e revoga prova de presença sem conceder aprovação sozinho",async () => {
    db.prepare("UPDATE groups SET whatsapp_group_id='group-1',membership_mode='META_GROUPS_API' WHERE code='1'").run();
    db.prepare("INSERT INTO whatsapp_group_verifications (provider,group_code,external_group_id,subject,owner_admin_count,verified_at) VALUES ('META_GROUPS_API','1','group-1','SOS YOUTUBER 1',0,?)").run(new Date().toISOString());
    const groupPayload=(id:string,type:string,key:string) => ({object:"whatsapp_business_account",entry:[{id:"654321",changes:[{field:"group_participants_update",value:{metadata:{phone_number_id:"123456"},groups:[{timestamp:id,group_id:"group-1",type,[key]:[{wa_id:"5571999999001"}]}]}}]}]});
    const add=groupPayload("100","group_participants_add","added_participants");
    expect((await post(add)).statusCode).toBe(200); await post(add);
    expect(count("whatsapp_group_events")).toBe(1);
    expect(db.prepare("SELECT group_code AS groupCode,revoked_at AS revokedAt FROM whatsapp_member_verifications WHERE phone='5571999999001'").get()).toEqual({groupCode:"1",revokedAt:null});
    expect(db.prepare("SELECT 1 FROM group_memberships WHERE phone='5571999999001'").get()).toBeUndefined();
    expect((await post(groupPayload("101","group_participants_remove","removed_participants"))).statusCode).toBe(200);
    expect((db.prepare("SELECT revoked_at AS revokedAt FROM whatsapp_member_verifications WHERE phone='5571999999001'").get() as {revokedAt?:string}).revokedAt).toBeTruthy();
  });
  it("ignora outro número de atendimento e nome sem contexto; recusa payload malformado",async () => {
    await post(payload("m1","Quero participar","99999")); await post(payload("m2","Pessoa"));
    expect(count("whatsapp_outbox")).toBe(0); expect(count("participation_requests")).toBe(0);
    expect((await post({object:"whatsapp_business_account",entry:null})).statusCode).toBe(400);
  });
  it("não envia resposta livre fora da janela de serviço",async () => {
    await post(payload("m1","Quero participar","123456",Math.floor(Date.now()/1000)-25*3600));
    const fetchMock=vi.fn(); vi.stubGlobal("fetch",fetchMock); await flushWhatsAppOutbox(db,config);
    expect(fetchMock).not.toHaveBeenCalled(); expect((db.prepare("SELECT COUNT(*) AS n FROM whatsapp_outbox WHERE status='FAILED'").get() as {n:number}).n).toBe(2);
  });
  it("falha do provedor é retida para retentativa sem perder solicitação",async () => {
    await post(payload("m1","Quero participar")); await post(payload("m2","Pessoa"));
    vi.stubGlobal("fetch",vi.fn(async () => new Response("{}",{status:503})));
    await flushWhatsAppOutbox(db,config); expect(count("participation_requests")).toBe(1);
    expect((db.prepare("SELECT attempts,last_error FROM whatsapp_outbox LIMIT 1").get() as any)).toMatchObject({attempts:1,last_error:"WHATSAPP_DELIVERY_503"});
  });
  it("OTP real usa template, não devolve código no navegador e não libera grupo só pela mensagem",async () => {
    config.AUTH_DEV_MODE=false;
    const rejected=await app.inject({method:"POST",url:"/auth/request-code",payload:{name:"Pessoa",phone:"5571999999001",groupCode:"10"}}); expect(rejected.statusCode).toBe(403);
    db.prepare("INSERT INTO group_memberships (phone,group_code,approved_at) VALUES (?,'10',?)").run("5571999999001",new Date().toISOString());
    let code=""; vi.stubGlobal("fetch",vi.fn(async (_url,options) => { const body=JSON.parse(options.body); code=body.template.components[0].parameters[0].text; expect(body.template.name).toBe("sos_codigo");return new Response(JSON.stringify({messages:[{id:"otp1"}]}),{status:200}); }));
    const request=await app.inject({method:"POST",url:"/auth/request-code",payload:{name:"Pessoa",phone:"5571999999001",groupCode:"10"}});
    expect(request.statusCode).toBe(200); expect(request.json().devCode).toBeUndefined(); expect(code).toMatch(/^\d{6}$/);
    expect((await app.inject({method:"POST",url:"/auth/verify",payload:{phone:"5571999999001",code}})).statusCode).toBe(200);
  });
  it("falha de envio OTP invalida o código criado",async () => {
    config.AUTH_DEV_MODE=false; db.prepare("INSERT INTO group_memberships (phone,group_code,approved_at) VALUES (?,'1',?)").run("5571999999001",new Date().toISOString());
    vi.stubGlobal("fetch",vi.fn(async () => new Response("{}",{status:400})));
    expect((await app.inject({method:"POST",url:"/auth/request-code",payload:{name:"Pessoa",phone:"5571999999001",groupCode:"1"}})).statusCode).toBe(503);
    expect((db.prepare("SELECT used_at FROM login_codes").get() as {used_at:string}).used_at).toBeTruthy();
  });
});
