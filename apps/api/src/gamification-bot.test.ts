import { saveAutomationSettings } from "./bot-automation-store.js";
import { randomUUID } from "node:crypto";
import { afterEach,beforeEach,describe,expect,it,vi } from "vitest";
import { createDatabase,type AppDatabase } from "./db.js";
import { loadConfig,type Config } from "./config.js";
import { initializeGamification } from "./gamification.js";
import { initializeGamificationBot,readGamificationBot,saveGamificationBot,dispatchGamificationEvents } from "./gamification-bot.js";

describe("ponte real de avisos de gamificação",()=>{
 let db:AppDatabase;let config:Config;const phone="5571999990001";const userId="bot-person";
 beforeEach(()=>{
  vi.useFakeTimers();vi.setSystemTime(new Date("2026-10-16T09:00:00Z"));vi.stubGlobal("fetch",vi.fn(()=>{throw new Error("External sending forbidden in bridge tests");}));
  config=loadConfig({NODE_ENV:"test",DATABASE_PATH:":memory:",JWT_SECRET:"bot-gamification-jwt-32-characters",AUTH_CODE_PEPPER:"bot-gamification-pepper-32-characters"});
  db=createDatabase(":memory:");initializeGamification(db);initializeGamificationBot(db);
  const stamp=new Date().toISOString();
  db.prepare("INSERT INTO users(id,name,phone,group_code,created_at,updated_at) VALUES(?,?,?,'1',?,?)").run(userId,"Ana",phone,stamp,stamp);
  db.prepare("INSERT INTO wallets(user_id,updated_at) VALUES(?,?)").run(userId,stamp);
 });
 afterEach(()=>{db.close();vi.unstubAllGlobals();vi.useRealTimers();});
 const event=(kind="LEVEL_UP",payload={level:2,coins:1} as Record<string,unknown>)=>{
  const id=randomUUID();db.prepare("INSERT INTO gamification_bot_events(id,event,user_id,payload_json,created_at) VALUES(?,?,?,?,?)").run(id,kind,userId,JSON.stringify(payload),new Date().toISOString());return id;
 };
 const ready=(mode="HYBRID_PLUS")=>{
  db.prepare("INSERT INTO integration_settings(key,value,updated_at) VALUES('whatsapp.mode',?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at").run(mode,new Date().toISOString());
  config={...config,NODE_ENV:"test",WHATSAPP_ACCESS_TOKEN:"synthetic-token",WHATSAPP_PHONE_NUMBER_ID:"123456789",WHATSAPP_BUSINESS_ACCOUNT_ID:"123456789",WHATSAPP_APP_SECRET:"synthetic-app-secret",WHATSAPP_VERIFY_TOKEN:"synthetic-verify-token"};
 };
 const proof=(source="WHATSAPP",at=new Date().toISOString())=>{
  db.prepare("INSERT INTO participation_requests(id,phone,name,status,created_at,updated_at,source,whatsapp_verified_at) VALUES(?,?,?,'APPROVED',?,?,?,?) ON CONFLICT(phone) DO UPDATE SET source=excluded.source,whatsapp_verified_at=excluded.whatsapp_verified_at")
   .run("request-fixture",phone,"Ana",new Date().toISOString(),new Date().toISOString(),source,at);
 };
 it("semchip/conexão entregaSYSTEM interno uma vez e mantémWhatsAppWAITING",()=>{
  const id=event();
  expect(dispatchGamificationEvents(db,config)).toMatchObject({internalDelivered:1,queued:0,waiting:1,sent:0});
  expect(dispatchGamificationEvents(db,config)).toMatchObject({internalDelivered:0,queued:0,waiting:1,sent:0});
  expect(db.prepare("SELECT sender_role AS role,body FROM mail_messages WHERE id=?").get("gamification:"+id)).toMatchObject({role:"SYSTEM",body:expect.stringContaining("Ana")});
  expect(db.prepare("SELECT COUNT(*) AS n FROM whatsapp_outbox").get()).toEqual({n:0});
  expect(readGamificationBot(db).deliveries[0]).toMatchObject({eventId:id,status:"WAITING",reason:"EVOLUTION_NOT_READY"});
  expect(fetch).not.toHaveBeenCalled();
 });
 it("Híbrido+ comjanela real24h criaoutbox uma vez;SENT vem apenas do recibo real",()=>{
  ready();proof();const id=event();
  expect(dispatchGamificationEvents(db,config)).toMatchObject({queued:1,internalDelivered:1,sent:0});
  dispatchGamificationEvents(db,config);
  expect(db.prepare("SELECT COUNT(*) AS n FROM whatsapp_outbox").get()).toEqual({n:1});
  expect(readGamificationBot(db).deliveries[0]).toMatchObject({eventId:id,status:"QUEUED"});
  const outbox=db.prepare("SELECT id,payload,expires_at AS expires FROM whatsapp_outbox").get() as {id:string;payload:string;expires:string};
  expect(JSON.parse(outbox.payload)).toMatchObject({type:"text",text:{body:expect.stringMatching(/nível 2/i)}});
  expect(outbox.expires).toBe("2026-10-17T09:00:00.000Z");
  db.prepare("UPDATE whatsapp_outbox SET status='SENT',provider_message_id='actual-provider-receipt-fixture' WHERE id=?").run(outbox.id);
  expect(dispatchGamificationEvents(db,config).sent).toBe(1);
  expect(readGamificationBot(db).deliveries[0]).toMatchObject({status:"SENT"});
  expect(fetch).not.toHaveBeenCalled();
 });
 it("semjanela exige templateaprovado configurado;FAILED refletefalha daoutbox",()=>{
  ready("OFFICIAL");event("MONTHLY_TOP",{place:1,xp:300,coins:15});
  const settings=readGamificationBot(db).settings;
  settings.events.MONTHLY_TOP.templateName="sos_recompensa_aprovada";
  settings.events.MONTHLY_TOP.text="Parabéns, {name}! {rank}º lugar: {coins} moedas.";
  saveGamificationBot(db,settings,"root-fixture");
  expect(dispatchGamificationEvents(db,config).queued).toBe(1);
  const outbox=db.prepare("SELECT id,payload FROM whatsapp_outbox").get() as {id:string;payload:string};
  expect(JSON.parse(outbox.payload)).toMatchObject({type:"template",template:{name:"sos_recompensa_aprovada",language:{code:"pt_BR"},components:[{type:"body",parameters:[{type:"text",text:"Parabéns, Ana! 1º lugar: 15 moedas."}]}]}});
  db.prepare("UPDATE whatsapp_outbox SET status='FAILED' WHERE id=?").run(outbox.id);
  expect(dispatchGamificationEvents(db,config).failed).toBe(1);
  expect(readGamificationBot(db).deliveries[0]).toMatchObject({status:"FAILED",reason:"OUTBOX_FAILED"});
  expect(dispatchGamificationEvents(db,config).queued).toBe(0);expect(fetch).not.toHaveBeenCalled();
 });
 it("aprovaçãoOwner e relógiofuturo não inventamjanela;alteração/configuraçãoeintegração sãoauditadas",()=>{
  ready();proof("OWNER");event();
  expect(dispatchGamificationEvents(db,config).queued).toBe(0);
  expect(readGamificationBot(db).deliveries[0]).toMatchObject({status:"WAITING",reason:"TEMPLATE_OR_SERVICE_WINDOW_REQUIRED"});
  proof("WHATSAPP","2026-10-16T10:00:00Z");expect(dispatchGamificationEvents(db,config).queued).toBe(0);
  proof();expect(dispatchGamificationEvents(db,config).queued).toBe(1);
  ready("DISABLED");event("REWARD_REDEEMED",{itemCode:"PASS",priceCoins:100});
  expect(dispatchGamificationEvents(db,config)).toMatchObject({queued:0,internalDelivered:1,waiting:1});
  const settings=readGamificationBot(db).settings;
  settings.events.LEVEL_UP.text="Olá {secret}!";expect(()=>saveGamificationBot(db,settings,"root")).toThrow();
  settings.events.LEVEL_UP.text="Olá {name}!";saveGamificationBot(db,settings,"root");
  expect(db.prepare("SELECT actor_id AS actor FROM gamification_bot_config_audit").get()).toEqual({actor:"root"});
  expect(readGamificationBot(db).runtime.wired).toBe(true);expect(fetch).not.toHaveBeenCalled();
 });

 it("os cinco eventos reais criam uma mensagem interna e uma outbox cada, sem replay",()=>{
  ready();proof();
  const events=[
   ["LEVEL_UP",{level:2,coins:1}],
   ["BOOSTER_CLAIMED",{code:"PASS",quantity:1}],
   ["MONTHLY_TOP",{place:1,xp:300,coins:15}],
   ["REWARD_REDEEMED",{itemCode:"SKIP",priceCoins:100}],
   ["REWARD_COINS_GIFTED",{coins:3}]
  ] as const;
  // Separate days respect the real per-person daily budget rather than disabling it.
  for(const [kind,payload] of events){
   proof();event(kind,payload);
   expect(dispatchGamificationEvents(db,config)).toMatchObject({processed:1,queued:1,internalDelivered:1});
   expect(dispatchGamificationEvents(db,config)).toMatchObject({processed:0,queued:0,internalDelivered:0});
   vi.advanceTimersByTime(86400000);
  }
  expect(db.prepare("SELECT COUNT(*) AS n FROM whatsapp_outbox").get()).toEqual({n:5});
  expect(db.prepare("SELECT COUNT(*) AS n FROM mail_messages WHERE sender_role='SYSTEM'").get()).toEqual({n:5});
  expect(fetch).not.toHaveBeenCalled();
 });
 it("LEVEL_UP respeita texto e pausa do catálogo Owner no mesmo consumidor, uma vez",()=>{
  ready();proof();
  saveAutomationSettings(db,"LEVEL_UP",{enabled:false,text:"Olá {nome}, nível {nivel}!"},{id:"owner-fixture",name:"Root"});
  const id=event();
  expect(dispatchGamificationEvents(db,config)).toMatchObject({queued:0,internalDelivered:0,waiting:1});
  saveAutomationSettings(db,"LEVEL_UP",{enabled:true},{id:"owner-fixture",name:"Root"});
  expect(dispatchGamificationEvents(db,config)).toMatchObject({queued:1,internalDelivered:1});
  dispatchGamificationEvents(db,config);
  expect(db.prepare("SELECT body FROM mail_messages WHERE id=?").get("gamification:"+id)).toEqual({body:"Olá Ana, nível 2!"});
  expect(db.prepare("SELECT COUNT(*) AS n FROM whatsapp_outbox").get()).toEqual({n:1});
  expect(fetch).not.toHaveBeenCalled();
 });
 it("migra só o antigo texto padrão de presente e preserva personalizações",()=>{
  const settings=readGamificationBot(db).settings;
  settings.events.REWARD_COINS_GIFTED.text="Oi, {name}! Você recebeu um presente de {coins} moedas de recompensa da comunidade. Elas já estão disponíveis na sua conta!";
  saveGamificationBot(db,settings,"root");
  initializeGamificationBot(db);
  expect(readGamificationBot(db).settings.events.REWARD_COINS_GIFTED.text).toContain("{coins} moedas da comunidade");
  const custom=readGamificationBot(db).settings;
  custom.events.REWARD_COINS_GIFTED.text="Um carinho de {coins} moedas para {name}.";
  saveGamificationBot(db,custom,"root");
  initializeGamificationBot(db);
  expect(readGamificationBot(db).settings.events.REWARD_COINS_GIFTED.text).toBe(custom.events.REWARD_COINS_GIFTED.text);
 });
});
