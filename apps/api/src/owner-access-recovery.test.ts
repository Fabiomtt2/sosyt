import {afterEach,beforeEach,describe,expect,it} from "vitest";
import {randomUUID} from "node:crypto";
import {buildApp} from "./app.js";
import {createDatabase,type AppDatabase} from "./db.js";
import {loadConfig} from "./config.js";
import {hasMembership} from "./owner.js";
import {recordGroupVerification,recordMemberVerification} from "./group-verification.js";
import {setParticipantAccess} from "./participant-access.js";
import {credentialState,setCredential,verifyCredential} from "./admin-credentials.js";
import {hashPassword} from "./password.js";

describe("recuperação integrada de associação e credencial administrativa",()=>{
  let db:AppDatabase,app:Awaited<ReturnType<typeof buildApp>>,root:string;
  const rootPhone="5571999990291",rootSecret="synthetic-root-recovery-secret-32",password="SyntheticAdmin123!";
  const auth=(token:string)=>({authorization:"Bearer "+token});
  beforeEach(async()=>{
    db=createDatabase(":memory:");
    app=await buildApp(loadConfig({NODE_ENV:"test",DATABASE_PATH:":memory:",AUTH_DEV_MODE:"false",WHATSAPP_MODE:"DISABLED",REQUIRE_GROUP_MEMBERSHIP:"true",OWNER_FABIO_NAME:"Owner Teste",OWNER_FABIO_WHATSAPP:rootPhone,OWNER_FABIO_SECRET:rootSecret,JWT_SECRET:"synthetic-recovery-jwt-secret-32"}),db);
    const login=await app.inject({method:"POST",url:"/admin/login",payload:{name:"Owner Teste",phone:rootPhone,secret:rootSecret,groupCode:"#"}});
    expect(login.statusCode,login.body).toBe(200);root=login.json().token;
  });
  afterEach(async()=>{await app.close();db.close();});
  function user(name="Admin Sintético",phone="5571999990292",groupCode="2"){
    const id=randomUUID(),at=new Date().toISOString();
    db.prepare("INSERT INTO users(id,name,phone,group_code,created_at,updated_at) VALUES(?,?,?,?,?,?)").run(id,name,phone,groupCode,at,at);
    db.prepare("INSERT INTO wallets(user_id,updated_at) VALUES(?,?)").run(id,at);
    db.prepare("INSERT INTO user_passwords(user_id,password_hash,must_change,attempts,updated_at) VALUES(?,?,0,0,?)").run(id,hashPassword(password),at);
    const token=app.jwt.sign({sub:id,purpose:"session",aud:"conexao-session",authMethod:"password",authPhone:phone});
    return {id,name,phone,token};
  }
  function member(phone:string,group:string,revoked=false){
    const at=new Date().toISOString();
    db.prepare("INSERT INTO group_memberships(phone,group_code,approved_at,revoked_at,source) VALUES(?,?,?,?, 'TEST')").run(phone,group,at,revoked?at:null);
  }
  function externalMember(phone:string,group:string){
    const external="synthetic-group-"+group;
    db.prepare("UPDATE groups SET whatsapp_group_id=? WHERE code=?").run(external,group);
    recordGroupVerification(db,"TEST",group,external,"Grupo sintético",1);
    recordMemberVerification(db,"TEST",group,phone,external,true);
  }
  async function delegated(){
    const person=user();member(person.phone,"2");
    const promoted=await app.inject({method:"POST",url:"/admin/owners",headers:auth(root),payload:{userId:person.id}});
    expect(promoted.statusCode,promoted.body).toBe(200);
    const id=promoted.json().id;setCredential(db,id,password,{mustChange:true});
    return {...person,ownerId:id};
  }
  it("a associação solicitada é verificada mesmo quando outra associação veio primeiro",async()=>{
    const person=user();member(person.phone,"1");externalMember(person.phone,"1");externalMember(person.phone,"2");
    expect(hasMembership(db,person.phone,"2")).toBe(true);expect(hasMembership(db,person.phone,"3")).toBe(false);
    const promoted=await app.inject({method:"POST",url:"/admin/owners",headers:auth(root),payload:{userId:person.id}});
    expect(promoted.statusCode,promoted.body).toBe(200);expect(promoted.json().role).toBe("ADMIN_OWNER");
  });
  it("revogação histórica em outro grupo não bloqueia a senha com associação ativa",async()=>{
    const person=user();member(person.phone,"1",true);externalMember(person.phone,"2");
    const login=await app.inject({method:"POST",url:"/auth/password/login",payload:{phone:person.phone,password}});
    expect(login.statusCode,login.body).toBe(200);
    setParticipantAccess(db,person.id,true,"fabio","Suspensão sintética");
    const suspended=await app.inject({method:"POST",url:"/auth/password/login",payload:{phone:person.phone,password}});
    expect(suspended.statusCode).toBe(403);
  });
  it("elevação exige credencial e administrador troca somente a própria credencial",async()=>{
    const person=await delegated();
    const missing=await app.inject({method:"POST",url:"/admin/elevate",headers:auth(person.token)});
    expect(missing.statusCode).toBe(401);expect(missing.json().code).toBe("CREDENTIAL_REQUIRED");
    const elevated=await app.inject({method:"POST",url:"/admin/elevate",headers:auth(person.token),payload:{secret:password}});
    expect(elevated.statusCode,elevated.body).toBe(200);const admin=elevated.json().token;
    expect((await app.inject({url:"/admin/credentials",headers:auth(admin)})).statusCode).toBe(403);
    const self=await app.inject({url:"/admin/credentials/self",headers:auth(admin)});
    expect(self.statusCode,self.body).toBe(200);expect(self.json()).toMatchObject({ownerId:person.ownerId,mustChange:true});expect(self.json().owners).toBeUndefined();
    const invalid=await app.inject({method:"POST",url:"/admin/credentials/self",headers:auth(admin),payload:{currentPassword:"wrong",password:"NewSynthetic123!"}});
    expect(invalid.statusCode).toBe(403);expect(verifyCredential(db,person.ownerId,password)).toBe(true);
    const other=await app.inject({method:"POST",url:"/admin/credentials/self",headers:auth(admin),payload:{ownerId:"fabio",currentPassword:password,password:"NewSynthetic123!"}});
    expect(other.statusCode).toBe(400);
    const saved=await app.inject({method:"POST",url:"/admin/credentials/self",headers:auth(admin),payload:{currentPassword:password,password:"NewSynthetic123!"}});
    expect(saved.statusCode,saved.body).toBe(200);expect(credentialState(db,person.ownerId).mustChange).toBe(false);expect(verifyCredential(db,person.ownerId,"NewSynthetic123!")).toBe(true);expect(verifyCredential(db,person.ownerId,password)).toBe(false);
    expect((await app.inject({method:"DELETE",url:"/admin/owners/"+person.ownerId,headers:auth(admin)})).statusCode).toBe(403);
    expect((await app.inject({method:"DELETE",url:"/admin/owners/"+person.ownerId,headers:auth(root)})).statusCode).toBe(200);
    expect((await app.inject({url:"/admin/credentials/self",headers:auth(admin)})).statusCode).toBe(401);
  });
  it("histórico financeiro de contas removidas permanece exclusivo do Root",async()=>{
    const person=await delegated();
    db.prepare("INSERT INTO account_deletions(user_id,group_code,deleted_at,source,submissions_count,rounds_count,approved_payment_cents,coins_purchased_millis,passes_purchased) VALUES(?,'1',?,'TEST',0,0,1299,10000,1)").run(randomUUID(),new Date().toISOString());
    const elevated=await app.inject({method:"POST",url:"/admin/elevate",headers:auth(person.token),payload:{secret:password}});expect(elevated.statusCode,elevated.body).toBe(200);
    const result=await app.inject({url:"/admin/overview",headers:auth(elevated.json().token)});expect(result.statusCode,result.body).toBe(200);expect(result.json().deletedAccounts).toEqual([]);expect(result.json().purchases).toEqual([]);expect(result.json().metrics.revenueCentsMonth).toBe(0);
    const full=await app.inject({url:"/admin/overview",headers:auth(root)});expect(full.json().deletedAccounts).toHaveLength(1);
  });
});
