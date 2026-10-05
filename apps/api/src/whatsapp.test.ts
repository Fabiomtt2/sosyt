import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";
import { buildApp } from "./app.js";
import { loadConfig, type Config } from "./config.js";
import { createDatabase, type AppDatabase } from "./db.js";
import { flushWhatsAppOutbox } from "./whatsapp.js";

describe("bot oficial WhatsApp", () => {
  let db: AppDatabase, config: Config, app: Awaited<ReturnType<typeof buildApp>>;
  beforeEach(async () => {
    config = loadConfig({ NODE_ENV: "test", DATABASE_PATH: ":memory:", AUTH_DEV_MODE: "true", REQUIRE_GROUP_MEMBERSHIP:"true", ALLOWED_GROUP_CODES:"1,2,10",
      OWNER_FABIO_SECRET:"fabio-secret-exclusive-32-characters", OWNER_RAFAEL_SECRET:"rafael-secret-exclusive-32-characters", OWNER_FABIO_WHATSAPP:"5571999999101",OWNER_RAFAEL_WHATSAPP:"5571999999102",
      OWNER_WHATSAPP:"5571999999103", WHATSAPP_APP_SECRET:"test-meta-application-secret", WHATSAPP_ACCESS_TOKEN:"test-provider-token", WHATSAPP_VERIFY_TOKEN:"test-webhook-verify-token",WHATSAPP_PHONE_NUMBER_ID:"123456",WHATSAPP_BUSINESS_ACCOUNT_ID:"654321",WHATSAPP_OTP_TEMPLATE:"sos_codigo",WHATSAPP_OWNER_ALERT_TEMPLATE:"sos_pendente" });
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
    expect(count("participation_requests")).toBe(1); expect(count("whatsapp_outbox")).toBe(5);
    const row=db.prepare("SELECT * FROM participation_requests").get() as Record<string,unknown>;
    expect(row).toMatchObject({name:"Luiza",phone:"5571999999001",source:"WHATSAPP",status:"PENDING"}); expect(row.whatsapp_verified_at).toBeTruthy();
    expect(count("group_memberships")).toBe(0);
    const sent: any[]=[]; vi.stubGlobal("fetch",vi.fn(async (_url,options) => { sent.push(JSON.parse(options.body)); return new Response(JSON.stringify({messages:[{id:`sent-${sent.length}`}]}),{status:200}); }));
    await flushWhatsAppOutbox(db,config);
    expect(sent).toHaveLength(5); expect(sent.filter((s)=>s.type==="template").map((s)=>s.to).sort()).toEqual(["5571999999101","5571999999102"]);
    expect(sent.find((s)=>s.type==="template").template.components[0].parameters.map((p:any)=>p.text)).toEqual(["1","Luiza","5571999999001"]);
    await flushWhatsAppOutbox(db,config); expect(sent).toHaveLength(5);
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
