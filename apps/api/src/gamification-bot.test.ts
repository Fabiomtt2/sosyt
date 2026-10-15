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
  expect(readGamificationBot(db).deliveries[0]).toMatchObject({eventId:id,status:"WAITING",reason:"META_NOT_READY"});
  expect(fetch).not.toHaveBeenCalled();
 });
 it("Híbrido+ comjanela real24h criaoutbox uma vez;SENT vem apenas do recibo real",()=>{
  ready();proof();const id=event();
  expect(dispatchGamificationEvents(db,config)).toMatchObject({queued:1,internalDelivered:1,sent:0});
  dispatchGamificationEvents(db,config);
  expect(db.prepare("SELECT COUNT(*) AS n FROM whatsapp_outbox").get()).toEqual({n:1});
  expect(readGamificationBot(db).deliveries[0]).toMatchObject({eventId:id,status:"QUEUED"});
  const outbox=db.prepare("SELECT id,payload,expires_at AS expires FROM whatsapp_outbox").get() as {id:string;payload:string;expires:string};
  expect(JSON.parse(outbox.payload)).toMatchObject({type:"text",text:{body:expect.stringContaining("nível 2")}});
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
});
