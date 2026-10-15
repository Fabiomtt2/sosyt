import { randomUUID } from "node:crypto";
import { afterEach,beforeEach,describe,expect,it } from "vitest";
import { buildApp } from "./app.js";
import { loadConfig,type Config } from "./config.js";
import { createDatabase,type AppDatabase } from "./db.js";
import { recordVerifiedXp,leaderboards } from "./gamification.js";
import { ensureBotPassword,saveBotPasswordSettings } from "./bot-password.js";
import { itemQuantity } from "./inventory.js";

describe("identidade ROOT configurada em conta participante",()=>{
 let db:AppDatabase,app:Awaited<ReturnType<typeof buildApp>>,config:Config;
 const rootPhone="5571999990001",newPhone="5571999990044",secret="root-configured-owner-secret-32-characters";
 const bearer=(token:string)=>({authorization:"Bearer "+token});
 beforeEach(async()=>{
  config=loadConfig({NODE_ENV:"test",DATABASE_PATH:":memory:",AUTH_DEV_MODE:"true",REQUIRE_GROUP_MEMBERSHIP:"false",OWNER_FABIO_NAME:"Fabio0",OWNER_FABIO_WHATSAPP:rootPhone,OWNER_FABIO_SECRET:secret});
  db=createDatabase(":memory:");app=await buildApp(config,db);
 });
 afterEach(async()=>{await app.close();db.close();});
 async function participant(){
  const login=await app.inject({method:"POST",url:"/admin/login",payload:{name:"Fabio",phone:rootPhone,secret,groupCode:"#"}});
  expect(login.statusCode).toBe(200);
  const ownerToken=login.json().token as string;
  const view=await app.inject({method:"POST",url:"/admin/participant-session",headers:bearer(ownerToken)});
  expect(view.statusCode).toBe(200);return {ownerToken,...view.json()};
 }
 function creditCoverage(userId:string) {
  const round=(db.prepare("SELECT id FROM rounds LIMIT 1").get() as {id:string}).id,stamp=new Date().toISOString();
  db.prepare("INSERT OR IGNORE INTO submissions(id,round_id,slot,user_id,youtube_url,video_id,created_at,video_duration_seconds) VALUES(?,?,1,?,'https://youtu.be/abcdefghijk','root-ranking-video',?,100)").run(randomUUID(),round,userId,stamp);
  db.prepare("INSERT INTO playlist_watch_progress(round_id,user_id,watched_seconds_json,durations_json,percent,observed_intervals_json,updated_at) VALUES(?,?,'[]','[]',100,?,?)").run(round,userId,'{"0":[[0,100]]}',stamp);
  recordVerifiedXp(db,userId,round,0);
 }
 it("ROOT persistido é excluído deTOP3 e não recebe senha comum, sem duplicarOwners",async()=>{
  const root=await participant();
  expect(db.prepare("SELECT id,role,active FROM owner_access WHERE user_id=?").get(root.user.id)).toEqual({id:"root:fabio",role:"ROOT_OWNER",active:1});
  creditCoverage(root.user.id);
  expect(leaderboards(db).monthly).toEqual([]);expect(leaderboards(db).permanent).toEqual([]);
  db.prepare("INSERT INTO integration_settings(key,value,updated_at) VALUES('whatsapp.mode','HYBRID_PLUS',?)").run(new Date().toISOString());
  saveBotPasswordSettings(db,{enabled:true,templateName:"sos_acesso_aprovado",templateLanguage:"pt_BR"},"root-test");
  const ready={...config,WHATSAPP_ACCESS_TOKEN:"synthetic-token",WHATSAPP_PHONE_NUMBER_ID:"123456",WHATSAPP_BUSINESS_ACCOUNT_ID:"123456",WHATSAPP_APP_SECRET:"synthetic-app-secret",WHATSAPP_VERIFY_TOKEN:"synthetic-verify-token"};
  expect(ensureBotPassword(db,ready,root.user.id,true).reason).toBe("ADMIN_ACCOUNT");
  expect(db.prepare("SELECT COUNT(*) AS n FROM user_passwords").get()).toEqual({n:0});
  const owners=await app.inject({method:"GET",url:"/admin/owners",headers:bearer(root.ownerToken)});
  expect(owners.json().owners).toHaveLength(2);
  expect((await app.inject({method:"POST",url:"/admin/owners",headers:bearer(root.ownerToken),payload:{userId:root.user.id}})).statusCode).toBe(409);
  expect(db.prepare("SELECT role FROM owner_access WHERE user_id=?").get(root.user.id)).toEqual({role:"ROOT_OWNER"});
 });
 it("telefone efetivo novo assume mesmo vínculo estável e revoga privilégios do número anterior",async()=>{
  const root=await participant(),newUser=randomUUID(),stamp=new Date().toISOString();
  db.prepare("INSERT INTO users(id,name,phone,group_code,created_at,updated_at) VALUES(?,'Fabio',?,'1',?,?)").run(newUser,newPhone,stamp,stamp);
  db.prepare("INSERT INTO wallets(user_id,updated_at) VALUES(?,?)").run(newUser,stamp);
  const changed=await app.inject({method:"POST",url:"/admin/owner-phone",headers:bearer(root.ownerToken),payload:{ownerId:"fabio",phone:newPhone}});
  expect(changed.statusCode).toBe(200);
  expect(db.prepare("SELECT id,user_id AS userId,phone,role,active FROM owner_access WHERE id='root:fabio'").get()).toEqual({id:"root:fabio",userId:newUser,phone:newPhone,role:"ROOT_OWNER",active:1});
  expect(itemQuantity(db,root.user.id,"SKIP")).toBe(0);expect(itemQuantity(db,newUser,"SKIP")).toBe(Number.MAX_SAFE_INTEGER);
  expect((await app.inject({method:"GET",url:"/dashboard",headers:bearer(root.token)})).statusCode).toBe(401);
  expect((await app.inject({method:"POST",url:"/admin/login",payload:{name:"Fabio",phone:newPhone,secret,groupCode:"#"}})).statusCode).toBe(200);
 });
 it("vínculoADMIN existente é promovido aROOT sem perda deid e não pode ser removido",async()=>{
  const id=randomUUID(),accessId=randomUUID(),stamp=new Date().toISOString();
  db.prepare("INSERT INTO users(id,name,phone,group_code,created_at,updated_at) VALUES(?,'Fabio',?,'1',?,?)").run(id,rootPhone,stamp,stamp);
  db.prepare("INSERT INTO wallets(user_id,updated_at) VALUES(?,?)").run(id,stamp);
  db.prepare("INSERT INTO owner_access(id,user_id,phone,normalized_name,role,active,created_at,updated_at) VALUES(?,?,?,'fabio','ADMIN_OWNER',1,?,?)").run(accessId,id,rootPhone,stamp,stamp);
  const root=await participant();
  expect(db.prepare("SELECT id,role,active FROM owner_access WHERE user_id=?").get(id)).toEqual({id:accessId,role:"ROOT_OWNER",active:1});
  expect((await app.inject({method:"DELETE",url:"/admin/owners/"+accessId,headers:bearer(root.ownerToken)})).statusCode).toBe(409);
  expect(db.prepare("SELECT role,active FROM owner_access WHERE user_id=?").get(id)).toEqual({role:"ROOT_OWNER",active:1});
 });

});
