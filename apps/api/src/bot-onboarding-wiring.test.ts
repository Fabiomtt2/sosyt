import { afterEach,beforeEach,describe,expect,it,vi } from "vitest";
import { createDatabase,type AppDatabase } from "./db.js";
import { loadConfig,type Config } from "./config.js";
import { buildApp } from "./app.js";
import { saveAutomationSettings } from "./bot-automation-store.js";
import { gamificationConfig } from "./gamification.js";
import { createEvolutionClient } from "./bot-evolution.js";
import { queueGroupAutomation,queueParticipationDecision,syncEvolutionWhatsAppGroups } from "./whatsapp.js";
describe("real catalog onboarding and LID identity",()=>{
 let db:AppDatabase,config:Config,app:Awaited<ReturnType<typeof buildApp>>;
 const phone="5511999999001",secret="synthetic-webhook-secret-32-characters";
 const response=(body:unknown)=>new Response(JSON.stringify(body),{status:200});
 beforeEach(async()=>{
  config=loadConfig({NODE_ENV:"test",DATABASE_PATH:":memory:",EVOLUTION_URL:"https://evolution.example.test",EVOLUTION_INSTANCE:"sos-primary",EVOLUTION_PHONE:"5511999999000",EVOLUTION_API_KEY:"test-api-key",EVOLUTION_WEBHOOK_SECRET:secret,WHATSAPP_GROUPS_SYNC_ENABLED:"true"});
  db=createDatabase(":memory:");app=await buildApp(config,db);
 });
 afterEach(async()=>{await app.close();db.close();vi.unstubAllGlobals();});
 it("LID cannot certify a connected session phone",async()=>{
  const client=createEvolutionClient({config:{url:"https://evolution.example.test",instance:"sos-primary",apiKey:"synthetic-key",number:"5511999999000"},
   fetchImpl:async(url)=>response(String(url).includes("connectionState")?{instance:{state:"open"}}:[{name:"sos-primary",ownerJid:"123456789000@lid"}])});
  expect(await client.health()).toMatchObject({connected:false,state:"identity_unverified"});
 });
 it("bootstraps the existing group silently, welcomes a later LID arrival once",async()=>{
  let members=[{id:"900000000001@lid",phoneNumber:phone+"@s.whatsapp.net"}];
  vi.stubGlobal("fetch",vi.fn(async(url:string)=>response(url.includes("connectionState")?{instance:{state:"open"}}:url.includes("fetchInstances")?[{name:"sos-primary",ownerJid:"5511999999000@s.whatsapp.net"}]:
    [{id:"123456789@g.us",subject:"SOS YOUTUBER 1",participants:members,size:members.length}])));
  saveAutomationSettings(db,"WELCOME_MEMBER",{text:"Olá {nome}, grupo {grupo}: {link}"},{id:"root:test",name:"Root"});
  await syncEvolutionWhatsAppGroups(db,config);
  expect(db.prepare("SELECT COUNT(*) AS n FROM whatsapp_outbox").get()).toEqual({n:0});
  members=[...members,{id:"900000000002@lid",phoneNumber:"5511999999002@s.whatsapp.net"}];
  await syncEvolutionWhatsAppGroups(db,config);await syncEvolutionWhatsAppGroups(db,config);
  expect(db.prepare("SELECT COUNT(*) AS n FROM whatsapp_outbox").get()).toEqual({n:1});
  const row=db.prepare("SELECT recipient,payload FROM whatsapp_outbox").get() as {recipient:string;payload:string};
  expect(row.recipient).toBe("123456789@g.us");expect(row.payload).toContain("grupo 1");
  expect(row.payload).not.toContain("900000000002");expect(row.payload).not.toContain("5511999999002");
 });
 it("discovery 500 recupera somente grupos pareados e falha individual preserva vínculos",async()=>{
  db.prepare("UPDATE groups SET enabled=1,whatsapp_group_id='123456789@g.us',membership_mode='EVOLUTION' WHERE code='1'").run();
  db.prepare("UPDATE groups SET enabled=1,whatsapp_group_id='223456789@g.us',membership_mode='EVOLUTION' WHERE code='2'").run();
  const at=new Date().toISOString();
  db.prepare("INSERT INTO group_memberships(phone,group_code,approved_at,source) VALUES(?,'2',?,'VERIFIED_EVOLUTION')").run("5511999999002",at);
  vi.stubGlobal("fetch",vi.fn(async(url:string)=>{
    if(url.includes("connectionState"))return response({instance:{state:"open"}});
    if(url.includes("fetchInstances"))return response([{name:"sos-primary",ownerJid:"5511999999000@s.whatsapp.net"}]);
    if(url.includes("fetchAllGroups"))return new Response("{}",{status:500});
    if(url.includes("participants")&&url.includes("123456789"))return response({participants:[{id:"900000000001@lid",phoneNumber:phone+"@s.whatsapp.net"}]});
    return new Response("{}",{status:500});
  }));
  const result=await syncEvolutionWhatsAppGroups(db,config);
  expect(result.linked).toBe(1);
  expect(result.skipped).toContainEqual({code:"discovery",reason:"GROUP_DISCOVERY_UNAVAILABLE"});
  expect(result.skipped).toContainEqual({code:"2",reason:"GROUP_PARTICIPANTS_UNAVAILABLE"});
  expect(db.prepare("SELECT group_code AS code,revoked_at AS revoked FROM whatsapp_member_verifications WHERE phone=? AND provider='EVOLUTION'").get(phone)).toMatchObject({code:"1",revoked:null});
  expect(db.prepare("SELECT revoked_at AS revoked FROM group_memberships WHERE phone='5511999999002'").get()).toEqual({revoked:null});
 });
 it("onboarding uses the saved welcome and still asks for the name",async()=>{
  saveAutomationSettings(db,"WELCOME_DM",{text:"Boas-vindas especiais, {nome}! Acesse {link}."},{id:"root:test",name:"Root"});
  const payload={event:"MESSAGES_UPSERT",instance:"sos-primary",data:{key:{id:"hello",remoteJid:phone+"@s.whatsapp.net"},messageTimestamp:Math.floor(Date.now()/1000),message:{conversation:"Quero participar"}}};
  expect((await app.inject({method:"POST",url:"/webhooks/whatsapp/evolution",headers:{"x-sos-webhook-secret":secret},payload})).statusCode).toBe(200);
  const rows=db.prepare("SELECT payload FROM whatsapp_outbox").all() as Array<{payload:string}>;
  expect(rows.some(r=>r.payload.includes("Boas-vindas especiais"))).toBe(true);
  expect(rows.some(r=>r.payload.includes("Como gostaria de ser chamado"))).toBe(true);
 });
 it("approved decision uses catalog copy and its disable switch",()=>{
  const at=new Date().toISOString();
  db.prepare("INSERT INTO participation_requests(id,phone,name,status,source,created_at,updated_at) VALUES(?,?,?,'APPROVED','WHATSAPP',?,?)").run("request:test",phone,"Pessoa Sintética",at,at);
  saveAutomationSettings(db,"WELCOME_DM",{text:"Liberado, {nome}! Grupo {grupo}: {link}"},{id:"root:test",name:"Root"});
  expect(queueParticipationDecision(db,config,"request:test","APPROVED","1")).toBe(true);
  expect((db.prepare("SELECT payload FROM whatsapp_outbox").get() as {payload:string}).payload).toContain("Liberado, Pessoa Sintética! Grupo 1");
  saveAutomationSettings(db,"WELCOME_DM",{enabled:false},{id:"root:test",name:"Root"});
  expect(queueParticipationDecision(db,config,"request:test","APPROVED","2")).toBe(false);
  expect(db.prepare("SELECT COUNT(*) AS n FROM whatsapp_outbox").get()).toEqual({n:1});
 });
 it("LID webhook reads persisted wallet and ranks without crediting again or ranking Root",async()=>{
  const at=new Date().toISOString();
  for(const [id,name,number,xp] of [
    ["live-user","Lia",phone,75],
    ["live-root","Root Sintético","5511999999003",9999],
  ] as const){
    db.prepare("INSERT INTO users(id,name,phone,group_code,created_at,updated_at) VALUES(?,?,?,'1',?,?)").run(id,name,number,at,at);
    db.prepare("INSERT INTO wallets(user_id,promo_millis,purchased_millis,reward_millis,extra_slot_passes,updated_at) VALUES(?,10000,2000,3000,2,?)").run(id,at);
    db.prepare("INSERT INTO gamification_users(user_id,curve_json,created_at) VALUES(?,?,?)").run(id,JSON.stringify(gamificationConfig(db).curve),at);
    db.prepare("INSERT INTO gamification_events(id,user_id,kind,reference_id,xp_delta,payload_json,created_at) VALUES(?,?,'VIDEO_XP','verified-fixture',?,'{}',?)").run("xp:"+id,id,xp,at);
  }
  db.prepare("INSERT INTO owner_access(id,user_id,phone,normalized_name,role,created_at,updated_at) VALUES('live-root-access','live-root','5511999999003','root sintetico','ROOT_OWNER',?,?)").run(at,at);
  db.prepare("INSERT INTO group_memberships(phone,group_code,approved_at,source) VALUES(?,'1',?,'VERIFIED_EVOLUTION')").run(phone,at);
  const snapshot=()=>({
    wallets:db.prepare("SELECT user_id,promo_millis,purchased_millis,reward_millis,extra_slot_passes FROM wallets ORDER BY user_id").all(),
    ledger:db.prepare("SELECT COUNT(*) AS n FROM wallet_ledger").get(),
    xp:db.prepare("SELECT COUNT(*) AS n,SUM(xp_delta) AS xp FROM gamification_events").get(),
  });
  const before=snapshot();
  const send=async(id:string,text:string)=>app.inject({
    method:"POST",url:"/webhooks/whatsapp/evolution",headers:{"x-sos-webhook-secret":secret},
    payload:{event:"MESSAGES_UPSERT",instance:"sos-primary",data:{
      key:{id,remoteJid:"900000000001@lid",remoteJidAlt:phone+"@s.whatsapp.net"},
      messageTimestamp:Math.floor(Date.now()/1000),message:{conversation:text},
    }},
  });
  expect((await send("live-wallet","carteira")).statusCode).toBe(200);
  expect((await send("live-ranking","ranking")).statusCode).toBe(200);
  const rows=db.prepare("SELECT recipient,payload FROM whatsapp_outbox WHERE recipient=? ORDER BY rowid").all(phone) as Array<{recipient:string;payload:string}>;
  const bodies=rows.map(row=>(JSON.parse(row.payload) as {text?:{body:string}}).text?.body??"");
  expect(bodies.some(body=>body.includes("Lia,")&&body.includes("75 XP")&&body.includes("Moedas: 15")&&body.includes("Compradas: 2")&&body.includes("Passe: 2"))).toBe(true);
  const rank=bodies.find(body=>body.includes("TOP 3 real"))!;
  expect(rank).toContain("1º Lia · 75 XP");
  expect(rank).toContain("Ranking global");
  expect(rank).not.toContain("Root Sintético");
  expect(rank).not.toContain("9999 XP");
  expect(rows.every(row=>row.recipient===phone)).toBe(true);
  expect(snapshot()).toEqual(before);
 });
 it("group jobs preserve their event and delivery class",()=>{
  queueGroupAutomation(db,config,"123456789@g.us","Fila pronta","ready",{event:"QUEUE_COMPLETE",deliveryClass:"QUEUE"});
  const row=db.prepare("SELECT payload FROM whatsapp_outbox").get() as {payload:string};
  expect(JSON.parse(row.payload)).toMatchObject({_deliveryClass:"QUEUE",_event:"QUEUE_COMPLETE"});
 });
});
