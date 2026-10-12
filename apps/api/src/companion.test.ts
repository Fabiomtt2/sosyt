import { afterEach,beforeEach,describe,expect,it } from "vitest";
import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createDatabase,type AppDatabase } from "./db.js";

describe("companion opcional e revogável",()=>{
 let db:AppDatabase,app:Awaited<ReturnType<typeof buildApp>>,token:string,userId:string;
 const auth=(value:string)=>({authorization:`Bearer ${value}`});
 beforeEach(async()=>{
  db=createDatabase(":memory:");
  app=await buildApp(loadConfig({NODE_ENV:"test",DATABASE_PATH:":memory:",AUTH_DEV_MODE:"true",REQUIRE_GROUP_MEMBERSHIP:"false",
   JWT_SECRET:"companion-test-secret-32-characters",AUTH_CODE_PEPPER:"companion-test"}),db);
  db.prepare("INSERT OR IGNORE INTO groups(code,enabled,membership_mode) VALUES ('12',1,'OWNER')").run();
  db.prepare("INSERT INTO group_memberships(phone,group_code,approved_at,source) VALUES (?,'12',?,'TEST')").run("5571999999221",new Date().toISOString());
  const requested=await app.inject({method:"POST",url:"/auth/request-code",payload:{name:"Companion Test",phone:"+5571999999221"}});
  const login=await app.inject({method:"POST",url:"/auth/verify",payload:{phone:"+5571999999221",code:requested.json().devCode}});
  expect(login.statusCode).toBe(200);token=login.json().token;userId=login.json().user.id;
 });
 afterEach(async()=>{await app.close();db.close();});
 async function pairing(){
  const result=await app.inject({method:"POST",url:"/companion/pairings",headers:auth(token),payload:{consent:true}});
  expect(result.statusCode).toBe(200);return result.json().pairingCode as string;
 }
 async function pair(code:string){
  return app.inject({method:"POST",url:"/companion/pair",payload:{code}});
 }
 it("exige sessão e consentimento; código expira e só pode ser usado uma vez",async()=>{
  expect((await app.inject({method:"POST",url:"/companion/pairings",payload:{consent:true}})).statusCode).toBe(401);
  expect((await app.inject({method:"POST",url:"/companion/pairings",headers:auth(token),payload:{consent:false}})).statusCode).toBe(400);
  const code=await pairing(),result=await pair(code);
  expect(result.statusCode).toBe(200);expect(result.json().deviceToken).toHaveLength(64);
  expect((await pair(code)).statusCode).toBe(401);
  const expired=await pairing();db.prepare("UPDATE companion_pairings SET expires_at=0").run();
  expect((await pair(expired)).statusCode).toBe(401);
 });
 it("recebe apenas metadados, rejeita replay e nunca altera moedas ou tempo",async()=>{
  const paired=(await pair(await pairing())).json(),headers=auth(paired.deviceToken);
  const observe=(payload:Record<string,unknown>)=>app.inject({method:"POST",url:"/companion/observations",headers,payload});
  expect((await observe({sequence:1,signal:"ADVANCING",positionSeconds:20,durationSeconds:100,image:"raw"})).statusCode).toBe(400);
  const sample=await observe({sequence:1,signal:"ADVANCING",positionSeconds:20,durationSeconds:100});
  expect(sample.statusCode).toBe(200);expect(sample.json()).toMatchObject({playerMatches:false,rewards:{verifiedSeconds:0,coins:0}});
  expect((await observe({sequence:1,signal:"STOPPED"})).statusCode).toBe(409);
  expect((db.prepare("SELECT COUNT(*) AS n FROM wallet_ledger WHERE user_id=? AND kind='WATCH_TIME'").get(userId) as {n:number}).n).toBe(0);
  const list=(await app.inject({url:"/companion/devices",headers:auth(token)})).json();
  expect(JSON.stringify(list)).not.toContain(paired.deviceToken);
  expect(list.devices[0]).toMatchObject({authorized:1,signal:"ADVANCING"});
 });
 it("revogação interrompe imediatamente o acesso; token de dispositivo não é login",async()=>{
  const paired=(await pair(await pairing())).json();
  expect((await app.inject({url:"/dashboard",headers:auth(paired.deviceToken)})).statusCode).toBe(401);
  db.prepare("UPDATE users SET cooldown_until=? WHERE id=?").run(new Date(Date.now()+1800000).toISOString(),userId);
  // A task cooldown must never prevent revoking screen-observation consent.
  expect((await app.inject({method:"DELETE",url:`/companion/devices/${paired.deviceId}`,headers:auth(token)})).statusCode).toBe(200);
  expect((await app.inject({url:"/companion/device",headers:auth(paired.deviceToken)})).statusCode).toBe(401);
 });
 it("o próprio companion pode revogar seu token sem uma sessão de navegador",async()=>{
  const paired=(await pair(await pairing())).json(),headers=auth(paired.deviceToken);
  expect((await app.inject({method:"DELETE",url:"/companion/device",headers})).statusCode).toBe(200);
  expect((await app.inject({url:"/companion/device",headers})).statusCode).toBe(401);
 });

});
