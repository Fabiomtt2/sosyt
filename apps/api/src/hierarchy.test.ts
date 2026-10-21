// AUDITORIA / hierarquia administrativa: ROOT_OWNER (Fábio e Rafael) veem tudo;
// ADMIN_OWNER tem menos funções e menos visibilidade. Provado rota a rota.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { buildApp } from "./app.js";
import { loadConfig, type Config } from "./config.js";
import { createDatabase, type AppDatabase } from "./db.js";
import { normalizePhone } from "./phone.js";
import { credentialState, verifyCredential } from "./admin-credentials.js";

describe("hierarquia ROOT_OWNER x ADMIN_OWNER", () => {
  let db: AppDatabase; let app: Awaited<ReturnType<typeof buildApp>>; let config: Config;
  const ROOT = { name: "Fabio0", identifier: "+55 71 [9] 9999-0001", groupCode: "#" as const, secret: "fabio-secret-32-characters-long-okay" };
  beforeEach(async () => {
    config = loadConfig({
      NODE_ENV: "test", DATABASE_PATH: ":memory:", AUTH_DEV_MODE: "true", REQUIRE_GROUP_MEMBERSHIP: "false",
      JWT_SECRET: "hier-secret-32-characters-okay!!!", AUTH_CODE_PEPPER: "hier-pepper-32-characters-okay!!!",
      OWNER_FABIO_NAME: "Fabio0", OWNER_FABIO_ID: "fabio0", OWNER_FABIO_SECRET: ROOT.secret, OWNER_FABIO_WHATSAPP: "5571999990001",
      YOUTUBE_API_KEY: undefined
    });
    db = createDatabase(":memory:"); app = await buildApp(config, db);
  });
  afterEach(async () => { await app.close(); db.close(); });
  const auth = (t: string) => ({ authorization: `Bearer ${t}` });

  async function rootToken() {
    const r = await app.inject({ method: "POST", url: "/admin/login", payload: ROOT });
    expect(r.statusCode).toBe(200);
    return r.json().token as string;
  }

  /** Cria um ADMIN_OWNER real (owner_access) e devolve o token de owner dele. */
  async function adminToken() {
    const phone = "71988880001", normalized = normalizePhone(phone), now = new Date().toISOString();
    db.prepare("INSERT OR IGNORE INTO groups(code,enabled,membership_mode) VALUES ('12',1,'OWNER')").run();
    db.prepare("INSERT INTO group_memberships(phone,group_code,approved_at,source) VALUES (?, '12', ?, 'TEST')").run(normalized, now);
    const req = await app.inject({ method: "POST", url: "/auth/request-code", payload: { name: "Admin Auxiliar", phone } });
    const ver = await app.inject({ method: "POST", url: "/auth/verify", payload: { phone, code: req.json().devCode } });
    const userId = ver.json().user.id as string;
    db.prepare(`INSERT INTO owner_access (id,user_id,phone,normalized_name,role,active,created_at,updated_at)
      VALUES (?,?,?,?, 'ADMIN_OWNER',1,?,?)`).run(randomUUID(), userId, normalized, "admin auxiliar", now, now);
    const elevated = await app.inject({ method: "POST", url: "/admin/elevate", headers: auth(ver.json().token) });
    expect(elevated.statusCode).toBe(200);
    expect(elevated.json().ownerRole).toBe("ADMIN_OWNER");
    return elevated.json().token as string;
  }

  it("ROOT enxerga tudo sensível; ADMIN não", async () => {
    const root = await rootToken(), admin = await adminToken();
    const r = await app.inject({ method: "GET", url: "/admin/overview?month=2026-10", headers: auth(root) });
    const a = await app.inject({ method: "GET", url: "/admin/overview?month=2026-10", headers: auth(admin) });
    expect(r.json().owner.permissions).toMatchObject({ canViewSensitive: true, canConfigure: true, canManageOwners: true, canAdjustWallet: true, canExport: true });
    expect(a.json().owner.permissions).toMatchObject({ canViewSensitive: false, canConfigure: false, canManageOwners: false, canAdjustWallet: false, canExport: false });
    // ambos operam
    expect(r.json().owner.permissions.canOperate).toBe(true);
    expect(a.json().owner.permissions.canOperate).toBe(true);
  });

  it("CORREIO privado é exclusivo do ROOT — ADMIN não lê, não dispara, não apaga", async () => {
    const admin = await adminToken(), root = await rootToken();
    expect((await app.inject({ method: "GET", url: "/admin/mail", headers: auth(admin) })).statusCode).toBe(403);
    expect((await app.inject({ method: "POST", url: "/admin/mail/broadcast", headers: auth(admin), payload: { body: "oi" } })).statusCode).toBe(403);
    expect((await app.inject({ method: "DELETE", url: "/admin/mail/qualquer", headers: auth(admin) })).statusCode).toBe(403);
    // ROOT pode
    expect((await app.inject({ method: "GET", url: "/admin/mail", headers: auth(root) })).statusCode).toBe(200);
    expect((await app.inject({ method: "POST", url: "/admin/mail/broadcast", headers: auth(root), payload: { body: "comunicado" } })).statusCode).toBe(200);
  });

  it("CONFIGURAÇÃO é exclusiva do ROOT (loja, bot, YouTube, número)", async () => {
    const admin = await adminToken();
    expect((await app.inject({ method: "POST", url: "/admin/store/products", headers: auth(admin), payload: { code: "X_1", title: "x", amountCents: 1000, credits: 1 } })).statusCode).toBe(403);
    expect((await app.inject({ method: "POST", url: "/admin/store/products/COINS_10/active", headers: auth(admin), payload: { active: false } })).statusCode).toBe(403);
    expect((await app.inject({ method: "POST", url: "/admin/bot", headers: auth(admin), payload: { mode: "OFFICIAL" } })).statusCode).toBe(403);
    expect((await app.inject({ method: "POST", url: "/admin/integrations/youtube", headers: auth(admin), payload: { apiKey: "x".repeat(25) } })).statusCode).toBe(403);
    expect((await app.inject({ method: "POST", url: "/admin/integrations/whatsapp/health", headers: auth(admin) })).statusCode).toBe(403);
    expect((await app.inject({ method: "POST", url: "/admin/chat/global/clear", headers: auth(admin) })).statusCode).toBe(403);
  });

  it("ADMIN não VÊ configuração de APIs, bot, loja nem saúde do número", async () => {
    const admin = await adminToken();
    // Regra do owner: o que for configuravel de APIs/bots nao deve ser nem visivel.
    expect((await app.inject({ method: "GET", url: "/admin/store/products", headers: auth(admin) })).statusCode).toBe(403);
    expect((await app.inject({ method: "GET", url: "/admin/bot", headers: auth(admin) })).statusCode).toBe(403);
    expect((await app.inject({ method: "GET", url: "/admin/integrations/whatsapp/health", headers: auth(admin) })).statusCode).toBe(403);
    expect((await app.inject({ method: "GET", url: "/admin/integrations/whatsapp", headers: auth(admin) })).statusCode).toBe(403);
    expect((await app.inject({ method: "GET", url: "/admin/integrations/payments", headers: auth(admin) })).statusCode).toBe(403);
    expect((await app.inject({ method: "GET", url: "/admin/integrations/youtube", headers: auth(admin) })).statusCode).toBe(403);
  });

  it("ADMIN mantém as funções simples: aprovar, remover e moderar o chat", async () => {
    const admin = await adminToken();
    expect((await app.inject({ method: "GET", url: "/admin/overview?month=2026-10", headers: auth(admin) })).statusCode).toBe(200);
    // aprovar e remover membros
    expect((await app.inject({ method: "POST", url: "/admin/members", headers: auth(admin), payload: { phone: "5571988887777", groupCode: "12", name: "Novo" } })).statusCode).toBe(200);
    expect((await app.inject({ method: "DELETE", url: "/admin/members/5571988887777", headers: auth(admin) })).statusCode).toBe(200);
    // moderação do chat continua sendo trabalho de admin
    expect((await app.inject({ method: "POST", url: "/admin/chat/global/moderate", headers: auth(admin), payload: { userId: "u".repeat(10), action: "UNMUTE" } })).statusCode).toBe(200);
  });

  it("CREDENCIAIS, TELEFONE do Owner e SUPER: nenhum deles chega ao ADMIN", async () => {
    const admin = await adminToken();
    const fechadas = [
      { method: "GET" as const, url: "/admin/credentials" },
      { method: "POST" as const, url: "/admin/credentials", payload: { password: "trocaSegura1" } },
      { method: "POST" as const, url: "/admin/participants/5571999990001/password", payload: { password: "trocaSegura1",reason:"Tentativa sintética sem privilégio Root" } },
      { method: "POST" as const, url: "/admin/credentials/generate", payload: { ownerId: "qualquer" } },
      { method: "DELETE" as const, url: "/admin/credentials/qualquer" },
      { method: "POST" as const, url: "/admin/owner-phone", payload: { ownerId: "fabio", phone: "5571977770001" } },
      { method: "GET" as const, url: "/admin/super" },
      { method: "POST" as const, url: "/admin/super/grant", payload: { userId: "u".repeat(10) } },
      { method: "POST" as const, url: "/admin/super/revoke", payload: { userId: "u".repeat(10) } },
      { method: "POST" as const, url: "/admin/super/auto-renew", payload: { userId: "u".repeat(10), autoRenew: true } }
    ];
    for (const rota of fechadas) {
      const resposta = await app.inject({ ...rota, headers: auth(admin) });
      expect(resposta.statusCode, `${rota.method} ${rota.url}`).toBe(403);
    }
  });

  it("a credencial do ADMIN é gerada pelo bot, nasce válida e NÃO é a do ROOT", async () => {
    await adminToken();                       // cria o ADMIN_OWNER real
    const root = await rootToken();
    const alvo = db.prepare("SELECT id FROM owner_access WHERE role='ADMIN_OWNER'").get() as { id: string };

    const gerada = await app.inject({ method: "POST", url: "/admin/credentials/generate", headers: auth(root), payload: { ownerId: alvo.id } });
    expect(gerada.statusCode).toBe(200);
    const senha = gerada.json().password as string;
    // Precisa satisfazer as mesmas regras que setCredential exige de um humano.
    expect(senha.length).toBeGreaterThanOrEqual(10);
    expect(senha).toMatch(/[A-Za-z]/);
    expect(senha).toMatch(/[0-9]/);
    expect(verifyCredential(db, alvo.id, senha)).toBe(true);
    expect(credentialState(db, alvo.id)).toMatchObject({ configured: true, mustChange: true });

    // O ROOT define a SUA senha; a do ADMIN não a abre, e vice-versa.
    expect((await app.inject({ method: "POST", url: "/admin/credentials", headers: auth(root), payload: { password: "RaizDoPainel9" } })).statusCode).toBe(200);
    expect(verifyCredential(db, alvo.id, "RaizDoPainel9")).toBe(false);
    expect(verifyCredential(db, "fabio0", senha)).toBe(false);
    // Gerar de novo troca a senha: a anterior deixa de valer.
    const outra = (await app.inject({ method: "POST", url: "/admin/credentials/generate", headers: auth(root), payload: { ownerId: alvo.id } })).json().password as string;
    expect(outra).not.toBe(senha);
  });

  it("o telefone do Owner troca pelo painel e a leitura já mostra o novo", async () => {
    const root = await rootToken();
    const ler = async () => {
      const r = await app.inject({ method: "GET", url: "/admin/credentials", headers: auth(root) });
      expect(r.statusCode).toBe(200);
      return (r.json().owners as Array<{ id: string; phone: string }>).find((o) => o.id === "fabio");
    };
    expect((await ler())?.phone).toBe(normalizePhone("5571999990001"));
    const troca = await app.inject({ method: "POST", url: "/admin/owner-phone", headers: auth(root), payload: { ownerId: "fabio", phone: "5571977770001" } });
    expect(troca.statusCode).toBe(200);
    expect((await ler())?.phone).toBe(normalizePhone("5571977770001"));
  });

  it("carteira e exportação de dados: só ROOT", async () => {
    const admin = await adminToken();
    expect((await app.inject({ method: "GET", url: "/admin/users.csv", headers: auth(admin) })).statusCode).toBe(403);
    expect((await app.inject({ method: "POST", url: "/admin/participants/5571988880002/wallet-adjustment", headers: auth(admin), payload: { amountMillis: 1000, note: "x" } })).statusCode).toBe(403);
    expect((await app.inject({ method: "GET", url: "/admin/owners", headers: auth(admin) })).statusCode).toBe(403);
  });
});
