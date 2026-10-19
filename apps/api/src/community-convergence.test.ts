import {beforeEach,afterEach,it,expect,describe} from "vitest";
import {randomUUID} from "node:crypto";
import {grantItem,ITEM_SKIP} from "./inventory.js";
import {currentRoundFor,joinRound} from "./queues.js";
import {readFileSync} from "node:fs";
import {buildApp} from "./app.js";
import {loadConfig,type Config} from "./config.js";
import {createDatabase,type AppDatabase} from "./db.js";
import {upsertCatalogAvatar} from "./avatar-tiers.js";
import {grantSuper} from "./super.js";
import {effectiveWhatsAppConfig,readWhatsAppIntegration} from "./integrations.js";
describe("convergência de identidade, comunidade e transportes",()=>{
 let db:AppDatabase,app:Awaited<ReturnType<typeof buildApp>>,config:Config;
 const ownerData={name:"Fabio0",identifier:"5571999990001",groupCode:"#",secret:"community-owner-secret-32-characters"};
 const auth=(token:string)=>({authorization:"Bearer "+token});
 beforeEach(async()=>{
  config=loadConfig({NODE_ENV:"test",DATABASE_PATH:":memory:",AUTH_DEV_MODE:"true",REQUIRE_GROUP_MEMBERSHIP:"false",JWT_SECRET:"community-jwt-secret-32-characters",AUTH_CODE_PEPPER:"community-pepper-32-characters!!!",OWNER_FABIO_NAME:"Fabio0",OWNER_FABIO_ID:"fabio0",OWNER_FABIO_SECRET:ownerData.secret,OWNER_FABIO_WHATSAPP:"5571999990001"});
  db=createDatabase(":memory:");app=await buildApp(config,db);
 });
 afterEach(async()=>{await app.close();db.close();});
 const owner=async()=>{const result=await app.inject({method:"POST",url:"/admin/login",payload:ownerData});expect(result.statusCode).toBe(200);return result.json().token as string;};
 async function member(phone:string,name:string){
  db.prepare("INSERT OR IGNORE INTO groups(code,enabled,membership_mode) VALUES ('12',1,'OWNER')").run();
  db.prepare("INSERT INTO group_memberships(phone,group_code,approved_at,source) VALUES (?,'12',?,'TEST')").run(phone,new Date().toISOString());
  const code=await app.inject({method:"POST",url:"/auth/request-code",payload:{phone,name}});
  const result=await app.inject({method:"POST",url:"/auth/verify",payload:{phone,code:code.json().devCode}});
  expect(result.statusCode).toBe(200);return {id:result.json().user.id as string,token:result.json().token as string};
 }
 const cat=(tier:"COMMON"|"SUPER"|"OWNER")=>upsertCatalogAvatar(db,{tier,category:"OBJECTS",label:"Ilustração de teste",imageWebp:readFileSync(new URL("../../client/public/assets/user/avatars.webp",import.meta.url))});
 it("Owner seleciona catálogo; participante e chat usam o mesmo avatar e papel ROOT",async()=>{
  const token=await owner(),slug=cat("OWNER");
  const image=await app.inject({method:"GET",url:"/avatars/"+slug});
  expect(image.statusCode).toBe(200);expect(image.headers["cross-origin-resource-policy"]).toBe("cross-origin");
  expect(image.headers["content-type"]).toContain("image/webp");
  expect(image.rawPayload.subarray(8,12).toString()).toBe("WEBP");
  const cached=await app.inject({method:"GET",url:"/avatars/"+slug,headers:{"if-none-match":String(image.headers.etag)}});
  expect(cached.statusCode).toBe(304);expect(cached.headers["cross-origin-resource-policy"]).toBe("cross-origin");

  const saved=await app.inject({method:"PUT",url:"/admin/profile/avatar",headers:auth(token),payload:{kind:"PRESET",presetId:slug}});
  expect(saved.statusCode).toBe(200);expect(saved.json().avatar).toMatchObject({kind:"CATALOG",slug,tier:"OWNER"});
  const session=await app.inject({method:"POST",url:"/admin/participant-session",headers:auth(token)});
  expect(session.statusCode).toBe(200);const participant=session.json().token;
  const board=await app.inject({method:"GET",url:"/dashboard",headers:auth(participant)});
  expect(board.json().user.avatar).toMatchObject({kind:"CATALOG",slug});
  const sent=await app.inject({method:"POST",url:"/chat/global",headers:auth(participant),payload:{body:"Olá, comunidade!"}});
  expect(sent.json().role).toBe("OWNER");
  const chat=await app.inject({method:"GET",url:"/chat/global",headers:auth(participant)});
  expect(chat.json().messages.at(-1).sender.avatar).toMatchObject({kind:"CATALOG",slug});
  expect((await app.inject({method:"PUT",url:"/profile/avatar",headers:auth(participant),payload:{kind:"PRESET",presetId:"avatar-17"}})).statusCode).toBe(200);
  const overview=await app.inject({method:"GET",url:"/admin/overview",headers:auth(token)});
  expect(overview.json().owner.avatar).toMatchObject({kind:"PRESET",presetId:"avatar-17"});
 });
 it("participante comum não seleciona avatar exclusivo Owner",async()=>{
  const user=await member("5571999990201","Alice"),slug=cat("OWNER");
  const saved=await app.inject({method:"PUT",url:"/profile/avatar",headers:auth(user.token),payload:{kind:"PRESET",presetId:slug}});
  expect(saved.statusCode).toBe(403);expect(saved.json().code).toBe("AVATAR_TIER_LOCKED");
 });
 it("mensagem antiga atualiza selo SUPER após expiração e mantém identidade do catálogo",async()=>{
  const user=await member("5571999990202","Bruno"),slug=cat("COMMON");
  await app.inject({method:"PUT",url:"/profile/avatar",headers:auth(user.token),payload:{kind:"PRESET",presetId:slug}});
  grantSuper(db,user.id,{source:"TEST",days:1});
  await app.inject({method:"POST",url:"/chat/global",headers:auth(user.token),payload:{body:"Bom dia, criadores"}});
  const first=await app.inject({method:"GET",url:"/chat/global",headers:auth(user.token)});
  expect(first.json().messages[0].role).toBe("SUPER");
  db.prepare("UPDATE super_subscriptions SET expires_at=? WHERE user_id=?").run(new Date(Date.now()-1000).toISOString(),user.id);
  const current=await app.inject({method:"GET",url:"/chat/global",headers:auth(user.token)});
  expect(current.json().messages[0]).toMatchObject({role:"USER",sender:{avatar:{kind:"CATALOG",slug}}});
 });
 it("cursor não perde mensagens com o mesmo timestamp",async()=>{
  const a=await member("5571999990203","Ana"),b=await member("5571999990204","Bia");
  const first=await app.inject({method:"POST",url:"/chat/global",headers:auth(a.token),payload:{body:"Primeira mensagem"}});
  const second=await app.inject({method:"POST",url:"/chat/global",headers:auth(b.token),payload:{body:"Segunda mensagem"}});
  db.prepare("UPDATE global_chat_messages SET created_at=?").run("2026-10-12T23:00:00.000Z");
  const delta=await app.inject({method:"GET",url:"/chat/global?afterId="+first.json().id,headers:auth(a.token)});
  expect(delta.json().messages.map((m:{id:string})=>m.id)).toEqual([second.json().id]);
 });
 it("Híbrido+ e pausa cruzam Bot, Integrações e runtime sem expor segredos",async()=>{
  const token=await owner();
  const saved=await app.inject({method:"POST",url:"/admin/integrations/whatsapp",headers:auth(token),payload:{mode:"HYBRID_PLUS",evolutionUrl:"https://evolution.example.test",evolutionInstance:"sos-test",evolutionApiKey:"test-api-key-123"}});
  expect(saved.statusCode).toBe(200);expect(saved.json().mode).toBe("HYBRID_PLUS");
  const bot=await app.inject({method:"GET",url:"/admin/bot",headers:auth(token)});
  expect(bot.json().status.mode).toBe("HYBRID_PLUS");
  expect(JSON.stringify(saved.json())).not.toContain("test-api-key-123");
  await app.inject({method:"POST",url:"/admin/bot",headers:auth(token),payload:{mode:"DISABLED"}});
  const integration=await app.inject({method:"GET",url:"/admin/integrations/whatsapp",headers:auth(token)});
  expect(integration.json().mode).toBe("DISABLED");expect(integration.json().evolutionApiKeyConfigured).toBe(true);
  expect(effectiveWhatsAppConfig(db,{...config,WHATSAPP_ACCESS_TOKEN:"a-secret",WPP_CONNECT_URL:"https://wpp.example.test"}).WHATSAPP_ACCESS_TOKEN).toBeUndefined();
  expect(effectiveWhatsAppConfig(db,config).WPP_CONNECT_URL).toBe("");
 });
 it("ROOT possui inventário derivado e presenteia; comum não pode forjar acesso ilimitado",async()=>{
  const token=await owner(),user=await member("5571999990205","Cris");
  const root=await app.inject({method:"POST",url:"/admin/participant-session",headers:auth(token)});
  const rootAuth=auth(root.json().token);
  const inventory=await app.inject({method:"GET",url:"/queues/mine",headers:rootAuth});
  expect(inventory.json().skipsAvailable).toBe(Number.MAX_SAFE_INTEGER);
  expect((await app.inject({method:"GET",url:"/super/me",headers:rootAuth})).json()).toMatchObject({active:true,source:"ROOT_OWNER"});
  const sent=await app.inject({method:"POST",url:"/inventory/gift",headers:rootAuth,payload:{toUserId:user.id,itemCode:"SKIP",quantity:1}});
  expect(sent.statusCode).toBe(200);
  expect((await app.inject({method:"GET",url:"/queues/mine",headers:auth(user.token)})).json().skipsAvailable).toBe(1);
  const failed=await app.inject({method:"POST",url:"/inventory/gift",headers:auth(user.token),payload:{toUserId:root.json().user.id,itemCode:"SKIP",quantity:2,rootAccess:true}});
  expect(failed.statusCode).toBe(409);
 });
 it("repetir a confirmação de presente não debita nem credita novamente",async()=>{
  const a=await member("5571999990206","Dani"),b=await member("5571999990207","Eli"),c=await member("5571999990208","Fran");
  grantItem(db,{userId:a.id,itemCode:ITEM_SKIP,delta:1,kind:"OWNER_ADJUST"});
  const payload={toUserId:b.id,itemCode:ITEM_SKIP,quantity:1,referenceId:randomUUID()};
  for(let i=0;i<2;i++)expect((await app.inject({method:"POST",url:"/inventory/gift",headers:auth(a.token),payload})).statusCode).toBe(200);
  expect((await app.inject({method:"GET",url:"/queues/mine",headers:auth(b.token)})).json().skipsAvailable).toBe(1);
  expect((await app.inject({method:"GET",url:"/queues/mine",headers:auth(a.token)})).json().skipsAvailable).toBe(0);
  expect((await app.inject({method:"POST",url:"/inventory/gift",headers:auth(a.token),payload:{...payload,toUserId:c.id}})).statusCode).toBe(409);
 });
 it("Pular entra em outra fila e a seleção é respeitada no alvo de contribuição",async()=>{
  const user=await member("5571999990209","Gabi");
  const before=(await app.inject({method:"GET",url:"/dashboard",headers:auth(user.token)})).json().openRound.id;
  joinRound(db,before,user.id,"FREE");
  grantItem(db,{userId:user.id,itemCode:ITEM_SKIP,delta:1,kind:"OWNER_ADJUST"});
  const next=await app.inject({method:"POST",url:"/queues/skip",headers:auth(user.token)});
  expect(next.statusCode).toBe(200);expect(next.json().queue.id).not.toBe(before);
  expect((await app.inject({method:"GET",url:"/queues/mine",headers:auth(user.token)})).json().queues).toHaveLength(2);
  expect(currentRoundFor(db,user.id,next.json().queue.id)?.id).toBe(next.json().queue.id);
 });
 it("aviso interno mostra o Owner e seu avatar; participante não emite aviso global",async()=>{
  const token=await owner(),user=await member("5571999990210","Hugo");
  await app.inject({method:"PUT",url:"/admin/profile/avatar",headers:auth(token),payload:{kind:"PRESET",presetId:"avatar-17"}});
  expect((await app.inject({method:"POST",url:"/admin/mail/broadcast",headers:auth(token),payload:{body:"Bem-vindos à nossa comunidade."}})).statusCode).toBe(200);
  const thread=await app.inject({method:"GET",url:"/mail/thread/broadcast",headers:auth(user.token)});
  expect(thread.json().messages[0].sender).toMatchObject({name:"Fabio",avatar:{kind:"PRESET",presetId:"avatar-17"}});
  expect((await app.inject({method:"POST",url:"/admin/mail/broadcast",headers:auth(user.token),payload:{body:"Não autorizado"}})).statusCode).toBe(401);
 });

 it("Pular preserva a tarefa pendente e libera apenas a nova fila autorizada",async()=>{
  const user=await member("5571999990211","Iara"),old=currentRoundFor(db,user.id)!;
  db.prepare("INSERT INTO submissions(id,round_id,slot,user_id,youtube_url,video_id,created_at) VALUES (?,?,1,?,?,?,?)").run(randomUUID(),old.id,user.id,"https://youtu.be/dQw4w9WgXcQ","dQw4w9WgXcQ",new Date().toISOString());
  db.prepare("UPDATE rounds SET status='READY' WHERE id=?").run(old.id);
  const before=await app.inject({method:"GET",url:"/dashboard",headers:auth(user.token)});
  expect(before.json().viewer.contributionBlockedByPendingTask).toBe(true);
  grantItem(db,{userId:user.id,itemCode:ITEM_SKIP,delta:1,kind:"OWNER_ADJUST"});
  const next=(await app.inject({method:"POST",url:"/queues/skip",headers:auth(user.token)})).json().queue.id;
  const after=await app.inject({method:"GET",url:"/dashboard?roundId="+next,headers:auth(user.token)});
  expect(after.json().viewer.contributionBlockedByPendingTask).toBe(false);
  expect(after.json().readyRounds.some((r:{id:string})=>r.id===old.id)).toBe(true);
  const previous=await app.inject({method:"GET",url:"/dashboard?roundId="+old.id,headers:auth(user.token)});
  expect(previous.json().viewer.contributionBlockedByPendingTask).toBe(true);
 });

 it("recupera a escolha híbrida mais recente do Claude sem confundir WPPConnect",async()=>{
  const put=(key:string,value:string,time:string)=>db.prepare("INSERT INTO integration_settings(key,value,updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at").run(key,value,time);
  put("whatsapp.mode","OFFICIAL","2000-01-01T00:00:00Z");
  put("bot.mode","HYBRID","2001-01-01T00:00:00Z");
  expect(readWhatsAppIntegration(db,config).mode).toBe("HYBRID_PLUS");
  const token=await owner();
  expect((await app.inject({method:"GET",url:"/admin/bot",headers:auth(token)})).json().status.mode).toBe("HYBRID_PLUS");
  put("whatsapp.mode","HYBRID","2002-01-01T00:00:00Z");
  expect(readWhatsAppIntegration(db,config).mode).toBe("META_GROUPS");
 });

 it("atualização do servidor sincroniza avatar legado e preserva a escolha mais recente",async()=>{
  const token=await owner();
  const participant=(await app.inject({method:"POST",url:"/admin/participant-session",headers:auth(token)})).json();
  const ownerId=(await app.inject({method:"GET",url:"/admin/credentials",headers:auth(token)})).json().mine.ownerId;
  db.prepare("INSERT INTO owner_profiles(owner_id,avatar_kind,avatar_preset,updated_at) VALUES (?,'PRESET','avatar-17','2001-01-01T00:00:00Z')").run(ownerId);
  await app.close();app=await buildApp(config,db);
  const inherited=(await app.inject({method:"GET",url:"/dashboard",headers:auth(participant.token)})).json();
  expect(inherited.user.avatar).toMatchObject({kind:"PRESET",presetId:"avatar-17"});
  db.prepare("UPDATE user_profiles SET avatar_preset='avatar-18',updated_at='2002-01-01T00:00:00Z' WHERE user_id=?").run(participant.user.id);
  await app.close();app=await buildApp(config,db);
  expect((await app.inject({method:"GET",url:"/admin/overview",headers:auth(token)})).json().owner.avatar).toMatchObject({kind:"PRESET",presetId:"avatar-18"});
 });

});
