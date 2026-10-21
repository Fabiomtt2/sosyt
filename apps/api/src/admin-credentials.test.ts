// AUDITORIA / credencial administrativa: senha memorizável com segurança real
// (hash scrypt + bloqueio por tentativas) e segundo fator do ADMIN_OWNER.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { buildApp } from "./app.js";
import { loadConfig, type Config } from "./config.js";
import { createDatabase, type AppDatabase } from "./db.js";
import { normalizePhone } from "./phone.js";
import { generateAdminCredential,hashPassword,verifyPassword } from "./password.js";
import { setCredential, verifyCredential, credentialState } from "./admin-credentials.js";

const ENV_SECRET = "fabio-secret-32-characters-long-okay";

describe("credencial administrativa", () => {
  let db: AppDatabase; let app: Awaited<ReturnType<typeof buildApp>>; let config: Config;
  const ROOT = { name: "Fabio0", identifier: "+55 71 [9] 9999-0001", groupCode: "#" as const, secret: ENV_SECRET };
  beforeEach(async () => {
    config = loadConfig({
      NODE_ENV: "test", DATABASE_PATH: ":memory:", AUTH_DEV_MODE: "false", REQUIRE_GROUP_MEMBERSHIP: "false",
      JWT_SECRET: "cred-secret-32-characters-okay!!!", AUTH_CODE_PEPPER: "cred-pepper-32-characters-okay!!!",
      OWNER_FABIO_NAME: "Fabio0", OWNER_FABIO_ID: "fabio", OWNER_FABIO_SECRET: ENV_SECRET, OWNER_FABIO_WHATSAPP: "5571999990001",
      OWNER_RAFAEL_NAME:"Rafael",OWNER_RAFAEL_WHATSAPP:"5571999990002",OWNER_RAFAEL_SECRET:"rafael-secret-32-characters-long-okay",
      YOUTUBE_API_KEY: undefined
    });
    db = createDatabase(":memory:"); app = await buildApp(config, db);
  });
  afterEach(async () => { await app.close(); db.close(); });
  const auth = (t: string) => ({ authorization: `Bearer ${t}` });
  const login = (secret: string) => app.inject({ method: "POST", url: "/admin/login", payload: { ...ROOT, secret } });

  it("guarda o HASH, nunca a senha em claro", () => {
    setCredential(db, "fabio", "S@S!Youtube555");
    const row = db.prepare("SELECT password_hash AS h FROM admin_credentials WHERE owner_id='fabio'").get() as { h: string };
    expect(row.h).not.toContain("S@S!Youtube555");
    expect(row.h.startsWith("scrypt$")).toBe(true);
    expect(verifyCredential(db, "fabio", "S@S!Youtube555")).toBe(true);
    expect(verifyCredential(db, "fabio", "senha errada 1")).toBe(false);
  });

  it("uma senha memorizável de 14 caracteres é aceita aqui (o ambiente exige 32)", async () => {
    setCredential(db, "fabio", "S@S!Youtube555");
    const ok = await login("S@S!Youtube555");
    expect(ok.statusCode).toBe(200);
    expect(ok.json().role).toBe("owner");
    // e o segredo do ambiente continua valendo como entrada de emergência
    expect((await login(ENV_SECRET)).statusCode).toBe(200);
    // qualquer outra coisa, não
    expect((await login("S@S!Youtube556")).statusCode).toBe(401);
  });

  it("recusa credencial fraca (curta ou sem número)", () => {
    expect(() => setCredential(db, "fabio", "curta1")).toThrow(/10 e 128/);
    expect(() => setCredential(db, "fabio", "somenteletras")).toThrow(/letras e números/);
  });

  it("bloqueia por tentativas — força bruta não compensa", () => {
    setCredential(db, "fabio", "S@S!Youtube555");
    for (let i = 0; i < 5; i++) expect(verifyCredential(db, "fabio", "errada" + i + "1")).toBe(false);
    // depois de 5 erros, nem a senha correta passa enquanto durar o bloqueio
    expect(() => verifyCredential(db, "fabio", "S@S!Youtube555")).toThrow(/bloqueada/i);
    expect(credentialState(db, "fabio").lockedUntil).toBeTruthy();
  });

  it("a rota de login tem rate-limit próprio (defesa em profundidade)", async () => {
    setCredential(db, "fabio", "S@S!Youtube555");
    const codes: number[] = [];
    for (let i = 0; i < 7; i++) codes.push((await login("errada" + i + "1")).statusCode);
    expect(codes.slice(0, 5).every((c) => c === 401)).toBe(true);   // 5 tentativas respondidas
    expect(codes.at(-1)).toBe(429);                                  // depois, a rota corta
  });

  it("ADMIN não eleva sem credencial definida pelo ROOT", async () => {
    const phone = "71988880009", normalized = normalizePhone(phone), now = new Date().toISOString();
    db.prepare("INSERT OR IGNORE INTO groups(code,enabled,membership_mode) VALUES ('12',1,'OWNER')").run();
    db.prepare("INSERT INTO group_memberships(phone,group_code,approved_at,source) VALUES (?, '12', ?, 'TEST')").run(normalized, now);
    db.prepare("INSERT INTO users(id,name,phone,group_code,created_at,updated_at) VALUES ('u-adm','Admin Auxiliar',?,'12',?,?)").run(normalized, now, now);
    db.prepare("INSERT INTO wallets(user_id,updated_at) VALUES ('u-adm',?)").run(now);
    const accessId = randomUUID();
    db.prepare(`INSERT INTO owner_access (id,user_id,phone,normalized_name,role,active,created_at,updated_at)
      VALUES (?,?,?,?, 'ADMIN_OWNER',1,?,?)`).run(accessId, "u-adm", normalized, "admin auxiliar", now, now);
    const session = app.jwt.sign({ sub: "u-adm", purpose: "session", aud: "conexao-session", authMethod: "otp", authPhone: normalized });

    // sem credencial: bloqueado com instrução clara
    const noCred = await app.inject({ method: "POST", url: "/admin/elevate", headers: auth(session) });
    expect(noCred.statusCode).toBe(403);
    expect(noCred.json().code).toBe("CREDENTIAL_REQUIRED");

    // ROOT define a credencial do ADMIN
    const rootToken = (await login(ENV_SECRET)).json().token as string;
    const set = await app.inject({ method: "POST", url: "/admin/credentials", headers: auth(rootToken), payload: { ownerId: accessId, password: "AdminAux2026" } });
    expect(set.statusCode).toBe(200);

    // agora precisa informá-la: posse do telefone sozinha não basta
    expect((await app.inject({ method: "POST", url: "/admin/elevate", headers: auth(session) })).statusCode).toBe(401);
    expect((await app.inject({ method: "POST", url: "/admin/elevate", headers: auth(session), payload: { secret: "errada123" } })).statusCode).toBe(401);
    const ok = await app.inject({ method: "POST", url: "/admin/elevate", headers: auth(session), payload: { secret: "AdminAux2026" } });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().ownerRole).toBe("ADMIN_OWNER");
  });

  it("identidade do Owner é NOME + TELEFONE, sem acento e sem caixa", async () => {
    setCredential(db, "fabio", "S@S!Youtube555");
    for (const name of ["Fabio0", "fábio", "FáBiO", "FABIO"]) {
      const r = await app.inject({ method: "POST", url: "/admin/login", payload: { name, phone: "5571999990001", groupCode: "#", secret: "S@S!Youtube555" } });
      expect(r.statusCode, `nome ${name}`).toBe(200);
    }
    // telefone errado nao entra, mesmo com nome e senha certos
    expect((await app.inject({ method: "POST", url: "/admin/login", payload: { name: "Fabio0", phone: "5571999999999", groupCode: "#", secret: "S@S!Youtube555" } })).statusCode).toBe(401);
  });

  it("trocar o telefone do Owner no painel passa a valer no login", async () => {
    setCredential(db, "fabio", "S@S!Youtube555");
    const root = (await app.inject({ method: "POST", url: "/admin/login", payload: { name: "Fabio0", phone: "5571999990001", groupCode: "#", secret: ENV_SECRET } })).json().token as string;
    const changed = await app.inject({ method: "POST", url: "/admin/owner-phone", headers: auth(root), payload: { ownerId: "fabio", phone: "5571911112222" } });
    expect(changed.statusCode).toBe(200);
    // o numero novo entra; o antigo nao
    expect((await app.inject({ method: "POST", url: "/admin/login", payload: { name: "Fabio0", phone: "5571911112222", groupCode: "#", secret: "S@S!Youtube555" } })).statusCode).toBe(200);
    expect((await app.inject({ method: "POST", url: "/admin/login", payload: { name: "Fabio0", phone: "5571999990001", groupCode: "#", secret: "S@S!Youtube555" } })).statusCode).toBe(401);
  });

  it("só ROOT gerencia credenciais e alvo inexistente continua recusado", async () => {
    const rootToken = (await login(ENV_SECRET)).json().token as string;
    expect((await app.inject({ method: "GET", url: "/admin/credentials", headers: auth(rootToken) })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/admin/credentials" })).statusCode).toBe(401);
    // alvo inexistente (nao e ADMIN ativo) e recusado
    expect((await app.inject({ method: "POST", url: "/admin/credentials", headers: auth(rootToken), payload: { ownerId: "missing-admin", password: "Qualquer123" } })).statusCode).toBe(404);
  });
  it("Root salva a própria credencial e a nova senha entra sem expor segredo no histórico",async()=>{
    setCredential(db,"fabio","AntigaSegura123");const token=(await login(ENV_SECRET)).json().token;
    const saved=await app.inject({method:"POST",url:"/admin/credentials",headers:auth(token),payload:{password:"NovaSegura2026"}});expect(saved.statusCode,saved.body).toBe(200);expect(saved.json()).toMatchObject({ok:true,state:{configured:true,mustChange:false}});
    expect((await login("NovaSegura2026")).statusCode).toBe(200);expect((await login("AntigaSegura123")).statusCode).toBe(401);
    const audit=db.prepare("SELECT * FROM password_reset_audit WHERE event='CREDENTIAL_SET'").all();expect(audit).toHaveLength(1);expect(audit[0]).toMatchObject({actor_owner_id:"fabio"});expect(JSON.stringify(audit)).not.toContain("NovaSegura2026");expect(JSON.stringify(audit)).not.toContain("scrypt$");
    expect(()=>db.prepare("DELETE FROM password_reset_audit").run()).toThrow();
  });
  it("ambos Roots substituem a credencial do outro com motivo e identidade preservada",async()=>{
    const token=(await login(ENV_SECRET)).json().token;
    const missingReason=await app.inject({method:"POST",url:"/admin/credentials",headers:auth(token),payload:{ownerId:"rafael",password:"RafaelNova2026"}});expect(missingReason.statusCode).toBe(400);
    const saved=await app.inject({method:"POST",url:"/admin/credentials",headers:auth(token),payload:{ownerId:"static:rafael",password:"RafaelNova2026",reason:"Recuperação solicitada pelo outro Owner"}});expect(saved.statusCode,saved.body).toBe(200);
    const rafael=await app.inject({method:"POST",url:"/admin/login",payload:{name:"Rafael",phone:"5571999990002",groupCode:"#",secret:"RafaelNova2026"}});expect(rafael.statusCode,rafael.body).toBe(200);
    const other=await app.inject({method:"POST",url:"/admin/credentials",headers:auth(rafael.json().token),payload:{ownerId:"fabio",password:"FabioNova2026",reason:"Recuperação autorizada do Fábio"}});expect(other.statusCode,other.body).toBe(200);expect((await login("FabioNova2026")).statusCode).toBe(200);
    const audit=db.prepare("SELECT actor_owner_id AS actor,detail FROM password_reset_audit WHERE event='CREDENTIAL_SET' ORDER BY rowid").all() as {actor:string;detail:string}[];expect(audit.map(row=>row.actor)).toEqual(["fabio","rafael"]);expect(JSON.parse(audit[0].detail)).toMatchObject({targetId:"rafael",kind:"OWNER"});
  });
  it("falha da auditoria reverte a alteração de credencial",async()=>{
    const token=(await login(ENV_SECRET)).json().token;setCredential(db,"fabio","AnteriorSegura2026");
    db.exec("CREATE TRIGGER synthetic_fail_credential_audit BEFORE INSERT ON password_reset_audit BEGIN SELECT RAISE(ABORT,'synthetic audit unavailable'); END;");
    const saved=await app.inject({method:"POST",url:"/admin/credentials",headers:auth(token),payload:{password:"NuncaPersistida2026"}});expect(saved.statusCode).toBe(400);expect(verifyCredential(db,"fabio","AnteriorSegura2026")).toBe(true);expect(verifyCredential(db,"fabio","NuncaPersistida2026")).toBe(false);
  });
  it("Root define provisória de membro, invalida envios antigos e não altera carteira ou identidade",async()=>{
    const at=new Date().toISOString(),userId="member-password-fixture",phone="5571999990044",token=(await login(ENV_SECRET)).json().token;
    db.prepare("INSERT INTO users(id,name,phone,group_code,created_at,updated_at) VALUES(?,'Pessoa Sintética',?,'1',?,?)").run(userId,phone,at,at);
    db.prepare("INSERT INTO wallets(user_id,reward_millis,extra_slot_passes,updated_at) VALUES(?,7000,2,?)").run(userId,at);
    db.prepare("INSERT INTO user_passwords(user_id,password_hash,updated_at) VALUES(?,?,?)").run(userId,hashPassword("AnteriorParticipante123"),at);
    db.prepare("INSERT INTO whatsapp_outbox(id,dedupe_key,recipient,payload,available_at,created_at) VALUES('password-job','bot-password:member-fixture',?,'{}',?,?)").run(phone,at,at);
    db.prepare("INSERT INTO bot_password_deliveries(user_id,outbox_id,created_at) VALUES(?,'password-job',?)").run(userId,at);
    const memberToken=app.jwt.sign({sub:userId,purpose:"session",aud:"conexao-session",authMethod:"password",authPhone:phone});
    const route="/admin/participants/"+phone+"/password",payload={password:"Provisoria2026",reason:"Recuperação de acesso pedida pelo participante"};
    expect((await app.inject({method:"POST",url:route,headers:auth(memberToken),payload})).statusCode).toBe(401);
    const saved=await app.inject({method:"POST",url:route,headers:auth(token),payload});expect(saved.statusCode,saved.body).toBe(200);expect(saved.json()).toMatchObject({ok:true,mustChange:true});expect(saved.body).not.toContain(payload.password);
    const row=db.prepare("SELECT password_hash AS hash,must_change AS mustChange FROM user_passwords WHERE user_id=?").get(userId) as {hash:string;mustChange:number};expect(verifyPassword(payload.password,row.hash)).toBe(true);expect(verifyPassword("AnteriorParticipante123",row.hash)).toBe(false);expect(row.mustChange).toBe(1);
    expect(db.prepare("SELECT status,last_error AS reason FROM whatsapp_outbox WHERE id='password-job'").get()).toEqual({status:"FAILED",reason:"PASSWORD_CHANGED"});
    expect(db.prepare("SELECT reward_millis,extra_slot_passes FROM wallets WHERE user_id=?").get(userId)).toEqual({reward_millis:7000,extra_slot_passes:2});
    const logged=await app.inject({method:"POST",url:"/auth/password/login",payload:{phone,password:payload.password}});expect(logged.statusCode,logged.body).toBe(200);expect(logged.json().mustChangePassword).toBe(true);
    expect(JSON.stringify(db.prepare("SELECT * FROM password_reset_audit").all())).not.toContain(payload.password);
    expect(JSON.stringify(db.prepare("SELECT body FROM mail_messages WHERE recipient_id=?").all(userId))).not.toContain(payload.password);
    const rootWrongRoute=await app.inject({method:"POST",url:"/admin/participants/5571999990001/password",headers:auth(token),payload});expect(rootWrongRoute.statusCode).toBe(409);
    db.prepare("INSERT INTO owner_access(id,user_id,phone,normalized_name,role,active,created_at,updated_at) VALUES('credential-dynamic-admin',?,?,?,'ADMIN_OWNER',1,?,?)").run(userId,phone,"pessoa sintetica",at,at);
    expect((await app.inject({method:"POST",url:route,headers:auth(token),payload})).statusCode).toBe(409);

  });

});

describe("credencial gerada pelo bot", () => {
  it("sempre nasce com letra e dígito, sem sufixo previsível", () => {
    const amostra = Array.from({ length: 300 }, () => generateAdminCredential());
    for (const senha of amostra) {
      expect(senha.length).toBeGreaterThanOrEqual(10);
      expect(senha).toMatch(/[A-Za-z]/);
      expect(senha).toMatch(/[0-9]/);
    }
    // O defeito que isto previne: concatenar um dígito fixo deixava TODA senha
    // terminando no mesmo caractere — pista de graça para quem tenta adivinhar.
    const ultimos = new Set(amostra.map((senha) => senha.at(-1)));
    expect(ultimos.size).toBeGreaterThan(1);
    expect(new Set(amostra).size).toBe(amostra.length);   // e nenhuma repetida
  });
});
