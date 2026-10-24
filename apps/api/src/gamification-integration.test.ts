import { requestDirectConversation,respondDirectConversation } from "./social.js";
import { afterEach,beforeEach,describe,expect,it,vi } from "vitest";
import { randomUUID } from "node:crypto";
import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createDatabase,type AppDatabase } from "./db.js";
import { recordVerifiedXp,saveGamificationConfig,gamificationConfig,claimBooster } from "./gamification.js";
import { superState,revokeSuper } from "./super.js";
describe("gamificação integrada: guards, carteira, identidade e expiração",()=>{
 let db:AppDatabase,app:Awaited<ReturnType<typeof buildApp>>;
 beforeEach(async()=>{db=createDatabase(":memory:");app=await buildApp(loadConfig({NODE_ENV:"test",DATABASE_PATH:":memory:",AUTH_DEV_MODE:"true",REQUIRE_GROUP_MEMBERSHIP:"false",OWNER_FABIO_NAME:"Fabio0",OWNER_FABIO_ID:"fabio0",OWNER_FABIO_WHATSAPP:"5571999990001",OWNER_FABIO_SECRET:"gamification-owner-test-32-characters"}),db);});
 afterEach(async()=>{await app.close();db.close();vi.useRealTimers();});
 async function user(phone:string,name:string){
  const now=new Date().toISOString();
  db.prepare("INSERT OR IGNORE INTO groups(code,enabled,membership_mode) VALUES('1',1,'OWNER')").run();
  db.prepare("INSERT INTO group_memberships(phone,group_code,approved_at,source) VALUES(?,'1',?,'TEST')").run(phone,now);
  const issued=await app.inject({method:"POST",url:"/auth/request-code",payload:{phone,name}});
  const result=await app.inject({method:"POST",url:"/auth/verify",payload:{phone,code:issued.json().devCode}});
  expect(result.statusCode).toBe(200);return result.json();
 }
 const h=(token:string)=>({authorization:"Bearer "+token});
 it("participante não configura jornada nem concede XP; trocas e presentes preservam moedas compradas",async()=>{
  const a=await user("5571999990621","Ana"),b=await user("5571999990622","Bruno"),headers=h(a.token);
  expect((await app.inject({method:"GET",url:"/admin/gamification",headers})).statusCode).toBe(401);
  expect((await app.inject({method:"POST",url:"/admin/gamification",headers,payload:gamificationConfig(db)})).statusCode).toBe(401);
  expect((await app.inject({method:"POST",url:"/gamification/xp",headers,payload:{xp:999999}})).statusCode).toBe(404);
  db.prepare("UPDATE wallets SET reward_millis=205000,purchased_millis=30000 WHERE user_id=?").run(a.user.id);
  const ref=randomUUID(),request={method:"POST" as const,url:"/gamification/redeem",headers,payload:{itemCode:"PASS",referenceId:ref}};
  expect((await app.inject(request)).statusCode).toBe(200);expect((await app.inject(request)).statusCode).toBe(200);
  expect(db.prepare("SELECT reward_millis AS reward,purchased_millis AS paid,extra_slot_passes AS passes FROM wallets WHERE user_id=?").get(a.user.id)).toMatchObject({reward:105000,paid:30000,passes:1});
  const gift={method:"POST" as const,url:"/gamification/gift-coins",headers,payload:{toUserId:b.user.id,coins:5,referenceId:randomUUID()}};
  expect((await app.inject(gift)).statusCode).toBe(200);expect((await app.inject(gift)).statusCode).toBe(200);
  expect(db.prepare("SELECT reward_millis AS reward FROM wallets WHERE user_id=?").get(b.user.id)).toEqual({reward:5000});
  expect((await app.inject({method:"GET",url:"/dashboard",headers})).json().wallet).toMatchObject({reward:100,purchased:30});
 });
 it("XP aparece no dashboard/chat/DM e rankings sem telefone ou segredo público",async()=>{
  const a=await user("5571999990623","Ana"),b=await user("5571999990624","Bruno");
  const round=(db.prepare("SELECT id FROM rounds LIMIT 1").get() as {id:string}).id,now=new Date().toISOString();
  db.prepare("INSERT INTO submissions(id,round_id,slot,user_id,youtube_url,video_id,created_at,video_duration_seconds) VALUES(?,?,1,?,?,?,?,100)").run(randomUUID(),round,a.user.id,"https://youtu.be/abcdefghijk","abcdefghijk",now);
  db.prepare("INSERT INTO playlist_watch_progress(round_id,user_id,watched_seconds_json,durations_json,percent,observed_intervals_json,updated_at) VALUES(?,?,?, ?,100,?,?)").run(round,a.user.id,"[]","[]",'{"0":[[0,100]]}',now);
  recordVerifiedXp(db,a.user.id,round,0);
  expect((await app.inject({method:"GET",url:"/dashboard",headers:h(a.token)})).json().user.presentation.progress.level).toBe(2);
  expect((await app.inject({method:"POST",url:"/chat/global",headers:h(a.token),payload:{body:"Meu primeiro nível!"}})).statusCode).toBe(200);
  expect((await app.inject({method:"GET",url:"/chat/global",headers:h(b.token)})).json().messages[0].sender.presentation.progress).toMatchObject({level:2,xp:101})   // 100 do video + 1 da mensagem no chat;
  const consent=requestDirectConversation(db,a.user.id,b.user.id);respondDirectConversation(db,b.user.id,requestId(consent),true);
  await app.inject({method:"POST",url:"/mail/dm",headers:h(a.token),payload:{toUserId:b.user.id,body:"Vamos criar juntos."}});
  expect((await app.inject({method:"GET",url:"/mail/thread/"+a.user.id,headers:h(b.token)})).json().messages[0].sender.presentation.progress.level).toBe(2);
  const ranks=await app.inject({method:"GET",url:"/gamification/rankings",headers:h(b.token)});
  expect(ranks.json().monthly[0]).toMatchObject({name:"Ana",xp:101,position:1});expect(ranks.body).not.toContain("5571999990623");
 });
 it("trial real dá SUPER por sete dias e Root pode revogar também a trial",async()=>{
  const a=await user("5571999990625","Ana");
  vi.useFakeTimers();vi.setSystemTime(new Date("2026-10-16T12:00:00Z"));
  const cfg=gamificationConfig(db);saveGamificationConfig(db,{...cfg,boosterDrops:cfg.boosterDrops.map(d=>({...d,weight:d.code==="SUPER_TRIAL"?10000:0}))},"root");
  claimBooster(db,a.user.id);expect(superState(db,a.user.id).active).toBe(true);
  vi.advanceTimersByTime(7*86400000);expect(superState(db,a.user.id).active).toBe(false);
  vi.setSystemTime(new Date("2026-10-23T12:00:00Z"));claimBooster(db,a.user.id);expect(superState(db,a.user.id).active).toBe(true);
  revokeSuper(db,a.user.id,"root");expect(superState(db,a.user.id).active).toBe(false);
 });
});

function requestId(request:{id?:string}):string {
  expect(typeof request.id).toBe("string");
  if(typeof request.id!=="string")throw new Error("Fixture expected a persisted conversation request");
  return request.id;
}
