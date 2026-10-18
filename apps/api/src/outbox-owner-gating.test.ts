import { afterEach,beforeEach,describe,expect,it,vi } from "vitest";
import { createDatabase,type AppDatabase } from "./db.js";
import { loadConfig,type Config } from "./config.js";
import { saveAutomationSettings } from "./bot-automation-store.js";
import { saveBotSettings } from "./bot.js";
import { queueBotNotification,queueGroupAutomation,flushWhatsAppOutbox } from "./whatsapp.js";
describe("outbox rechecks Owner decisions before delivery",()=>{
 let db:AppDatabase,config:Config;
 let send:ReturnType<typeof vi.fn>;
 const root={id:"root:test",name:"Root"};
 beforeEach(()=>{
  vi.useFakeTimers({toFake:["Date"]});vi.setSystemTime(new Date("2026-10-17T15:00:00Z"));
  db=createDatabase(":memory:");
  config=loadConfig({NODE_ENV:"test",DATABASE_PATH:":memory:",EVOLUTION_URL:"https://evolution.example.test",EVOLUTION_INSTANCE:"sos-primary",EVOLUTION_PHONE:"5511999999000",EVOLUTION_API_KEY:"synthetic-api-key",EVOLUTION_WEBHOOK_SECRET:"synthetic-webhook-secret-32-characters"});
  db.prepare("INSERT INTO groups(code,enabled,whatsapp_group_id) VALUES('1',1,'123456789@g.us')").run();
  send=vi.fn(async(url:string)=>new Response(JSON.stringify(url.includes("connectionState")?{instance:{state:"open"}}:url.includes("fetchInstances")?[{name:"sos-primary",ownerJid:"5511999999000@s.whatsapp.net"}]:{key:{id:"confirmed"}}),{status:200}));
  vi.stubGlobal("fetch",send);
 });
 afterEach(()=>{db.close();vi.unstubAllGlobals();vi.useRealTimers();});
 function expectSuppressed(reason:string){
  expect(db.prepare("SELECT status,attempts,last_error FROM whatsapp_outbox").get()).toEqual({status:"FAILED",attempts:0,last_error:reason});
  expect(db.prepare("SELECT COUNT(*) AS n FROM evolution_delivery_attempts").get()).toEqual({n:0});
  expect(send.mock.calls.some(([url])=>String(url).includes("/message/sendText/"))).toBe(false);
 }
 it("does not deliver an event disabled while it was queued",async()=>{
  queueGroupAutomation(db,config,"123456789@g.us","Fila pronta","queue-disabled",{event:"QUEUE_COMPLETE",deliveryClass:"QUEUE"});
  saveAutomationSettings(db,"QUEUE_COMPLETE",{enabled:false},root);
  await flushWhatsAppOutbox(db,config);expectSuppressed("EVENT_DISABLED");
 });
 it("honors the feature switch changed after queueing",async()=>{
  queueGroupAutomation(db,config,"123456789@g.us","Fila pronta","feature-disabled",{event:"QUEUE_COMPLETE",deliveryClass:"QUEUE"});
  saveBotSettings(db,{features:{QUEUE_ANNOUNCE:false}});
  await flushWhatsAppOutbox(db,config);expectSuppressed("EVENT_DISABLED");
 });
 it("does not post into a group disabled after queueing",async()=>{
  queueGroupAutomation(db,config,"123456789@g.us","Aviso","group-disabled",{event:"GOOD_MORNING",deliveryClass:"ENGAGEMENT"});
  db.prepare("UPDATE groups SET enabled=0 WHERE code='1'").run();
  await flushWhatsAppOutbox(db,config);expectSuppressed("GROUP_DISABLED");
 });
 it("also rechecks encrypted catalog DM jobs",async()=>{
  queueBotNotification(db,config,"5511999999001","Moedas recebidas","encrypted-coins",undefined,{event:"COINS_EARNED",deliveryClass:"REWARD",encryptPayload:true});
  saveAutomationSettings(db,"COINS_EARNED",{enabled:false},root);
  await flushWhatsAppOutbox(db,config);expectSuppressed("EVENT_DISABLED");
 });
 it("does not confuse monthly prize DMs with disabled public rankings",async()=>{
  saveAutomationSettings(db,"MONTHLY_TOP",{enabled:false},root);
  saveBotSettings(db,{features:{BROADCAST:false}});
  queueBotNotification(db,config,"5511999999001","Seu prêmio mensal","gamification:synthetic-month",undefined,{deliveryClass:"REWARD",event:"MONTHLY_TOP"});
  await flushWhatsAppOutbox(db,config);
  expect(db.prepare("SELECT status FROM whatsapp_outbox").get()).toEqual({status:"SENT"});
 });
 it("preserves a direct transactional reply outside the catalog",async()=>{
  saveAutomationSettings(db,"SUPPORT_HANDOFF",{enabled:false},root);
  queueBotNotification(db,config,"5511999999001","Equipe avisada","human-direct",undefined,{deliveryClass:"TRANSACTIONAL",event:"HUMAN_FALLBACK"});
  await flushWhatsAppOutbox(db,config);
  expect(db.prepare("SELECT status FROM whatsapp_outbox").get()).toEqual({status:"SENT"});
  expect(send.mock.calls.filter(([url])=>String(url).includes("/message/sendText/"))).toHaveLength(1);
 });
});
