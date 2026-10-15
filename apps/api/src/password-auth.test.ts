// AUDITORIA C-01: fluxo de senha persistente (login, set, bootstrap, lockout).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "./app.js";
import { loadConfig, type Config } from "./config.js";
import { createDatabase, type AppDatabase } from "./db.js";
import { normalizePhone } from "./phone.js";
import { hashPassword, verifyPassword, generateBotPassword } from "./password.js";
import { encryptToken } from "./youtube.js";
import { flushWhatsAppOutbox } from "./whatsapp.js";

describe("login por senha persistente", () => {
  let db: AppDatabase; let app: Awaited<ReturnType<typeof buildApp>>; let config: Config;
  beforeEach(async () => {
    config = loadConfig({ REQUIRE_GROUP_MEMBERSHIP: "true", NODE_ENV: "test", DATABASE_PATH: ":memory:",
      AUTH_DEV_MODE: "true", PAYMENTS_DEV_MODE: "true", JWT_SECRET: "pwd-test-secret-32-characters-okay",
      AUTH_CODE_PEPPER: "pwd-test-pepper", YOUTUBE_API_KEY: undefined });
    db = createDatabase(":memory:"); app = await buildApp(config, db);
  });
  afterEach(async () => { vi.restoreAllMocks(); await app.close(); db.close(); });

  const phone = "71998887766";
  async function approveAndOtpSession(group = "7") {
    const normalized = normalizePhone(phone), stamp = new Date().toISOString();
    db.prepare("INSERT OR IGNORE INTO groups(code,enabled,membership_mode) VALUES (?,1,'OWNER')").run(group);
    db.prepare("INSERT INTO group_memberships(phone,group_code,approved_at,source) VALUES (?,?,?,?) ON CONFLICT(phone) DO UPDATE SET group_code=excluded.group_code,approved_at=excluded.approved_at,revoked_at=NULL,source=excluded.source").run(normalized, group, stamp, "OWNER");
    const req = await app.inject({ method: "POST", url: "/auth/request-code", payload: { name: "Pessoa", phone, groupCode: group } });
    const otp = await app.inject({ method: "POST", url: "/auth/verify", payload: { phone, code: req.json().devCode } });
    expect(otp.statusCode).toBe(200);
    return otp.json().token as string;
  }
  const bearer = (t: string) => ({ authorization: `Bearer ${t}` });

  it("unidade: hash/verify e robusto e o sal muda o hash", () => {
    const h1 = hashPassword("segredo-forte-1"), h2 = hashPassword("segredo-forte-1");
    expect(h1).not.toBe(h2);                       // sal aleatorio
    expect(verifyPassword("segredo-forte-1", h1)).toBe(true);
    expect(verifyPassword("errada", h1)).toBe(false);
    expect(verifyPassword("x", undefined)).toBe(false);
    expect(verifyPassword("x", "formato$invalido")).toBe(false);
    expect(generateBotPassword()).toMatch(/^[A-Za-z0-9]{14}$/);
  });

  it("C-01 fechado: membro do grupo sem senha NAO entra por /auth/password/login", async () => {
    const normalized = normalizePhone(phone), stamp = new Date().toISOString();
    db.prepare("INSERT OR IGNORE INTO groups(code,enabled,membership_mode) VALUES ('7',1,'OWNER')").run();
    db.prepare("INSERT INTO group_memberships(phone,group_code,approved_at,source) VALUES (?,?,?,?)").run(normalized, "7", stamp, "OWNER");
    const r = await app.inject({ method: "POST", url: "/auth/password/login", payload: { phone, groupCode: "7", password: "qualquer-chute" } });
    expect(r.statusCode).toBe(401); // sem senha definida, ninguem entra por senha
  });

  it("define senha apos OTP e passa a entrar por senha; a sessao serve ao dashboard", async () => {
    const otpToken = await approveAndOtpSession();
    const set = await app.inject({ method: "POST", url: "/auth/password/set", headers: bearer(otpToken), payload: { newPassword: "minha-senha-boa-123" } });
    expect(set.statusCode).toBe(200);
    const login = await app.inject({ method: "POST", url: "/auth/password/login", payload: { phone, groupCode: "7", password: "minha-senha-boa-123" } });
    expect(login.statusCode).toBe(200);
    expect(login.json().token).toBeTruthy();
    const dash = await app.inject({ method: "GET", url: "/dashboard", headers: bearer(login.json().token) });
    expect(dash.statusCode).toBe(200);
  });

  it("senha errada falha e bloqueia apos 5 tentativas", async () => {
    const otpToken = await approveAndOtpSession();
    await app.inject({ method: "POST", url: "/auth/password/set", headers: bearer(otpToken), payload: { newPassword: "senha-correta-123" } });
    for (let i = 0; i < 5; i++) {
      const r = await app.inject({ method: "POST", url: "/auth/password/login", payload: { phone, groupCode: "7", password: "errada" } });
      expect(r.statusCode).toBe(401);
    }
    const locked = await app.inject({ method: "POST", url: "/auth/password/login", payload: { phone, groupCode: "7", password: "senha-correta-123" } });
    expect(locked.statusCode).toBe(429);
    expect(locked.json().code).toBe("PASSWORD_LOCKED");
  });

  it("bootstrap gera senha pelo servidor, exige troca, e a senha gerada funciona", async () => {
    const otpToken = await approveAndOtpSession();
    const boot = await app.inject({ method: "POST", url: "/auth/password/bootstrap", headers: bearer(otpToken), payload: {} });
    expect(boot.statusCode).toBe(200);
    const generated = boot.json().password as string;
    expect(generated).toMatch(/^[A-Za-z0-9]{14}$/);
    expect(boot.json().mustChange).toBe(true);
    const login = await app.inject({ method: "POST", url: "/auth/password/login", payload: { phone, groupCode: "7", password: generated } });
    expect(login.statusCode).toBe(200);
    expect(login.json().mustChangePassword).toBe(true);
  });

  it("troca de senha com sessao de senha exige a senha atual correta", async () => {
    const otpToken = await approveAndOtpSession();
    await app.inject({ method: "POST", url: "/auth/password/set", headers: bearer(otpToken), payload: { newPassword: "primeira-senha-123" } });
    const pwdLogin = await app.inject({ method: "POST", url: "/auth/password/login", payload: { phone, groupCode: "7", password: "primeira-senha-123" } });
    const pwdToken = pwdLogin.json().token as string;
    // sessao de senha, sem a senha atual => recusado
    const bad = await app.inject({ method: "POST", url: "/auth/password/set", headers: bearer(pwdToken), payload: { newPassword: "segunda-senha-456" } });
    expect(bad.statusCode).toBe(403);
    expect(bad.json().code).toBe("REAUTH_REQUIRED");
    // com a senha atual => ok
    const good = await app.inject({ method: "POST", url: "/auth/password/set", headers: bearer(pwdToken), payload: { newPassword: "segunda-senha-456", currentPassword: "primeira-senha-123" } });
    expect(good.statusCode).toBe(200);
    const relogin = await app.inject({ method: "POST", url: "/auth/password/login", payload: { phone, groupCode: "7", password: "segunda-senha-456" } });
    expect(relogin.statusCode).toBe(200);
  });

  it("bootstrap recusa sessao que nao seja OTP/Google", async () => {
    const otpToken = await approveAndOtpSession();
    await app.inject({ method: "POST", url: "/auth/password/set", headers: bearer(otpToken), payload: { newPassword: "senha-base-123" } });
    const pwdToken = (await app.inject({ method: "POST", url: "/auth/password/login", payload: { phone, groupCode: "7", password: "senha-base-123" } })).json().token as string;
    const boot = await app.inject({ method: "POST", url: "/auth/password/bootstrap", headers: bearer(pwdToken), payload: {} });
    expect(boot.statusCode).toBe(403);
  });
  it.each(["bootstrap","set"] as const)("%s invalida senha antiga já enfileirada pelo bot",async(action)=>{
    const otpToken=await approveAndOtpSession();
    const user=db.prepare("SELECT id FROM users WHERE phone=?").get(normalizePhone(phone)) as {id:string};
    const stamp=new Date().toISOString(),oldPassword="old-bot-password-123",outboxId="stale-password-job";
    db.prepare("INSERT INTO user_passwords(user_id,password_hash,must_change,updated_at) VALUES(?,?,1,?)").run(user.id,hashPassword(oldPassword),stamp);
    const envelope=JSON.stringify({encryptedNotification:encryptToken(JSON.stringify({type:"text",text:{body:"Sua senha é "+oldPassword}}),config)});
    db.prepare("INSERT INTO whatsapp_outbox(id,dedupe_key,recipient,payload,available_at,created_at) VALUES(?,?,?,?,?,?)").run(outboxId,"bot-password:"+user.id,normalizePhone(phone),envelope,stamp,stamp);
    db.prepare("INSERT INTO bot_password_deliveries(user_id,outbox_id,created_at) VALUES(?,?,?)").run(user.id,outboxId,stamp);
    const response=await app.inject({method:"POST",url:"/auth/password/"+action,headers:bearer(otpToken),payload:action==="set"?{newPassword:"new-participant-password-123"}:{}});
    expect(response.statusCode).toBe(200);
    const newPassword=action==="bootstrap"?response.json().password:"new-participant-password-123";
    expect(db.prepare("SELECT status,last_error AS reason,payload FROM whatsapp_outbox WHERE id=?").get(outboxId)).toEqual({status:"FAILED",reason:"PASSWORD_CHANGED",payload:"{}"});
    const network=vi.spyOn(globalThis,"fetch").mockRejectedValue(new Error("External sending forbidden in credential replacement test"));
    await flushWhatsAppOutbox(db,{...config,WHATSAPP_ACCESS_TOKEN:"synthetic-access-token",WHATSAPP_PHONE_NUMBER_ID:"123456",WHATSAPP_BUSINESS_ACCOUNT_ID:"123456",WHATSAPP_APP_SECRET:"synthetic-app-secret",WHATSAPP_VERIFY_TOKEN:"synthetic-verify-token"});
    expect(network).not.toHaveBeenCalled();
    expect((await app.inject({method:"POST",url:"/auth/password/login",payload:{phone,password:oldPassword}})).statusCode).toBe(401);
    expect((await app.inject({method:"POST",url:"/auth/password/login",payload:{phone,password:newPassword}})).statusCode).toBe(200);
  });

});
