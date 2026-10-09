// AUDITORIA / credencial administrativa: senha memorizável com segurança real
// (hash scrypt + bloqueio por tentativas) e segundo fator do ADMIN_OWNER.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { buildApp } from "./app.js";
import { loadConfig, type Config } from "./config.js";
import { createDatabase, type AppDatabase } from "./db.js";
import { normalizePhone } from "./phone.js";
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

  it("só ROOT gerencia credenciais, e nunca a de outro ROOT", async () => {
    const rootToken = (await login(ENV_SECRET)).json().token as string;
    expect((await app.inject({ method: "GET", url: "/admin/credentials", headers: auth(rootToken) })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/admin/credentials" })).statusCode).toBe(401);
    // alvo inexistente (nao e ADMIN ativo) e recusado
    expect((await app.inject({ method: "POST", url: "/admin/credentials", headers: auth(rootToken), payload: { ownerId: "rafael", password: "Qualquer123" } })).statusCode).toBe(404);
  });
});
