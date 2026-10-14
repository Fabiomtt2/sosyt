import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {randomUUID} from "node:crypto";
import {mkdtempSync,rmSync} from "node:fs";
import {resolve} from "node:path";
import {buildApp} from "./app.js";
import {loadConfig} from "./config.js";
import {createDatabase,type AppDatabase} from "./db.js";
import {grantSuper,activePins,createPin} from "./super.js";
import {grantItem,ITEM_SKIP} from "./inventory.js";
import {currentRoundFor} from "./queues.js";

describe("compras confirmadas e identidade SUPER",()=>{
 let db:AppDatabase,app:Awaited<ReturnType<typeof buildApp>>;
 const headers=(token:string)=>({authorization:"Bearer "+token});
 beforeEach(async()=>{
  db=createDatabase(":memory:");
  app=await buildApp(loadConfig({NODE_ENV:"test",DATABASE_PATH:":memory:",AUTH_DEV_MODE:"true",
   PAYMENTS_DEV_MODE:"true",REQUIRE_GROUP_MEMBERSHIP:"false",JWT_SECRET:"commerce-jwt-32-characters-for-test",
   AUTH_CODE_PEPPER:"commerce-pepper-32-characters-test",ASAAS_API_KEY:"asaas-test-key",ASAAS_WEBHOOK_TOKEN:"asaas-test-webhook"}),db);
 });
 afterEach(async()=>{vi.restoreAllMocks();await app.close();db.close();});
 async function member(phone="5571999990301",name="Lia"){
  db.prepare("INSERT OR IGNORE INTO groups(code,enabled,membership_mode) VALUES ('12',1,'OWNER')").run();
  db.prepare("INSERT INTO group_memberships(phone,group_code,approved_at,source) VALUES (?,'12',?,'TEST')").run(phone,new Date().toISOString());
  const code=(await app.inject({method:"POST",url:"/auth/request-code",payload:{phone,name}})).json().devCode;
  const res=await app.inject({method:"POST",url:"/auth/verify",payload:{phone,code}});
  expect(res.statusCode).toBe(200);return {id:res.json().user.id as string,token:res.json().token as string};
 }
 it.each([
  ["COINS_10",{credits:10,extraPasses:0,items:[],subscriptionDays:0}],
  ["PASS_SINGLE",{credits:0,extraPasses:1,items:[],subscriptionDays:0}],
  ["SKIP_1",{credits:0,extraPasses:0,items:[{itemCode:"SKIP",quantity:1}],subscriptionDays:0}],
  ["SUPER_30",{credits:0,extraPasses:0,items:[],subscriptionDays:30}]
 ])("recibo de %s usa entrega real, mantém snapshot e não duplica",async(product,benefits)=>{
  const user=await member(),other=await member("5571999990302","Bia"),auth=headers(user.token);
  const created=await app.inject({method:"POST",url:"/payments/pix",headers:auth,payload:{product,email:"lia@example.test",cpf:"52998224725"}});
  expect(created.statusCode).toBe(201);const id=created.json().id;
  const pending=await app.inject({method:"GET",url:"/payments/"+id,headers:auth});
  expect(pending.json().status).toBe("PENDING");expect(pending.json().receipt).toBeUndefined();
  db.prepare("UPDATE store_products SET credits_millis=99000,extra_passes=9,grants_item_qty=9,subscription_days=99 WHERE code=?").run(product);
  for(let n=0;n<2;n++)expect((await app.inject({method:"POST",url:"/payments/"+id+"/demo-approve",headers:auth})).statusCode).toBe(200);
  const result=await app.inject({method:"GET",url:"/payments/"+id,headers:auth});
  expect(result.json()).toMatchObject({status:"APPROVED",receipt:{...benefits,paymentId:id,userId:user.id}});
  expect(result.json().receipt.approvedAt).toBeTruthy();
  expect((db.prepare("SELECT COUNT(*) AS n FROM wallet_ledger WHERE reference_id=? AND kind='PIX_PURCHASE'").get(id) as {n:number}).n).toBe(1);
  expect((await app.inject({method:"GET",url:"/payments/"+id,headers:headers(other.token)})).statusCode).toBe(404);
 });
 it("avatar permanece e moldura expira em perfil, fila, chat e direct",async()=>{
  const a=await member(),b=await member("5571999990302","Bia"),auth=headers(a.token);
  await app.inject({method:"PUT",url:"/profile/avatar",headers:auth,payload:{kind:"PRESET",presetId:"avatar-17"}});
  grantSuper(db,a.id,{days:1,source:"TEST"});
  await app.inject({method:"GET",url:"/dashboard",headers:auth});
  const round=currentRoundFor(db,a.id)!;
  db.prepare("INSERT INTO submissions(id,round_id,slot,user_id,youtube_url,video_id,created_at) VALUES (?,?,1,?,?,?,?)").run(randomUUID(),round.id,a.id,"https://youtu.be/dQw4w9WgXcQ","dQw4w9WgXcQ",new Date().toISOString());
  await app.inject({method:"POST",url:"/chat/global",headers:auth,payload:{body:"Olá, comunidade!"}});
  await app.inject({method:"POST",url:"/mail/dm",headers:auth,payload:{toUserId:b.id,body:"Olá, Bia!"}});
  createPin(db,a.id,"Conheça os vídeos do meu canal.");
  for(const active of [true,false]){
   if(!active)db.prepare("UPDATE super_subscriptions SET expires_at=? WHERE user_id=?").run(new Date(Date.now()-1000).toISOString(),a.id);
   const dashboard=(await app.inject({method:"GET",url:"/dashboard",headers:auth})).json();
   const chat=(await app.inject({method:"GET",url:"/chat/global",headers:auth})).json();
   const direct=(await app.inject({method:"GET",url:"/mail/thread/"+a.id,headers:headers(b.token)})).json();
   for(const who of [dashboard.user,dashboard.openRound.slots[0],chat.messages[0].sender,direct.messages[0].sender]){
    expect(who.avatar).toMatchObject({kind:"PRESET",presetId:"avatar-17"});
    expect(who.presentation).toMatchObject({badge:active?"SUPER":null,superActive:active});
   }
   expect(activePins(db)).toHaveLength(active?1:0);
  }
 });
 it("repetir uma intenção Pular consome somente uma unidade",async()=>{
  const user=await member(),auth=headers(user.token);
  await app.inject({method:"GET",url:"/dashboard",headers:auth});
  grantItem(db,{userId:user.id,itemCode:ITEM_SKIP,delta:2,kind:"OWNER_ADJUST"});
  const payload={referenceId:randomUUID()};
  const first=(await app.inject({method:"POST",url:"/queues/skip",headers:auth,payload})).json();
  const second=(await app.inject({method:"POST",url:"/queues/skip",headers:auth,payload})).json();
  expect(second.queue.id).toBe(first.queue.id);expect(second.skipsAvailable).toBe(1);
  expect((await app.inject({method:"GET",url:"/queues/mine",headers:auth})).json().queues).toHaveLength(2);
 });
 it("webhook Asaas com consulta falha pode ser reenviado e concilia uma vez",async()=>{
  const user=await member(),id=randomUUID(),providerId="pay_retry";
  db.prepare("INSERT INTO payments(id,user_id,provider,provider_payment_id,status,amount_cents,credits_millis,extra_passes,product_code,created_at) VALUES (?,?,'ASAAS',?,'PENDING',2000,10000,0,'COINS_10',?)").run(id,user.id,providerId,new Date().toISOString());
  const fetch=vi.spyOn(globalThis,"fetch").mockRejectedValueOnce(new Error("temporarily offline"))
   .mockResolvedValueOnce(new Response(JSON.stringify({id:providerId,externalReference:id,value:20,billingType:"PIX",status:"RECEIVED"}),{status:200,headers:{"content-type":"application/json"}}));
  const request={method:"POST" as const,url:"/payments/webhooks/asaas",headers:{"asaas-access-token":"asaas-test-webhook"},payload:{id:"evt_retry",event:"PAYMENT_RECEIVED",payment:{id:providerId}}};
  expect((await app.inject(request)).statusCode).toBe(500);
  expect(db.prepare("SELECT 1 FROM payment_webhook_events WHERE event_id='evt_retry'").get()).toBeUndefined();
  expect((await app.inject(request)).statusCode).toBe(200);
  expect((await app.inject(request)).json().duplicate).toBe(true);
  expect(fetch).toHaveBeenCalledTimes(2);
  expect((await app.inject({method:"GET",url:"/payments/"+id,headers:headers(user.token)})).json().receipt.credits).toBe(10);
 });
});

