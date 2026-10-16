import { randomUUID } from "node:crypto";
import { afterEach,beforeEach,describe,expect,it,vi } from "vitest";
import { createDatabase,type AppDatabase } from "./db.js";
import { loadConfig,type Config } from "./config.js";
import { hashPassword,verifyPassword } from "./password.js";
import { decryptToken } from "./youtube.js";
import { initializeBotPassword,readBotPasswordSettings,saveBotPasswordSettings,ensureBotPassword } from "./bot-password.js";

describe("senha automática do bot após prova de identidade",()=>{
 let db:AppDatabase;let config:Config;const userId="password-person",phone="5571999990033";
 beforeEach(()=>{
  vi.useFakeTimers();vi.setSystemTime(new Date("2026-10-16T09:00:00Z"));vi.stubGlobal("fetch",vi.fn(()=>{throw new Error("External sending forbidden in password tests");}));
  db=createDatabase(":memory:");initializeBotPassword(db);
  config=loadConfig({NODE_ENV:"test",DATABASE_PATH:":memory:",JWT_SECRET:"bot-password-jwt-32-characters-okay",AUTH_CODE_PEPPER:"bot-password-pepper-32-characters-okay"});
  const stamp=new Date().toISOString();db.prepare("INSERT INTO users(id,name,phone,group_code,created_at,updated_at) VALUES(?,?,?,'1',?,?)").run(userId,"Ana",phone,stamp,stamp);
  db.prepare("INSERT INTO wallets(user_id,updated_at) VALUES(?,?)").run(userId,stamp);
 });
 afterEach(()=>{db.close();vi.unstubAllGlobals();vi.useRealTimers();});
 const ready=()=>{
  config={...config,WHATSAPP_ACCESS_TOKEN:"synthetic-token",WHATSAPP_PHONE_NUMBER_ID:"123456789",WHATSAPP_BUSINESS_ACCOUNT_ID:"123456789",WHATSAPP_APP_SECRET:"synthetic-app-secret",WHATSAPP_VERIFY_TOKEN:"synthetic-verify-token"};
  db.prepare("INSERT INTO integration_settings(key,value,updated_at) VALUES('whatsapp.mode','HYBRID_PLUS',?)").run(new Date().toISOString());
 };
 const template=()=>saveBotPasswordSettings(db,{enabled:true,templateName:"sos_acesso_aprovado",templateLanguage:"pt_BR"},"root-fixture");
 const count=()=>db.prepare("SELECT COUNT(*) AS n FROM user_passwords").get();
 it("prova + template enfileiramcredencial cifrada; hash confere; retries nunca substituemsenha",()=>{
  ready();template();const first=ensureBotPassword(db,config,userId,true);
  expect(first).toEqual({created:true,queued:true});expect(Object.keys(first)).not.toContain("password");
  const row=db.prepare("SELECT password_hash AS hash,must_change AS mustChange FROM user_passwords WHERE user_id=?").get(userId) as {hash:string;mustChange:number};
  const outbox=db.prepare("SELECT payload FROM whatsapp_outbox").get() as {payload:string};
  const encrypted=JSON.parse(outbox.payload) as {encryptedNotification:string};expect(typeof encrypted.encryptedNotification).toBe("string");
  const payload=JSON.parse(decryptToken(encrypted.encryptedNotification,config));
  expect(payload).toMatchObject({type:"template",template:{name:"sos_acesso_aprovado"}});
  const body=payload.template.components[0].parameters[0].text as string;
  const generated=/é: ([A-Za-z0-9]{14})\./.exec(body)?.[1];expect(generated).toBeTruthy();expect(verifyPassword(generated!,row.hash)).toBe(true);
  expect(row.mustChange).toBe(1);expect(outbox.payload).not.toContain(generated!);expect(outbox.payload).not.toContain("Ana");
  const again=ensureBotPassword(db,config,userId,true);expect(again.created).toBe(false);
  expect(db.prepare("SELECT password_hash AS hash FROM user_passwords WHERE user_id=?").get(userId)).toEqual({hash:row.hash});
  expect(db.prepare("SELECT COUNT(*) AS n FROM whatsapp_outbox").get()).toEqual({n:1});
  expect(db.prepare("SELECT COUNT(*) AS n FROM mail_messages").get()).toEqual({n:0});expect(fetch).not.toHaveBeenCalled();
 });
 it("semprova, pausado ouMeta não pronta não criahash nemmensagem",()=>{
  expect(ensureBotPassword(db,config,userId,false).reason).toBe("PHONE_PROOF_REQUIRED");
  expect(ensureBotPassword(db,config,userId,true).reason).toBe("EVOLUTION_NOT_READY"); // default EVOLUTION sem motor configurado
  ready();template();saveBotPasswordSettings(db,{enabled:false,templateName:"",templateLanguage:"pt_BR"},"root-fixture");
  expect(ensureBotPassword(db,config,userId,true).reason).toBe("PASSWORD_BOT_DISABLED");
  expect(count()).toEqual({n:0});expect(db.prepare("SELECT COUNT(*) AS n FROM whatsapp_outbox").get()).toEqual({n:0});
 });
 it("aprovaçãoOwner semjanela não gera senha; conversaWhatsAppprovada permitetexto cifrado",()=>{
  ready();const stamp=new Date().toISOString();
  db.prepare("INSERT INTO participation_requests(id,phone,name,status,created_at,updated_at,source,whatsapp_verified_at) VALUES(?,?,?,'APPROVED',?,?,'OWNER',?)").run(randomUUID(),phone,"Ana",stamp,stamp,stamp);
  expect(ensureBotPassword(db,config,userId,true)).toMatchObject({created:false,queued:false,reason:"TEMPLATE_OR_SERVICE_WINDOW_REQUIRED"});
  expect(count()).toEqual({n:0});
  db.prepare("UPDATE participation_requests SET source='WHATSAPP' WHERE phone=?").run(phone);
  expect(ensureBotPassword(db,config,userId,true)).toEqual({created:true,queued:true});
  const outbox=db.prepare("SELECT payload FROM whatsapp_outbox").get() as {payload:string};const envelope=JSON.parse(outbox.payload);
  expect(JSON.parse(decryptToken(envelope.encryptedNotification,config)).type).toBe("text");
 });
 it("senha existente e credenciaisOwner não são tocadas; estado é auditado semsegredos",()=>{
  ready();template();const existing=hashPassword("Existing-secret-1");
  db.prepare("INSERT INTO user_passwords(user_id,password_hash,updated_at) VALUES(?,?,?)").run(userId,existing,new Date().toISOString());
  expect(ensureBotPassword(db,config,userId,true).reason).toBe("PASSWORD_ALREADY_SET");
  expect(db.prepare("SELECT password_hash AS hash FROM user_passwords WHERE user_id=?").get(userId)).toEqual({hash:existing});
  db.prepare("DELETE FROM user_passwords WHERE user_id=?").run(userId);
  const stamp=new Date().toISOString();db.prepare("INSERT INTO owner_access(id,user_id,phone,normalized_name,role,active,created_at,updated_at) VALUES('owner-fixture',?,?,?,'ADMIN_OWNER',1,?,?)").run(userId,phone,"ana",stamp,stamp);
  expect(ensureBotPassword(db,config,userId,true).reason).toBe("ADMIN_ACCOUNT");expect(count()).toEqual({n:0});
  expect(readBotPasswordSettings(db).deliveries).toEqual([]);
  expect(db.prepare("SELECT actor_id AS actor FROM bot_password_config_audit").get()).toEqual({actor:"root-fixture"});
 });
 it("falha na chave de cifra reverteoutbox e hash atomicamente",()=>{
  ready();template();config={...config,YOUTUBE_TOKEN_ENCRYPTION_KEY:"invalid"};
  expect(()=>ensureBotPassword(db,config,userId,true)).toThrow();
  expect(count()).toEqual({n:0});expect(db.prepare("SELECT COUNT(*) AS n FROM whatsapp_outbox").get()).toEqual({n:0});
 });

 it("EVOLUTION cobre tudo: senha sai pelo motor nao-oficial, cifrada, como TEXTO",()=>{
  // motor Evolution configurado via env; modo default ja e EVOLUTION
  config={...config,EVOLUTION_URL:"https://evo.example.test",EVOLUTION_INSTANCE:"sos-primary",EVOLUTION_API_KEY:"evolution-key-long-enough-1234",EVOLUTION_PHONE:"5571993951582",EVOLUTION_WEBHOOK_SECRET:"evolution-webhook-secret-min-24-chars"};
  template();
  const res=ensureBotPassword(db,config,userId,true);
  expect(res).toEqual({created:true,queued:true});
  // enfileirado como payload cifrado de TEXTO (Evolution nao usa template Meta)
  const outbox=db.prepare("SELECT payload FROM whatsapp_outbox").get() as {payload:string};
  const envelope=JSON.parse(outbox.payload) as {encryptedNotification?:string};
  expect(typeof envelope.encryptedNotification).toBe("string");
  const payload=JSON.parse(decryptToken(envelope.encryptedNotification!,config));
  expect(payload.type).toBe("text");
  expect(payload.text.body).toMatch(/senha para entrar/);
  // a senha gravada confere e nao vaza no outbox
  const row=db.prepare("SELECT password_hash AS hash FROM user_passwords WHERE user_id=?").get(userId) as {hash:string};
  const gen=/é: ([A-Za-z0-9]{14})\./.exec(payload.text.body)?.[1];
  expect(gen).toBeTruthy();expect(verifyPassword(gen!,row.hash)).toBe(true);
  expect(outbox.payload).not.toContain(gen!);
 });

});
