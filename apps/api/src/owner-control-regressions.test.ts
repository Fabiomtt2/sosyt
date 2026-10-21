import {randomUUID} from "node:crypto";
import {beforeEach,afterEach,describe,it,expect} from "vitest";
import {buildApp} from "./app.js";
import {createDatabase,type AppDatabase} from "./db.js";
import {loadConfig} from "./config.js";
import {isParticipantBlocked} from "./participant-access.js";
describe("controle Owner integrado: delegação e suspensão sem grupo",()=>{
 let db:AppDatabase,app:Awaited<ReturnType<typeof buildApp>>,root:string;
 const phone="5571999990001",secret="synthetic-owner-controls-secret-32",headers=(token:string)=>({authorization:"Bearer "+token});
 beforeEach(async()=>{db=createDatabase(":memory:");app=await buildApp(loadConfig({NODE_ENV:"test",DATABASE_PATH:":memory:",AUTH_DEV_MODE:"true",WHATSAPP_MODE:"DISABLED",REQUIRE_GROUP_MEMBERSHIP:"false",JWT_SECRET:"synthetic-owner-controls-jwt-32",OWNER_FABIO_ID:"fabio",OWNER_FABIO_NAME:"Fabio0",OWNER_FABIO_WHATSAPP:phone,OWNER_FABIO_SECRET:secret}),db);const login=await app.inject({method:"POST",url:"/admin/login",payload:{name:"Fabio",identifier:phone,secret,groupCode:"#"}});expect(login.statusCode,login.body).toBe(200);root=login.json().token;});
 afterEach(async()=>{await app.close();db.close();});
 function fixture(name:string,number:string,member:boolean){const id=randomUUID(),at=new Date().toISOString();db.prepare("INSERT INTO users(id,name,phone,group_code,created_at,updated_at) VALUES(?,?,?,?,?,?)").run(id,name,number,member?"1":"",at,at);db.prepare("INSERT INTO wallets(user_id,updated_at) VALUES(?,?)").run(id,at);if(member)db.prepare("INSERT INTO group_memberships(phone,group_code,approved_at,source) VALUES(?,'1',?,'TEST')").run(number,at);const token=app.jwt.sign({sub:id,purpose:"session",aud:"conexao-session",authMethod:"password",authPhone:number});return{id,phone:number,token};}
 it("Root promove participante de nome comum a ADMIN sem torná-lo Root e sem expor correio",async()=>{
  fixture("Fabio",phone,true);
  const user=fixture("Carolina Teste","5571999990101",true);
  const listing=await app.inject({url:"/admin/owners",headers:headers(root)});expect(listing.json().candidates.some((u:{id:string})=>u.id===user.id)).toBe(true);
  const promoted=await app.inject({method:"POST",url:"/admin/owners",headers:headers(root),payload:{userId:user.id}});expect(promoted.statusCode,promoted.body).toBe(200);expect(promoted.json().role).toBe("ADMIN_OWNER");
  expect(db.prepare("SELECT name FROM users WHERE id=?").get(user.id)).toEqual({name:"Carolina Teste"});
  const elevated=await app.inject({method:"POST",url:"/admin/elevate",headers:headers(user.token)});expect(elevated.statusCode,elevated.body).toBe(200);const admin=elevated.json().token;
  expect((await app.inject({url:"/admin/mail",headers:headers(admin)})).statusCode).toBe(403);
  expect((await app.inject({method:"POST",url:"/admin/owners",headers:headers(admin),payload:{userId:user.id}})).statusCode).toBe(403);
  expect((await app.inject({method:"POST",url:"/admin/participants/"+phone+"/action",headers:headers(admin),payload:{action:"REVOKE"}})).statusCode).toBe(403);
  expect((await app.inject({method:"POST",url:"/admin/participants/"+user.phone+"/action",headers:headers(root),payload:{action:"REVOKE"}})).statusCode).toBe(200);
  expect((await app.inject({url:"/admin/overview",headers:headers(admin)})).statusCode).toBe(401);
 });
 it("suspender antes do grupo bloqueia sessão existente e não cria membership; restaurar mantém pendência",async()=>{
  const user=fixture("Pessoa Pendente","5571999990102",false);
  expect((await app.inject({url:"/dashboard",headers:headers(user.token)})).statusCode).toBe(200);
  const pause=await app.inject({method:"POST",url:"/admin/participants/"+user.phone+"/action",headers:headers(root),payload:{action:"REVOKE",reason:"Suspensão sintética solicitada"}});expect(pause.statusCode,pause.body).toBe(200);expect(isParticipantBlocked(db,user.id)).toBe(true);
  expect(db.prepare("SELECT 1 FROM group_memberships WHERE phone=?").get(user.phone)).toBeUndefined();
  const denied=await app.inject({url:"/dashboard",headers:headers(user.token)});expect(denied.statusCode,denied.body).toBe(403);expect(denied.json().code).toBe("ACCOUNT_ACCESS_REVOKED");
  expect((await app.inject({method:"POST",url:"/auth/password/set",headers:headers(user.token),payload:{newPassword:"SenhaSintetica123"}})).statusCode).toBe(403);
  const restore=await app.inject({method:"POST",url:"/admin/participants/"+user.phone+"/action",headers:headers(root),payload:{action:"RESTORE"}});expect(restore.statusCode,restore.body).toBe(200);expect(isParticipantBlocked(db,user.id)).toBe(false);
  expect(db.prepare("SELECT 1 FROM group_memberships WHERE phone=?").get(user.phone)).toBeUndefined();expect((await app.inject({url:"/dashboard",headers:headers(user.token)})).statusCode).toBe(200);
  expect(db.prepare("SELECT action FROM participant_access_audit WHERE user_id=? ORDER BY rowid").all(user.id)).toEqual([{action:"REVOKE"},{action:"RESTORE"}]);
  expect(()=>db.prepare("DELETE FROM participant_access_audit WHERE user_id=?").run(user.id)).toThrow(/Immutable/);
 });
 it("remoção pelo endpoint legado também persiste suspensão sem membership",async()=>{
  const user=fixture("Pessoa Sem Grupo","5571999990103",false);
  const removed=await app.inject({method:"DELETE",url:"/admin/members/"+user.phone,headers:headers(root)});expect(removed.statusCode,removed.body).toBe(200);expect(isParticipantBlocked(db,user.id)).toBe(true);
  expect((await app.inject({url:"/dashboard",headers:headers(user.token)})).statusCode).toBe(403);
 });
 it("participante sem membership não é elegível para promoção",async()=>{const user=fixture("Sem Vínculo","5571999990104",false);const result=await app.inject({method:"POST",url:"/admin/owners",headers:headers(root),payload:{userId:user.id}});expect(result.statusCode,result.body).toBe(409);});
 it.each([['COINS',10],['PASS',2],['SKIP',3],['SUPER',30]] as const)("Root concede %s uma vez, com autoria e sem receita",async(benefit,quantity)=>{
  const user=fixture("Presente Sintético","5571999990191",true),referenceId=randomUUID();
  const payload={benefit,quantity,referenceId,reason:"Presente sintético de participação"},url="/admin/participants/"+user.phone+"/benefits";
  for(let n=0;n<2;n++){const res=await app.inject({method:"POST",url,headers:headers(root),payload});expect(res.statusCode,res.body).toBe(200);expect(res.json().replayed).toBe(n===1);}
  const wallet=db.prepare("SELECT purchased_millis,reward_millis,extra_slot_passes FROM wallets WHERE user_id=?").get(user.id);
  expect(wallet).toMatchObject({purchased_millis:0,reward_millis:benefit==='COINS'?10000:0,extra_slot_passes:benefit==='PASS'?2:0});
  if(benefit==='SKIP')expect(db.prepare("SELECT quantity FROM user_items WHERE user_id=? AND item_code='SKIP'").get(user.id)).toEqual({quantity:3});
  if(benefit==='SUPER'){expect(db.prepare("SELECT source FROM super_subscriptions WHERE user_id=?").get(user.id)).toEqual({source:'GIFT'});expect(db.prepare("SELECT COUNT(*) AS n FROM super_events WHERE user_id=?").get(user.id)).toEqual({n:1});}
  expect(db.prepare("SELECT COUNT(*) AS n FROM payments").get()).toEqual({n:0});
  expect(db.prepare("SELECT COUNT(*) AS n FROM wallet_ledger WHERE kind='OWNER_BENEFIT' AND reference_id=? AND actor_owner_id='fabio'").get(referenceId)).toEqual({n:1});
  expect(db.prepare("SELECT COUNT(*) AS n FROM community_notifications WHERE user_id=? AND reference_id=?").get(user.id,referenceId)).toEqual({n:1});
  expect((await app.inject({method:'POST',url,headers:headers(root),payload:{...payload,quantity:quantity+1}})).statusCode).toBe(409);
  expect((await app.inject({method:'POST',url,headers:headers(user.token),payload:{...payload,referenceId:randomUUID()}})).statusCode).toBe(401);
 });

});
