import {setHumanSupportNumber} from "./bot-human-handoff.js";
import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {randomUUID} from "node:crypto";
import {mkdtempSync,rmSync,statSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import Database from "better-sqlite3";
import {buildApp} from "./app.js";
import {createDatabase,backupBeforeBotRuntimeMigration,type AppDatabase} from "./db.js";
import {loadConfig} from "./config.js";
import {saveBotSettings,botStatus} from "./bot.js";
import {saveAutomationSettings} from "./bot-automation-store.js";

describe("Root controla o runtime durável do bot",()=>{
 let db:AppDatabase,app:Awaited<ReturnType<typeof buildApp>>,token:string;
 beforeEach(async()=>{
  vi.stubGlobal("fetch",vi.fn(()=>{throw new Error("No external delivery in route tests");}));
  db=createDatabase(":memory:");
  app=await buildApp(loadConfig({NODE_ENV:"test",DATABASE_PATH:":memory:",REQUIRE_GROUP_MEMBERSHIP:"false",
   JWT_SECRET:"runtime-route-secret-32-characters",EVOLUTION_URL:"https://evolution.example.test",EVOLUTION_INSTANCE:"sos-primary",EVOLUTION_PHONE:"5571999990999",EVOLUTION_API_KEY:"synthetic-key",EVOLUTION_WEBHOOK_SECRET:"synthetic-webhook-secret-32-long",OWNER_FABIO_NAME:"Fabio0",OWNER_FABIO_ID:"fabio0",
   OWNER_FABIO_SECRET:"runtime-root-secret-32-characters",OWNER_FABIO_WHATSAPP:"5571999990001"}),db);
  const login=await app.inject({method:"POST",url:"/admin/login",payload:{name:"Fabio0",identifier:"5571999990001",groupCode:"#",secret:"runtime-root-secret-32-characters"}});
  expect(login.statusCode).toBe(200);token=login.json().token;
 });
 afterEach(async()=>{await app.close();db.close();vi.unstubAllGlobals();});
 it("status e envio exigem Root; broadcast exige as duas chaves e deduplica envio/auditoria",async()=>{
  const url="/admin/bot/automations/BROADCAST_GLOBAL/dispatch",payload={message:"Aviso sintético de teste",referenceId:randomUUID()};
  expect((await app.inject({url:"/admin/bot/automations/runtime"})).statusCode).toBe(401);
  expect((await app.inject({method:"POST",url,payload})).statusCode).toBe(401);
  const headers={authorization:"Bearer "+token};
  expect((await app.inject({method:"POST",url,headers,payload})).statusCode).toBe(409);
  saveBotSettings(db,{features:{BROADCAST:true}});
  expect((await app.inject({method:"POST",url,headers,payload})).statusCode).toBe(409);
  saveAutomationSettings(db,"BROADCAST_GLOBAL",{enabled:true});
  const first=await app.inject({method:"POST",url,headers,payload});
  expect(first.statusCode,first.body).toBe(202);
  const second=await app.inject({method:"POST",url,headers,payload});
  expect(second.json().eventId).toBe(first.json().eventId);
  expect(db.prepare("SELECT COUNT(*) AS n FROM bot_automation_events WHERE event='BROADCAST_GLOBAL'").get()).toEqual({n:1});
  expect(db.prepare("SELECT COUNT(*) AS n FROM bot_automation_audit WHERE field='dispatch'").get()).toEqual({n:1});
  const status=await app.inject({url:"/admin/bot/automations/runtime",headers});
  expect(status.statusCode).toBe(200);
  expect(status.json().capabilities).toContainEqual({event:"COINS_EARNED",status:"WIRED_WALLET_LEDGER"});
  expect(fetch).not.toHaveBeenCalled();
 });
 it("Evolution usa senha do bot e não declara OTP oficial ativo",()=>{
  saveBotSettings(db,{mode:"EVOLUTION"});
  const status=botStatus(db,loadConfig({NODE_ENV:"test",DATABASE_PATH:":memory:",EVOLUTION_URL:"https://evolution.example.test",
   EVOLUTION_INSTANCE:"sos-primary",EVOLUTION_PHONE:"5571999990999",EVOLUTION_API_KEY:"synthetic-key",EVOLUTION_WEBHOOK_SECRET:"synthetic-secret-32-long"}));
  expect(status.features.find(f=>f.code==="LOGIN_CODE")).toMatchObject({active:false});
  expect(status.features.find(f=>f.code==="SUPPORT_CHAT")).toMatchObject({active:true});
 });
 it("teste envia exclusivamente para o Root logado, respeita intervalo e exige recibo",async()=>{
  saveBotSettings(db,{mode:"EVOLUTION"});
  const headers={authorization:"Bearer "+token},url="/admin/bot/test-message",payload={referenceId:randomUUID(),phone:"5511999990000"};
  const first=await app.inject({url,headers,method:"POST",payload});
  expect(first.statusCode,first.body).toBe(202);
  const id=first.json().outboxId;
  expect(db.prepare("SELECT recipient FROM whatsapp_outbox WHERE id=?").get(id)).toEqual({recipient:"5571999990001"});
  const retry=await app.inject({url,headers,method:"POST",payload});expect(retry.json().outboxId).toBe(id);
  expect((await app.inject({url,headers,method:"POST",payload:{referenceId:randomUUID()}})).statusCode).toBe(409);
  expect((await app.inject({url:url+"/"+id,headers})).json()).toMatchObject({status:"PENDING",providerConfirmed:false});
  db.prepare("UPDATE whatsapp_outbox SET status='SENT',provider_message_id='synthetic-provider-receipt' WHERE id=?").run(id);
  expect((await app.inject({url:url+"/"+id,headers})).json()).toMatchObject({status:"SENT",providerConfirmed:true});
  expect((await app.inject({url:url+"/"+randomUUID(),headers})).statusCode).toBe(404);
  expect(fetch).not.toHaveBeenCalled();
 });
 it("teste de handoff usa destinatário humano configurado e recebe recibo pelo mesmo caminho",async()=>{
  saveBotSettings(db,{mode:"EVOLUTION"});setHumanSupportNumber(db,"5571999990888");
  const headers={authorization:"Bearer "+token},payload={referenceId:randomUUID(),target:"HUMAN"};
  const result=await app.inject({method:"POST",url:"/admin/bot/test-message",headers,payload});
  expect(result.statusCode,result.body).toBe(202);
  const id=result.json().outboxId;
  expect(db.prepare("SELECT recipient FROM whatsapp_outbox WHERE id=?").get(id)).toEqual({recipient:"5571999990888"});
  expect((await app.inject({method:"POST",url:"/admin/bot/test-message",headers,payload})).json().outboxId).toBe(id);
  expect((await app.inject({url:"/admin/bot/test-message/"+id,headers})).json().providerConfirmed).toBe(false);
  expect(fetch).not.toHaveBeenCalled();
 });
 it("horário humano é persistido e auditado só pelo Root",async()=>{
  const url="/admin/bot/support-availability",headers={authorization:"Bearer "+token};
  expect((await app.inject({url})).statusCode).toBe(401);
  expect((await app.inject({url,headers})).json()).toMatchObject({enabled:false,availableNow:true,timeZone:"America/Bahia"});
  const saved=await app.inject({url,headers,method:"POST",payload:{enabled:true,days:[1,2,3,4,5],startHour:9,endHour:18}});
  expect(saved.statusCode,saved.body).toBe(200);
  expect((await app.inject({url,headers})).json()).toMatchObject({enabled:true,days:[1,2,3,4,5],startHour:9,endHour:18});
 });
});

it("backup pré-runtime preserva WAL confirmado, integridade e permissão privada",async()=>{
 const folder=mkdtempSync(join(tmpdir(),"sos-bot-backup-"));
 try{
  const file=join(folder,"app.sqlite"),live=new Database(file);
  live.pragma("journal_mode=WAL");live.exec("CREATE TABLE users(id TEXT PRIMARY KEY,name TEXT);INSERT INTO users VALUES('a','Pessoa sintética')");
  const path=await backupBeforeBotRuntimeMigration(file);
  expect(path).toBeTruthy();expect(statSync(path!).mode&0o777).toBe(0o600);
  const restored=new Database(path!,{readonly:true});
  expect(restored.pragma("quick_check",{simple:true})).toBe("ok");
  expect(restored.prepare("SELECT name FROM users WHERE id='a'").get()).toEqual({name:"Pessoa sintética"});restored.close();
  live.exec("CREATE TABLE bot_automation_events(id TEXT)");live.close();
  expect(await backupBeforeBotRuntimeMigration(file)).toBeUndefined();
 }finally{rmSync(folder,{recursive:true,force:true});}
});
