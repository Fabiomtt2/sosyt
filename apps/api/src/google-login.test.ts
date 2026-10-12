import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OAuth2Client } from "google-auth-library";
import { buildApp } from "./app.js";
import { createDatabase, type AppDatabase } from "./db.js";
import { loadConfig } from "./config.js";

describe("Google opcional, vínculo explícito e retorno protegido",()=>{
 let db:AppDatabase, app:Awaited<ReturnType<typeof buildApp>>, ownerToken:string,nonce:string,subject:string;
 const phone="5571999999077",browserVerifier="a".repeat(64);
 const headers=(token:string)=>({authorization:`Bearer ${token}`});
 beforeEach(async()=>{
  db=createDatabase(":memory:");
  app=await buildApp(loadConfig({NODE_ENV:"test",DATABASE_PATH:":memory:",AUTH_DEV_MODE:"true",PAYMENTS_DEV_MODE:"true",
   OWNER_FABIO_NAME:"Fábio",OWNER_FABIO_WHATSAPP:"5571999990001",OWNER_FABIO_SECRET:"google-tests-owner-credential-long-1234",
   GOOGLE_CLIENT_ID:"test-client",GOOGLE_CLIENT_SECRET:"test-secret",API_PUBLIC_URL:"http://localhost:3333",WEB_APP_URL:"http://localhost:5173"}),db);
  ownerToken=(await app.inject({method:"POST",url:"/admin/login",payload:{name:"Fábio",identifier:"5571999990001",groupCode:"#",secret:"google-tests-owner-credential-long-1234"}})).json().token;
  subject="google-sub-1";nonce="";
  vi.spyOn(OAuth2Client.prototype,"getToken").mockResolvedValue({tokens:{id_token:"test-token"}} as never);
  vi.spyOn(OAuth2Client.prototype,"verifyIdToken").mockImplementation(async options=>{
   expect(options).toEqual({idToken:"test-token",audience:"test-client"});
   return {getPayload:()=>({sub:subject,email:"pessoa@example.test",email_verified:true,nonce})} as never;
  });
 });
 afterEach(async()=>{vi.restoreAllMocks();await app.close();db.close();});
 async function start(number=phone){
  const result=await app.inject({method:"POST",url:"/auth/google/start",payload:{name:"Pessoa",phone:number,browserVerifier}});
  expect(result.statusCode).toBe(200);
  const url=new URL(result.json().url);nonce=url.searchParams.get("nonce")!;
  expect(url.searchParams.get("scope")).toBe("openid email");
  expect(url.searchParams.get("code_challenge_method")).toBe("S256");
  return url.searchParams.get("state")!;
 }
 async function callback(state:string){
  const result=await app.inject({url:"/auth/google/callback?state="+state+"&code=test-code"});
  expect(result.statusCode).toBe(302);
  return new URLSearchParams(new URL(result.headers.location!).hash.slice(1));
 }
 const complete=(ticket:string,verifier=browserVerifier)=>app.inject({method:"POST",url:"/auth/google/complete",payload:{ticket,browserVerifier:verifier}});
 async function claim(){
  const fragment=await callback(await start());
  const result=await complete(fragment.get("google_login")!);
  expect(result.statusCode).toBe(200);
  return result.json().claim;
 }
 it("não vincula Google a conta antiga só pelo telefone; Owner aprova sem duplicar carteira",async()=>{
  await app.inject({method:"POST",url:"/admin/members",headers:headers(ownerToken),payload:{name:"Pessoa",phone,groupCode:"1"}});
  const old=(await app.inject({method:"POST",url:"/auth/login",payload:{name:"Pessoa",phone}})).json();
  const wallet=db.prepare("SELECT * FROM wallets WHERE user_id=?").get(old.user.id);
  const pending=await claim();
  expect(pending.status).toBe("PENDING");
  expect(db.prepare("SELECT COUNT(*) AS n FROM google_identities").get()).toEqual({n:0});
  const list=(await app.inject({url:"/admin/google-identities",headers:headers(ownerToken)})).json();
  expect(list.claims).toHaveLength(1);
  expect((await app.inject({method:"POST",url:`/admin/google-identities/${list.claims[0].id}/decision`,headers:headers(ownerToken),payload:{approve:true,groupCode:"1"}})).statusCode).toBe(200);
  const fragment=await callback(await start());
  const session=await complete(fragment.get("google_login")!);
  const payload=app.jwt.verify<{sub:string;authMethod:string;googleSubject:string}>(session.json().token);
  expect(payload).toMatchObject({sub:old.user.id,authMethod:"google",googleSubject:subject});
  expect(db.prepare("SELECT * FROM wallets WHERE user_id=?").get(old.user.id)).toEqual(wallet);
  expect(db.prepare("SELECT COUNT(*) AS n FROM users WHERE phone=?").get(phone)).toEqual({n:1});
 });
 it("retorno só pode ser concluído pelo navegador que iniciou, uma única vez",async()=>{
  const state=await start(),fragment=await callback(state),ticket=fragment.get("google_login")!;
  expect((await complete(ticket,"b".repeat(64))).statusCode).toBe(401);
  expect((await complete(ticket)).statusCode).toBe(200);
  expect((await complete(ticket)).statusCode).toBe(401);
  expect((await app.inject({url:"/auth/google/callback?state="+state+"&code=test"})).statusCode).toBe(400);
 });
 it("nonce incorreto não gera vínculo ou ticket",async()=>{
  const state=await start();nonce="incorrect";
  expect((await callback(state)).get("google_error")).toBe("failed");
  expect(db.prepare("SELECT COUNT(*) AS n FROM google_identity_claims").get()).toEqual({n:0});
  expect(db.prepare("SELECT COUNT(*) AS n FROM google_login_results").get()).toEqual({n:0});
 });
 it("expiração de state e ticket é imposta no servidor",async()=>{
  const state=await start();
  db.prepare("UPDATE google_login_states SET expires_at=0").run();
  expect((await app.inject({url:"/auth/google/callback?state="+state+"&code=test"})).statusCode).toBe(400);
  const fragment=await callback(await start());
  db.prepare("UPDATE google_login_results SET expires_at=0").run();
  expect((await complete(fragment.get("google_login")!)).statusCode).toBe(401);
 });
 it("token de acompanhamento não abre dashboard nem permite aprovação",async()=>{
  const pending=await claim();
  expect((await app.inject({url:"/dashboard",headers:headers(pending.requestToken)})).statusCode).toBe(401);
  expect((await app.inject({url:"/admin/google-identities",headers:headers(pending.requestToken)})).statusCode).toBe(401);
  expect((await app.inject({method:"POST",url:"/auth/google/status",payload:{token:pending.requestToken}})).json().status).toBe("PENDING");
 });
});
