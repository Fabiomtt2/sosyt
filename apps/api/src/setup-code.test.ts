// AUDITORIA C-01 / portão híbrido: resgate de credencial de setup SEM WhatsApp.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { buildApp } from "./app.js";
import { loadConfig, type Config } from "./config.js";
import { createDatabase, type AppDatabase } from "./db.js";
import { normalizePhone } from "./phone.js";

describe("portão híbrido: credencial de setup emitida pelo Owner (sem WhatsApp)", () => {
  let db: AppDatabase; let app: Awaited<ReturnType<typeof buildApp>>; let config: Config;
  const ownerBody = { name: "Fabio0", identifier: "+55 71 [9] 9999-0001", groupCode: "#", secret: "fabio-secret-32-characters-long-okay" };
  beforeEach(async () => {
    config = loadConfig({
      NODE_ENV: "test", DATABASE_PATH: ":memory:", AUTH_DEV_MODE: "false", PAYMENTS_DEV_MODE: "false",
      REQUIRE_GROUP_MEMBERSHIP: "true", JWT_SECRET: "setup-code-secret-32-characters!!", AUTH_CODE_PEPPER: "setup-code-pepper-32-characters!!",
      OWNER_FABIO_NAME: "Fabio0", OWNER_FABIO_ID: "fabio0", OWNER_FABIO_SECRET: "fabio-secret-32-characters-long-okay", OWNER_FABIO_WHATSAPP: "5571999990001",
      YOUTUBE_API_KEY: undefined
    });
    db = createDatabase(":memory:");
    app = await buildApp(config, db);
  });
  afterEach(async () => { await app.close(); db.close(); });

  async function ownerToken() {
    const login = await app.inject({ method: "POST", url: "/admin/login", payload: ownerBody });
    expect(login.statusCode).toBe(200);
    return login.json().token as string;
  }
  function approve(phone: string, group = "7") {
    const normalized = normalizePhone(phone), stamp = new Date().toISOString();
    db.prepare("INSERT OR IGNORE INTO groups(code,enabled,membership_mode) VALUES (?,1,'OWNER')").run(group);
    db.prepare("INSERT INTO group_memberships(phone,group_code,approved_at,source) VALUES (?,?,?,'OWNER') ON CONFLICT(phone) DO UPDATE SET group_code=excluded.group_code,approved_at=excluded.approved_at,revoked_at=NULL").run(normalized, group, stamp);
  }

  it("fluxo completo: Owner emite, participante resgata e cria senha, SEM WhatsApp configurado", async () => {
    const phone = "71988887777"; approve(phone, "7");
    const token = await ownerToken();
    const issued = await app.inject({ method: "POST", url: `/admin/participants/${encodeURIComponent(phone)}/setup-code`, headers: { authorization: `Bearer ${token}` } });
    expect(issued.statusCode).toBe(200);
    const code = issued.json().setupCode as string;
    expect(code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    expect(issued.json().deliver.whatsappUrl).toContain("wa.me/");

    const redeem = await app.inject({ method: "POST", url: "/auth/setup/redeem", payload: { phone, code, newPassword: "minhaSenhaForte123" } });
    expect(redeem.statusCode).toBe(200);
    expect(redeem.json().token).toBeTruthy();

    // a senha criada funciona no login subsequente, tambem sem WhatsApp
    const login = await app.inject({ method: "POST", url: "/auth/password/login", payload: { phone, password: "minhaSenhaForte123", groupCode: "7" } });
    expect(login.statusCode).toBe(200);
    expect(login.json().user.phone).toBe(normalizePhone(phone));
  });

  it("código é de uso único: segundo resgate falha", async () => {
    const phone = "71988886666"; approve(phone, "7");
    const token = await ownerToken();
    const code = (await app.inject({ method: "POST", url: `/admin/participants/${encodeURIComponent(phone)}/setup-code`, headers: { authorization: `Bearer ${token}` } })).json().setupCode as string;
    expect((await app.inject({ method: "POST", url: "/auth/setup/redeem", payload: { phone, code, newPassword: "senhaUmProimeira9" } })).statusCode).toBe(200);
    const second = await app.inject({ method: "POST", url: "/auth/setup/redeem", payload: { phone, code, newPassword: "outraSenha12345" } });
    expect(second.statusCode).toBe(401);
  });

  it("código errado não autentica e conta tentativa", async () => {
    const phone = "71988885555"; approve(phone, "7");
    const token = await ownerToken();
    await app.inject({ method: "POST", url: `/admin/participants/${encodeURIComponent(phone)}/setup-code`, headers: { authorization: `Bearer ${token}` } });
    const bad = await app.inject({ method: "POST", url: "/auth/setup/redeem", payload: { phone, code: "ZZZZ-ZZZZ-ZZZZ", newPassword: "senhaQualquer123" } });
    expect(bad.statusCode).toBe(401);
  });

  it("Owner não emite código para número sem aprovação de grupo", async () => {
    const phone = "71988884444"; // sem approve()
    const token = await ownerToken();
    const issued = await app.inject({ method: "POST", url: `/admin/participants/${encodeURIComponent(phone)}/setup-code`, headers: { authorization: `Bearer ${token}` } });
    expect(issued.statusCode).toBe(409);
  });

  it("revogar o grupo invalida o código mesmo correto", async () => {
    const phone = "71988883333"; approve(phone, "7");
    const token = await ownerToken();
    const code = (await app.inject({ method: "POST", url: `/admin/participants/${encodeURIComponent(phone)}/setup-code`, headers: { authorization: `Bearer ${token}` } })).json().setupCode as string;
    db.prepare("UPDATE group_memberships SET revoked_at=? WHERE phone=?").run(new Date().toISOString(), normalizePhone(phone));
    const redeem = await app.inject({ method: "POST", url: "/auth/setup/redeem", payload: { phone, code, newPassword: "senhaValida1234" } });
    expect(redeem.statusCode).toBe(403);
  });
});
