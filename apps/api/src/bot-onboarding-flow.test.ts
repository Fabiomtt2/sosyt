import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {buildApp} from "./app.js";
import {createDatabase,type AppDatabase} from "./db.js";
import {loadConfig,type Config} from "./config.js";
import {decryptToken} from "./youtube.js";
import {createEvolutionClient} from "./bot-evolution.js";
import {processGroupJoin} from "./bot-group-join.js";
import {ensureSelfServiceAccount,syncEvolutionWhatsAppGroups} from "./whatsapp.js";
import {verifyPassword} from "./password.js";

describe("bot → senha → login → grupo, sem cadastro manual",()=>{
 let db:AppDatabase,config:Config,app:Awaited<ReturnType<typeof buildApp>>;
 const phone="5511999990771",botPhone="5511999990770",secret="synthetic-onboarding-webhook-secret-32";
 let sequence=0;
 beforeEach(async()=>{
  config=loadConfig({NODE_ENV:"test",DATABASE_PATH:":memory:",WHATSAPP_MODE:"EVOLUTION",AUTH_DEV_MODE:"false",
   REQUIRE_GROUP_MEMBERSHIP:"true",ALLOWED_GROUP_CODES:"1,2",EVOLUTION_URL:"https://evolution.example.test",
   EVOLUTION_INSTANCE:"sos-primary",EVOLUTION_PHONE:botPhone,EVOLUTION_API_KEY:"synthetic-evolution-key",
   EVOLUTION_WEBHOOK_SECRET:secret,JWT_SECRET:"synthetic-onboarding-jwt-secret-32"});
  db=createDatabase(":memory:");app=await buildApp(config,db);sequence=0;
 });
 afterEach(async()=>{await app.close();db.close();vi.unstubAllGlobals();vi.restoreAllMocks();});
 async function inbound(text:string,timestamp:unknown=Date.now()){
  const response=await app.inject({method:"POST",url:"/webhooks/whatsapp/evolution",headers:{"x-sos-webhook-secret":secret},
   payload:{event:"MESSAGES_UPSERT",instance:"sos-primary",data:{
    key:{id:"synthetic-onboarding-"+(++sequence),remoteJid:"100000000000001@lid",remoteJidAlt:phone+"@s.whatsapp.net",fromMe:false},
    ...(timestamp===undefined?{}:{messageTimestamp:timestamp}),message:{conversation:text}}}});
  expect(response.statusCode,response.body).toBe(200);return response;
 }
 function payloadBody(payload:string){
  const envelope=JSON.parse(payload);
  const data=envelope.encryptedNotification?JSON.parse(decryptToken(envelope.encryptedNotification,config)):envelope;
  return String(data.text?.body??"");
 }
 function issuedPassword(userId:string){
  const row=db.prepare("SELECT payload FROM whatsapp_outbox WHERE dedupe_key=?").get("bot-password:"+userId) as {payload:string};
  expect(row.payload).not.toContain('"body"');
  const body=payloadBody(row.payload),password=/é: ([A-Za-z0-9]{14})\./u.exec(body)?.[1];
  expect(password).toBeTruthy();return password!;
 }
 async function signup(){
  await inbound("1");await inbound("Pessoa Sintetica");
  const user=db.prepare("SELECT id,phone FROM users WHERE phone=? AND deleted_at IS NULL").get(phone) as {id:string;phone:string};
  expect(user).toBeTruthy();return {...user,password:issuedPassword(user.id)};
 }
 it("LID vira telefone; senha abre login e adesão; sync libera dashboard sem Owner",async()=>{
  const user=await signup();
  expect(user.phone).toBe(phone);
  expect(db.prepare("SELECT 1 FROM users WHERE phone LIKE '%@lid'").get()).toBeUndefined();
  expect(db.prepare("SELECT 1 FROM group_memberships WHERE phone=?").get(phone)).toBeUndefined();
  const wrong=await app.inject({method:"POST",url:"/auth/password/login",payload:{phone,password:"SenhaErrada123"}});
  expect(wrong.statusCode).toBe(401);
  expect(db.prepare("SELECT 1 FROM group_join_requests WHERE phone=?").get(phone)).toBeUndefined();
  const login=await app.inject({method:"POST",url:"/auth/password/login",payload:{phone,password:user.password}});
  expect(login.statusCode,login.body).toBe(200);
  expect(db.prepare("SELECT phone,status FROM group_join_requests WHERE phone=?").get(phone)).toEqual({phone,status:"PENDING"});
  db.prepare("UPDATE groups SET enabled=1,whatsapp_group_id='120000000001@g.us',membership_mode='EVOLUTION' WHERE code='1'").run();
  const fetch=vi.fn(async(url:string)=>new Response(JSON.stringify(
   url.includes("fetchAllGroups")?[{id:"120000000001@g.us",subject:"SOS YOUTUBER 1",size:1,participants:[{id:"100000000000001@lid",phoneNumber:phone+"@s.whatsapp.net"}]}]:
   url.includes("connectionState")?{instance:{state:"open"}}:
   url.includes("fetchInstances")?[{name:"sos-primary",ownerJid:botPhone+"@s.whatsapp.net"}]:
   {participants:[{jid:phone+"@s.whatsapp.net",status:"200"}]}
  ),{status:200}));
  vi.stubGlobal("fetch",fetch);
  const client=createEvolutionClient({config:{url:config.EVOLUTION_URL!,instance:"sos-primary",apiKey:config.EVOLUTION_API_KEY!,number:botPhone}});
  expect(await processGroupJoin(db,config,client)).toMatchObject({phone,added:true,groupCode:"1"});
  await syncEvolutionWhatsAppGroups(db,config);
  expect(db.prepare("SELECT group_code AS groupCode,revoked_at AS revoked FROM group_memberships WHERE phone=?").get(phone)).toMatchObject({groupCode:"1",revoked:null});
  const dashboard=await app.inject({url:"/dashboard",headers:{authorization:"Bearer "+login.json().token}});
  expect(dashboard.statusCode,dashboard.body).toBe(200);
  expect(dashboard.json().user.phone).toBe(phone);
 });
 it.each([undefined,Math.floor(Date.now()/1000),Date.now(),"invalido",Date.now()+86400000])("timestamp %s não torna a conversa muda",async timestamp=>{
  // Pass undefined explicitly instead of using the helper's default argument.
  if(timestamp===undefined){
   const r=await app.inject({method:"POST",url:"/webhooks/whatsapp/evolution",headers:{"x-sos-webhook-secret":secret},payload:{
    event:"MESSAGES_UPSERT",instance:"sos-primary",data:{key:{id:"no-clock",remoteJid:"100000000000001@lid",remoteJidAlt:phone+"@s.whatsapp.net"},message:{conversation:"oi"}}}});
   expect(r.statusCode,r.body).toBe(200);
  }else await inbound("oi",timestamp);
  const rows=db.prepare("SELECT payload,expires_at AS expires FROM whatsapp_outbox WHERE recipient=?").all(phone) as {payload:string;expires:string}[];
  expect(rows.length).toBeGreaterThan(0);
  expect(rows.some(row=>payloadBody(row.payload).includes("1"))).toBe(true);
  expect(rows.every(row=>Date.parse(row.expires)>Date.now())).toBe(true);
 });
 it("WAITING_NAME não engole filas/menu, e trocar senha cria uma nova uma única vez",async()=>{
  await inbound("1");await inbound("2");await inbound("oi");await inbound("Pessoa Sintetica");
  const user=db.prepare("SELECT id FROM users WHERE phone=?").get(phone) as {id:string};
  const old=issuedPassword(user.id);
  const bodies=(db.prepare("SELECT payload FROM whatsapp_outbox WHERE recipient=?").all(phone) as {payload:string}[]).map(row=>payloadBody(row.payload));
  expect(bodies.some(body=>/fila/i.test(body))).toBe(true);
  await inbound("TROCAR SENHA");
  const fresh=issuedPassword(user.id);expect(fresh).not.toBe(old);
  const hash=(db.prepare("SELECT password_hash AS hash FROM user_passwords WHERE user_id=?").get(user.id) as {hash:string}).hash;
  expect(verifyPassword(old,hash)).toBe(false);expect(verifyPassword(fresh,hash)).toBe(true);
  expect(db.prepare("SELECT COUNT(*) AS n FROM user_passwords WHERE user_id=?").get(user.id)).toEqual({n:1});
  expect(db.prepare("SELECT COUNT(*) AS n FROM whatsapp_outbox WHERE dedupe_key=?").get("bot-password:"+user.id)).toEqual({n:1});
 });
 it("recriar o mesmo telefone não recria as moedas promocionais",()=>{
  const first=ensureSelfServiceAccount(db,config,phone,"Pessoa Sintetica");
  const stamp=new Date().toISOString();
  db.prepare("UPDATE users SET phone=?,deleted_at=? WHERE id=?").run("deleted:"+first.userId,stamp,first.userId);
  const second=ensureSelfServiceAccount(db,config,phone,"Pessoa Sintetica");
  expect((db.prepare("SELECT promo_millis AS promo FROM wallets WHERE user_id=?").get(second.userId))).toEqual({promo:0});
  expect(db.prepare("SELECT COALESCE(SUM(amount_millis),0) AS total FROM wallet_ledger WHERE kind='WELCOME'").get()).toEqual({total:10000});
 });
});