it("atualização de banco antigo adiciona Pular/SUPER preservando produtos configurados",()=>{
 const dir=mkdtempSync(resolve("../../.local-tmp/catalog-migration-")),file=resolve(dir,"db.sqlite");
 try{
  let db=createDatabase(file);
  db.prepare("DELETE FROM store_products WHERE code IN ('SKIP_1','SUPER_30')").run();
  db.prepare("UPDATE store_products SET title='Oferta do Owner',amount_cents=3500,active=0 WHERE code='COINS_10'").run();
  db.prepare("UPDATE store_products SET active=0 WHERE code='PASS_SINGLE'").run();
  db.close();
  for(let i=0;i<2;i++){
   db=createDatabase(file);
   expect(db.prepare("SELECT title,amount_cents,active FROM store_products WHERE code='COINS_10'").get()).toEqual({title:"Oferta do Owner",amount_cents:3500,active:0});
   expect(db.prepare("SELECT active FROM store_products WHERE code='PASS_SINGLE'").get()).toEqual({active:0});
   expect(db.prepare("SELECT grants_item,active FROM store_products WHERE code='SKIP_1'").get()).toEqual({grants_item:"SKIP",active:1});
   expect((db.prepare("SELECT COUNT(*) AS n FROM store_products").get() as {n:number}).n).toBe(5);db.close();
  }
 }finally{rmSync(dir,{recursive:true,force:true});}
});
