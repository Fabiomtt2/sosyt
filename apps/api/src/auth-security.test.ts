import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "./app.js";
import { createDatabase, type AppDatabase } from "./db.js";
import { loadConfig, type Config } from "./config.js";

describe("identidade por WhatsApp e fronteira administrativa",()=>{
  let db:AppDatabase, app:Awaited<ReturnType<typeof buildApp>>, config:Config, ownerToken:string;
  const phone="5571999999088";
  const owner={name:"Fábio",identifier:"5571999990001",groupCode:"#",secret:"owner-credential-for-regression-123456"};
  const headers=(token:string)=>({authorization:`Bearer ${token}`});
  beforeEach(async()=>{
    db=createDatabase(":memory:");
    config=loadConfig({NODE_ENV:"test",DATABASE_PATH:":memory:",AUTH_DEV_MODE:"true",PAYMENTS_DEV_MODE:"true",REQUIRE_GROUP_MEMBERSHIP:"true",
      OWNER_FABIO_NAME:"Fábio",OWNER_FABIO_WHATSAPP:owner.identifier,OWNER_FABIO_SECRET:owner.secret,
      GOOGLE_CLIENT_ID:undefined,GOOGLE_CLIENT_SECRET:undefined});
    app=await buildApp(config,db);
    ownerToken=(await app.inject({method:"POST",url:"/admin/login",payload:owner})).json().token;
  });
  afterEach(async()=>{await app.close();db.close();});
  async function approve(number=phone){
    const result=await app.inject({method:"POST",url:"/admin/members",headers:headers(ownerToken),payload:{name:"Pessoa",phone:number,groupCode:"1"}});
    expect(result.statusCode).toBe(200);
  }
  async function key(number=phone,registration=false){
    return app.inject({method:"POST",url:"/auth/request-code",payload:{name:"Pessoa",phone:number,...(registration?{registration:true,consent:true}:{})}});
  }
  const verify=(code:string,number=phone)=>app.inject({method:"POST",url:"/auth/verify",payload:{phone:number,code}});
  it("chave dura cinco minutos, abre o cadastro manual e não duplica conta ou saldo",async()=>{
    await approve();
    const issued=await key();
    expect(issued.json().expiresInSeconds).toBe(300);
    const stored=db.prepare("SELECT created_at,expires_at FROM login_codes").get() as {created_at:string;expires_at:string};
    expect(Date.parse(stored.expires_at)-Date.parse(stored.created_at)).toBe(300_000);
    const first=await verify(issued.json().devCode);
    expect(first.statusCode).toBe(200);
    const userId=first.json().user.id;
    const before=db.prepare("SELECT * FROM wallets WHERE user_id=?").get(userId);
    db.prepare("UPDATE login_codes SET created_at=?").run(new Date(Date.now()-61_000).toISOString());
    const second=await verify((await key()).json().devCode);
    expect(second.json().user.id).toBe(userId);
    expect(db.prepare("SELECT * FROM wallets WHERE user_id=?").get(userId)).toEqual(before);
    expect(db.prepare("SELECT COUNT(*) AS n FROM wallet_ledger WHERE user_id=? AND kind='WELCOME'").get(userId)).toEqual({n:1});
    const session=app.jwt.verify<{authMethod:string;authPhone:string}>(second.json().token);
    expect(session).toMatchObject({authMethod:"otp",authPhone:phone});
  });
  it("nega chave expirada, reuso e uso em outro telefone",async()=>{
    await approve();
    const code=(await key()).json().devCode;
    expect((await verify(code,"5571999999089")).statusCode).toBe(401);
    db.prepare("UPDATE login_codes SET expires_at=?").run(new Date(Date.now()-1).toISOString());
    expect((await verify(code)).statusCode).toBe(401);
    db.prepare("DELETE FROM login_codes").run();
    const fresh=(await key()).json().devCode;
    expect((await verify(fresh)).statusCode).toBe(200);
    expect((await verify(fresh)).statusCode).toBe(401);
  });
  it("reenvio invalida chave anterior e limita tentativas",async()=>{
    await approve();
    const old=(await key()).json().devCode;
    expect((await key()).statusCode).toBe(429);
    db.prepare("UPDATE login_codes SET created_at=?").run(new Date(Date.now()-61_000).toISOString());
    const fresh=(await key()).json().devCode;
    expect(db.prepare("SELECT COUNT(*) AS n FROM login_codes WHERE used_at IS NULL").get()).toEqual({n:1});
    const wrong=fresh==="000000"?"111111":"000000";
    for(let i=0;i<5;i++)expect((await verify(wrong)).statusCode).toBe(401);
    expect((await verify(fresh)).statusCode).toBe(429);
    expect(old).toMatch(/^\d{6}$/);
  });
  it("registro confirma o telefone sem inventar aprovação de grupo",async()=>{
    const issued=await key(phone,true);
    expect(issued.statusCode).toBe(200);
    const result=await verify(issued.json().devCode);
    expect(result.statusCode).toBe(200);
    expect(result.json().token).toBeUndefined();
    expect(result.json().participation.status).toBe("PENDING");
    expect(db.prepare("SELECT COUNT(*) AS n FROM group_memberships WHERE phone=?").get(phone)).toEqual({n:0});
    expect(db.prepare("SELECT COUNT(*) AS n FROM users WHERE phone=?").get(phone)).toEqual({n:0});
    await approve();
    db.prepare("UPDATE login_codes SET created_at=?").run(new Date(Date.now()-61_000).toISOString());
    expect((await verify((await key()).json().devCode)).json().token).toBeTruthy();
    expect((await verify(issued.json().devCode)).statusCode).toBe(401);
  });
  it("registro exige consentimento e chave não é devolvida quando envio real está indisponível",async()=>{
    expect((await app.inject({method:"POST",url:"/auth/request-code",payload:{name:"Pessoa",phone,registration:true}})).statusCode).toBe(400);
    config.AUTH_DEV_MODE=false;
    const result=await key(phone,true);
    expect(result.statusCode).toBe(503);
    expect(result.json().devCode).toBeUndefined();
    expect(db.prepare("SELECT COUNT(*) AS n FROM login_codes").get()).toEqual({n:0});
  });
  it("produção recusa login só por nome/número e aceita a sessão comprovada por chave",async()=>{
    await approve();
    const insecure=(await app.inject({method:"POST",url:"/auth/login",payload:{name:"Pessoa",phone}})).json().token;
    const code=(await key()).json().devCode;
    config.AUTH_DEV_MODE=false;
    expect((await app.inject({method:"POST",url:"/auth/login",payload:{name:"Pessoa",phone}})).statusCode).toBe(403);
    expect((await app.inject({url:"/dashboard",headers:headers(insecure)})).statusCode).toBe(401);
    const verified=await verify(code);
    expect(verified.statusCode).toBe(200);
    expect((await app.inject({url:"/dashboard",headers:headers(verified.json().token)})).statusCode).toBe(200);
    expect((await app.inject({url:"/auth/options"})).json()).toMatchObject({proofRequired:true,googleRequired:false});
  });
  it("produção não permite enumerar cadastro/grupo pela rota pública legada",async()=>{
    await approve();
    config.AUTH_DEV_MODE=false;
    const result=await app.inject({method:"POST",url:"/participation/request",payload:{name:"Curioso",phone,consent:true}});
    expect(result.statusCode).toBe(403);
    expect(result.json()).toMatchObject({code:"IDENTITY_PROOF_REQUIRED"});
    expect(result.json().groupCode).toBeUndefined();
    expect(result.json().alreadyApproved).toBeUndefined();
  });

  it("alterar o telefone invalida a prova anterior",async()=>{
    await approve();
    const verified=await verify((await key()).json().devCode);
    config.AUTH_DEV_MODE=false;
    db.prepare("UPDATE users SET phone=? WHERE id=?").run("5571999999099",verified.json().user.id);
    expect((await app.inject({url:"/dashboard",headers:headers(verified.json().token)})).statusCode).toBe(401);
  });
  it("conhecer nome e telefone de Fábio não concede ROOT_OWNER",async()=>{
    await approve(owner.identifier);
    const login=await app.inject({method:"POST",url:"/auth/login",payload:{name:owner.name,phone:owner.identifier}});
    expect(login.statusCode).toBe(200);
    expect((await app.inject({method:"POST",url:"/admin/elevate",headers:headers(login.json().token)})).statusCode).toBe(403);
  });
  it("Owner legítimo vai à fila e volta; rotação da credencial revoga a sessão administrativa",async()=>{
    const participant=await app.inject({method:"POST",url:"/admin/participant-session",headers:headers(ownerToken)});
    expect(participant.statusCode).toBe(200);
    const token=participant.json().token;
    expect((await app.inject({url:"/dashboard",headers:headers(token)})).statusCode).toBe(200);
    expect((await app.inject({method:"POST",url:"/admin/elevate",headers:headers(token)})).statusCode).toBe(200);
    config.OWNER_FABIO_SECRET="rotated-owner-credential-for-regression-456789";
    expect((await app.inject({url:"/dashboard",headers:headers(token)})).statusCode).toBe(401);
    expect((await app.inject({method:"POST",url:"/admin/elevate",headers:headers(token)})).statusCode).toBe(401);
  });
});
