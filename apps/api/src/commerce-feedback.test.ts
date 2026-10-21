import {saveWhatsAppIntegration,savePaymentIntegration} from "./integrations.js";
import { requestDirectConversation,respondDirectConversation } from "./social.js";
import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {randomUUID} from "node:crypto";
import {mkdtempSync,rmSync} from "node:fs";
import {resolve} from "node:path";
import {tmpdir} from "node:os";
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
  const consent=requestDirectConversation(db,a.id,b.id);respondDirectConversation(db,b.id,requestId(consent),true);
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
  currentRoundFor(db,user.id); // Adesão FREE explícita antes de consumir Pular.
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
 it("não cria cobrança nem anuncia Pix quando falta a assinatura do webhook",async()=>{
  const user=await member();
  // Token stored without webhook is incomplete, even though the provider was selected.
  savePaymentIntegration(db,loadConfig({NODE_ENV:"test",DATABASE_PATH:":memory:",JWT_SECRET:"commerce-jwt-32-characters-for-test"}),{provider:"MERCADO_PAGO",environment:"PRODUCTION",mercadoPagoAccessToken:"synthetic-valid-access-token-for-test"});
  const fetch=vi.spyOn(globalThis,'fetch');
  const dashboard=await app.inject({url:'/dashboard',headers:headers(user.token)});expect(dashboard.json().commerce.pixAvailable).toBe(false);
  const result=await app.inject({method:'POST',url:'/payments/pix',headers:headers(user.token),payload:{product:'SKIP_1',email:'synthetic@example.test',cpf:'52998224725'}});
  expect(result.statusCode,result.body).toBe(409);expect(db.prepare('SELECT COUNT(*) AS n FROM payments').get()).toEqual({n:0});expect(fetch).not.toHaveBeenCalled();
 });
 it("compra e presente de Pular avisam pelo mesmo bot uma única vez",async()=>{
  const config=loadConfig({NODE_ENV:"test",DATABASE_PATH:":memory:",JWT_SECRET:"commerce-jwt-32-characters-for-test"});
  saveWhatsAppIntegration(db,config,{mode:'EVOLUTION',evolutionUrl:'https://example.test',evolutionInstance:'synthetic',evolutionApiKey:'synthetic-key',evolutionPhone:'5571999990988',evolutionWebhookSecret:'synthetic-webhook-secret-32'});
  const a=await member(),b=await member('5571999990302','Bia');
  const created=await app.inject({method:'POST',url:'/payments/pix',headers:headers(a.token),payload:{product:'SKIP_1',email:'synthetic@example.test',cpf:'52998224725'}});expect(created.statusCode,created.body).toBe(201);
  const id=created.json().id;for(let n=0;n<2;n++)expect((await app.inject({method:'POST',url:'/payments/'+id+'/demo-approve',headers:headers(a.token)})).statusCode).toBe(200);
  const referenceId=randomUUID();for(let n=0;n<2;n++){const result=await app.inject({method:'POST',url:'/inventory/gift',headers:headers(a.token),payload:{toUserId:b.id,itemCode:'SKIP',quantity:1,referenceId}});expect(result.statusCode,result.body).toBe(200);}
  expect(db.prepare("SELECT COUNT(*) AS n FROM whatsapp_outbox WHERE dedupe_key LIKE '%purchase-confirmed:%'").get()).toEqual({n:1});
  expect(db.prepare("SELECT COUNT(*) AS n FROM whatsapp_outbox WHERE dedupe_key LIKE '%item-gift:%'").get()).toEqual({n:1});
  expect(db.prepare('SELECT COUNT(*) AS n FROM payments').get()).toEqual({n:1});
 });

});

it("atualização de banco antigo adiciona Pular/SUPER preservando produtos configurados",()=>{
 const dir=mkdtempSync(resolve(tmpdir(),"sos-catalog-migration-")),file=resolve(dir,"db.sqlite");
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

function requestId(request:{id?:string}):string {
  expect(typeof request.id).toBe("string");
  if(typeof request.id!=="string")throw new Error("Fixture expected a persisted conversation request");
  return request.id;
}
