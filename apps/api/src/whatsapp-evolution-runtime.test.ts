import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "./app.js";
import { loadConfig, type Config } from "./config.js";
import { createDatabase, type AppDatabase } from "./db.js";
import { effectiveWhatsAppConfig, readWhatsAppIntegration, saveWhatsAppIntegration } from "./integrations.js";
import { saveAutomationSettings } from "./bot-automation-store.js";
import { connectEvolutionSession, flushWhatsAppOutbox, queueBotNotification, queueGroupAutomation, sendWhatsAppOtp, queueWhatsAppOtp, syncEvolutionWhatsAppGroups, whatsappRuntimeStatus } from "./whatsapp.js";

describe("Evolution runtime selecionado e identidade isolada",()=>{
 let db:AppDatabase,config:Config,app:Awaited<ReturnType<typeof buildApp>>;
 const phone="5511999999001",secret="test-evolution-webhook-secret-32-characters";
 beforeEach(async()=>{
  config=loadConfig({NODE_ENV:"test",DATABASE_PATH:":memory:",EVOLUTION_URL:"https://evolution.example.test",EVOLUTION_INSTANCE:"sos-primary",EVOLUTION_PHONE:"5511999999000",EVOLUTION_API_KEY:"test-evolution-api-key",EVOLUTION_WEBHOOK_SECRET:secret});
  db=createDatabase(":memory:");app=await buildApp(config,db);
 });
 afterEach(async()=>{await app.close();db.close();vi.unstubAllGlobals();vi.restoreAllMocks();vi.useRealTimers();});
 const reply=(data:unknown)=>new Response(JSON.stringify(data),{status:200});
 function fetchMock(connected=true){
  return vi.fn(async(url:string,_init?:RequestInit)=>url.includes("connectionState")?reply({instance:{state:connected?"open":"close"}}):url.includes("fetchInstances")?reply([{name:"sos-primary",ownerJid:"5511999999000@s.whatsapp.net"}]):reply({key:{id:"sent-test"}}));
 }
 it("novo projeto prefere Evolution, preserva modo oficial explicitamente salvo e nunca expõe segredos",()=>{
  expect(readWhatsAppIntegration(db,config)).toMatchObject({mode:"EVOLUTION",evolutionConfigured:true});
  saveWhatsAppIntegration(db,config,{mode:"OFFICIAL"});
  expect(readWhatsAppIntegration(db,config).mode).toBe("OFFICIAL");
  expect(JSON.stringify(readWhatsAppIntegration(db,config))).not.toContain(secret);
 });
 it("modo HYBRID+ explícito no ambiente prevalece sobre credenciais Meta de compatibilidade",()=>{
  const explicit=loadConfig({NODE_ENV:"test",WHATSAPP_MODE:"HYBRID_PLUS",WHATSAPP_ACCESS_TOKEN:"official-environment-token",WHATSAPP_PHONE_NUMBER_ID:"123456"});
  expect(readWhatsAppIntegration(db,explicit).mode).toBe("HYBRID_PLUS");
  const legacy=loadConfig({NODE_ENV:"test",WHATSAPP_ACCESS_TOKEN:"official-environment-token",WHATSAPP_PHONE_NUMBER_ID:"123456"});
  expect(legacy.WHATSAPP_MODE).toBe("OFFICIAL");
  expect(readWhatsAppIntegration(db,legacy).mode).toBe("OFFICIAL");
 });
 it("nunca envia OTP pela linha Evolution de grupos nem faz fallback automático",async()=>{
  const fetch=fetchMock();vi.stubGlobal("fetch",fetch);
  await expect(sendWhatsAppOtp(effectiveWhatsAppConfig(db,config),phone,"123456")).rejects.toThrow("WHATSAPP_OTP_OFFICIAL_CHANNEL_REQUIRED");
  expect(queueWhatsAppOtp(db,config,phone,"123456","blocked-otp",new Date(Date.now()+300000).toISOString())).toBe(false);
  expect(fetch).not.toHaveBeenCalled();
  expect((await whatsappRuntimeStatus(db,config)).otpConfigured).toBe(false);
 });
 it("contém sessão desconectada sem consumir tentativas nem perder a fila",async()=>{
  expect(queueBotNotification(db,config,phone,"Atualização solicitada","offline-notice",undefined,{deliveryClass:"TRANSACTIONAL"}).queued).toBe(true);
  vi.useFakeTimers({toFake:["Date"]});
  const stamp=Date.now();
  vi.stubGlobal("fetch",fetchMock(false));
  await flushWhatsAppOutbox(db,config);
  expect(db.prepare("SELECT status,attempts FROM whatsapp_outbox").get()).toMatchObject({status:"PENDING",attempts:0});
  vi.stubGlobal("fetch",fetchMock(true));vi.setSystemTime(stamp+16000);await flushWhatsAppOutbox(db,config);
  expect(db.prepare("SELECT status,attempts FROM whatsapp_outbox").get()).toMatchObject({status:"SENT",attempts:1});
 });
 it("payload cifrado é aberto só no transporte e metadados privados não chegam ao provedor",async()=>{
  queueBotNotification(db,config,phone,"Dados privados do atendimento","encrypted",undefined,{encryptPayload:true,deliveryClass:"TRANSACTIONAL"});
  const fetch=fetchMock();vi.stubGlobal("fetch",fetch);await flushWhatsAppOutbox(db,config);
  const send=fetch.mock.calls.find(([url])=>url.includes("/message/sendText/"));
  expect(send).toBeTruthy();
  expect(JSON.parse(String(send?.[1]?.body))).toEqual({number:phone,text:"Dados privados do atendimento"});
 });
 it("webhook exige segredo e instância e deduplica a conversa real sem enviar externamente",async()=>{
  const body={event:"MESSAGES_UPSERT",instance:"sos-primary",data:{key:{id:"in-1",remoteJid:phone+"@s.whatsapp.net",fromMe:false},messageTimestamp:Math.floor(Date.now()/1000),message:{conversation:"Quero participar"}}};
  expect((await app.inject({method:"POST",url:"/webhooks/whatsapp/evolution",payload:body})).statusCode).toBe(401);
  expect((await app.inject({method:"POST",url:"/webhooks/whatsapp/evolution",headers:{"x-sos-webhook-secret":secret},payload:{...body,instance:"other-instance"}})).statusCode).toBe(403);
  for(let i=0;i<2;i++)expect((await app.inject({method:"POST",url:"/webhooks/whatsapp/evolution",headers:{"x-sos-webhook-secret":secret},payload:body})).statusCode).toBe(200);
  expect(db.prepare("SELECT COUNT(*) AS n FROM whatsapp_received").get()).toEqual({n:1});
  expect(db.prepare("SELECT COUNT(*) AS n FROM whatsapp_outbox").get()).toEqual({n:2});
 });
 it("não migra trabalho antigo silenciosamente para um número substituto",async()=>{
  queueGroupAutomation(db,config,"123456789@g.us","Grupo","rotation");
  saveWhatsAppIntegration(db,config,{mode:"EVOLUTION",evolutionPhone:"5511999999222"});
  const fetch=fetchMock();vi.stubGlobal("fetch",fetch);await flushWhatsAppOutbox(db,config);
  expect(fetch.mock.calls.every(([url])=>!url.includes("sendText"))).toBe(true);
  expect(db.prepare("SELECT status,attempts FROM whatsapp_outbox").get()).toMatchObject({status:"PENDING",attempts:0});
 });
 it("conexão recusa formulário stale antes de qualquer chamada externa",async()=>{
  const fetch=fetchMock();vi.stubGlobal("fetch",fetch);
  await expect(connectEvolutionSession(db,config,"old-instance","5511999999000")).rejects.toThrow("configuração mudou");
  expect(fetch).not.toHaveBeenCalled();
 });
 it("prontidão salva e conexão observada são estados distintos",async()=>{
  vi.stubGlobal("fetch",fetchMock(false));
  expect(await whatsappRuntimeStatus(db,config)).toMatchObject({configured:true,connected:false,evolution:{configured:true,connected:false}});
 });
 it("HYBRID exige dois números distintos e não muda configuração após recusa",()=>{
  expect(()=>saveWhatsAppIntegration(db,config,{mode:"HYBRID_PLUS",businessPhone:"5511999999000"})).toThrow("mesmo");
  expect(readWhatsAppIntegration(db,config).mode).toBe("EVOLUTION");
 });
 it("suporte aplica texto Owner e respeita automação desligada",async()=>{
  saveAutomationSettings(db,"SUPPORT_HANDOFF",{text:"Atendimento de {nome} encaminhado pelo suporte."},{id:"root:test",name:"Root"});
  const body={event:"MESSAGES_UPSERT",instance:"sos-primary",data:{key:{id:"custom-1",remoteJid:phone+"@s.whatsapp.net"},messageTimestamp:Math.floor(Date.now()/1000),message:{conversation:"humano"}}};
  expect((await app.inject({method:"POST",url:"/webhooks/whatsapp/evolution",headers:{"x-sos-webhook-secret":secret},payload:body})).statusCode).toBe(200);
  expect(String((db.prepare("SELECT payload FROM whatsapp_outbox").get() as {payload:string}).payload)).toContain("encaminhado pelo suporte");
  saveAutomationSettings(db,"SUPPORT_HANDOFF",{enabled:false},{id:"root:test",name:"Root"});
  body.data.key.id="custom-2";
  await app.inject({method:"POST",url:"/webhooks/whatsapp/evolution",headers:{"x-sos-webhook-secret":secret},payload:body});
  expect(db.prepare("SELECT COUNT(*) AS n FROM whatsapp_outbox").get()).toEqual({n:1});
 });
 it("reconexão e chamadas repetidas não drenam grupos em rajada; cadência fica no banco",async()=>{
  vi.useFakeTimers({toFake:["Date"]});vi.setSystemTime(new Date("2026-10-16T12:00:00Z"));vi.spyOn(Math,"random").mockReturnValue(0);
  const fetch=fetchMock();vi.stubGlobal("fetch",fetch);
  for(let i=0;i<3;i++)queueGroupAutomation(db,config,"123456789@g.us","Grupo "+i,"cadence-"+i);
  await flushWhatsAppOutbox(db,config,10);await flushWhatsAppOutbox(db,config,10);
  expect(fetch.mock.calls.filter(([url])=>url.includes("sendText"))).toHaveLength(1);
  expect(db.prepare("SELECT COUNT(*) AS n FROM evolution_delivery_attempts").get()).toEqual({n:1});
  expect((db.prepare("SELECT next_attempt_at AS nextAt FROM evolution_attempt_state").get() as {nextAt:string}).nextAt).toBe("2026-10-16T12:00:08.000Z");
  await app.close();app=await buildApp(config,db);
  await flushWhatsAppOutbox(db,config,10);
  expect(fetch.mock.calls.filter(([url])=>url.includes("sendText"))).toHaveLength(1);
  vi.setSystemTime(new Date("2026-10-16T12:00:08Z"));await flushWhatsAppOutbox(db,config,10);
  expect(fetch.mock.calls.filter(([url])=>url.includes("sendText"))).toHaveLength(2);
  vi.restoreAllMocks();
 });
 it("limite de seis tentativas por grupo por dia vale no envio, inclusive após reinício",async()=>{
  vi.useFakeTimers({toFake:["Date"]});let stamp=Date.parse("2026-10-16T12:00:00Z");vi.setSystemTime(stamp);
  const fetch=fetchMock();vi.stubGlobal("fetch",fetch);
  for(let i=0;i<7;i++)queueGroupAutomation(db,config,"123456789@g.us","Grupo "+i,"groupcap-"+i);
  for(let i=0;i<7;i++){vi.setSystemTime(stamp+i*21000);await flushWhatsAppOutbox(db,config,10);}
  expect(fetch.mock.calls.filter(([url])=>url.includes("sendText"))).toHaveLength(6);
  expect(db.prepare("SELECT status,last_error,attempts FROM whatsapp_outbox WHERE dedupe_key='groupcap-6'").get()).toMatchObject({status:"PENDING",last_error:"EVOLUTION_GROUP_DAILY_CAP",attempts:0});
  expect(db.prepare("SELECT COUNT(*) AS n FROM evolution_delivery_attempts").get()).toEqual({n:6});
  expect((db.prepare("SELECT available_at AS at FROM whatsapp_outbox WHERE dedupe_key='groupcap-6'").get() as {at:string}).at).toBe("2026-10-17T03:00:00.000Z");
 });
 it("aquecimento conta tentativas reais totais e não reinicia ao reconectar",async()=>{
  vi.useFakeTimers({toFake:["Date"]});let stamp=Date.parse("2026-10-16T12:00:00Z");vi.setSystemTime(stamp);
  const fetch=fetchMock();vi.stubGlobal("fetch",fetch);
  for(let i=0;i<11;i++)queueGroupAutomation(db,config,(123456780+i)+"@g.us","Grupo "+i,"totalcap-"+i);
  for(let i=0;i<11;i++){vi.setSystemTime(stamp+i*21000);await flushWhatsAppOutbox(db,config,10);}
  expect(fetch.mock.calls.filter(([url])=>url.includes("sendText"))).toHaveLength(10);
  expect(db.prepare("SELECT last_error,attempts FROM whatsapp_outbox WHERE dedupe_key='totalcap-10'").get()).toMatchObject({last_error:"EVOLUTION_WARMUP_DAILY_CAP",attempts:0});
  db.prepare("UPDATE evolution_attempt_state SET first_seen_at=?").run(new Date(stamp-21*86400000).toISOString());
  db.prepare("UPDATE whatsapp_outbox SET available_at=? WHERE status='PENDING'").run(new Date(Date.now()).toISOString());
  await flushWhatsAppOutbox(db,config,10);
  expect(fetch.mock.calls.filter(([url])=>url.includes("sendText"))).toHaveLength(11);
 });
 it("workers concorrentes compartilham reserva e nunca enviam dois grupos juntos",async()=>{
  vi.useFakeTimers({toFake:["Date"]});vi.setSystemTime(new Date("2026-10-16T12:00:00Z"));
  const fetch=fetchMock();vi.stubGlobal("fetch",fetch);
  queueGroupAutomation(db,config,"123456789@g.us","Grupo1","parallel1");
  queueGroupAutomation(db,config,"123456780@g.us","Grupo2","parallel2");
  await Promise.all([flushWhatsAppOutbox(db,config),flushWhatsAppOutbox(db,config)]);
  expect(fetch.mock.calls.filter(([url])=>url.includes("sendText"))).toHaveLength(1);
  expect(db.prepare("SELECT COUNT(*) AS n FROM evolution_delivery_attempts").get()).toEqual({n:1});
 });
 it("OTP Evolution legado é invalidado antes de reservar tentativa ou transmitir segredo",async()=>{
  const fetch=fetchMock();vi.stubGlobal("fetch",fetch);
  queueGroupAutomation(db,config,"123456789@g.us","Sua chave de acesso ao SOS YOUTUBER é 123456.","old-otp");
  await flushWhatsAppOutbox(db,config);
  expect(fetch.mock.calls.some(([url])=>url.includes("sendText"))).toBe(false);
  expect(db.prepare("SELECT status,last_error,attempts FROM whatsapp_outbox WHERE dedupe_key='old-otp'").get()).toMatchObject({status:"FAILED",last_error:"WHATSAPP_OTP_OFFICIAL_CHANNEL_REQUIRED",attempts:0});
  expect(db.prepare("SELECT COUNT(*) AS n FROM evolution_delivery_attempts").get()).toEqual({n:0});
 });
 it("limite Evolution não atrasa a linha Meta independente de OTP no mesmo flush",async()=>{
  vi.useFakeTimers({toFake:["Date"]});vi.setSystemTime(new Date("2026-10-16T12:00:00Z"));
  const hybrid={...config,WHATSAPP_MODE:"HYBRID_PLUS" as const,WHATSAPP_BUSINESS_PHONE:"5511999999888",WHATSAPP_ACCESS_TOKEN:"test-official-token",WHATSAPP_PHONE_NUMBER_ID:"123456",WHATSAPP_APP_SECRET:"test-official-app-secret",WHATSAPP_VERIFY_TOKEN:"test-official-verify-secret",WHATSAPP_OTP_TEMPLATE:"sos_codigo"};
  saveWhatsAppIntegration(db,hybrid,{mode:"HYBRID_PLUS"});
  queueGroupAutomation(db,hybrid,"123456789@g.us","Grupo1","hybrid1");
  queueGroupAutomation(db,hybrid,"123456780@g.us","Grupo2","hybrid2");
  expect(queueWhatsAppOtp(db,hybrid,phone,"123456","hybridotp",new Date(Date.now()+300000).toISOString())).toBe(true);
  const fetch=vi.fn(async(url:string)=>url.includes("connectionState")?reply({instance:{state:"open"}}):url.includes("fetchInstances")?reply([{name:"sos-primary",ownerJid:"5511999999000@s.whatsapp.net"}]):url.includes("graph.facebook.com")?reply({messages:[{id:"meta-otp"}]}):reply({key:{id:"group-sent"}}));
  vi.stubGlobal("fetch",fetch);await flushWhatsAppOutbox(db,hybrid,10);
  expect(fetch.mock.calls.filter(([url])=>url.includes("sendText"))).toHaveLength(1);
  expect(fetch.mock.calls.filter(([url])=>url.includes("graph.facebook.com"))).toHaveLength(1);
  expect(db.prepare("SELECT status FROM whatsapp_outbox WHERE dedupe_key='hybridotp'").get()).toEqual({status:"SENT"});
 });
 it("falha de envio abre breaker persistente e reserva orçamento da tentativa incerta",async()=>{
  vi.useFakeTimers({toFake:["Date"]});const stamp=Date.parse("2026-10-16T12:00:00Z");vi.setSystemTime(stamp);
  queueGroupAutomation(db,config,"123456789@g.us","Grupo","breaker-1");
  queueGroupAutomation(db,config,"123456780@g.us","Grupo","breaker-2");
  const fetch=vi.fn(async(url:string)=>url.includes("connectionState")?reply({instance:{state:"open"}}):url.includes("fetchInstances")?reply([{name:"sos-primary",ownerJid:"5511999999000@s.whatsapp.net"}]):new Response("{}",{status:503}));
  vi.stubGlobal("fetch",fetch);await flushWhatsAppOutbox(db,config,10);
  vi.setSystemTime(stamp+25000);await flushWhatsAppOutbox(db,config,10);
  expect(fetch.mock.calls.filter(([url])=>url.includes("sendText"))).toHaveLength(1);
  expect(db.prepare("SELECT COUNT(*) AS n FROM evolution_delivery_attempts").get()).toEqual({n:1});
  expect((db.prepare("SELECT breaker_until AS at FROM evolution_attempt_state").get() as {at:string}).at).toBe("2026-10-16T12:01:00.000Z");
 });
 it("sincronização incompleta confirma presentes e não revoga em massa",async()=>{
  db.prepare("INSERT INTO integration_settings(key,value,updated_at) VALUES('bot.feature.GROUP_SYNC','1',?)").run(new Date().toISOString());
  vi.stubGlobal("fetch",vi.fn(async(url:string)=>url.includes("connectionState")?reply({instance:{state:"open"}}):url.includes("fetchInstances")?reply([{name:"sos-primary",ownerJid:"5511999999000@s.whatsapp.net"}]):reply([{id:"123456789@g.us",subject:"SOS YOUTUBER 1",size:20,participants:[{id:phone+"@s.whatsapp.net"}]}])));
  const result=await syncEvolutionWhatsAppGroups(db,config);
  expect(result).toMatchObject({linked:1,memberships:1,skipped:[{code:"1",reason:"PARTIAL_PARTICIPANTS"}]});
  expect(db.prepare("SELECT COUNT(*) AS n FROM group_memberships").get()).toEqual({n:0});
 });
});
