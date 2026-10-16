// AUDITORIA / teste da rota do participante concluir a troca de senha (achado B do ASTRA).
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createDatabase, type AppDatabase } from "./db.js";
import { normalizePhone } from "./phone.js";
import { createPasswordReset } from "./password-reset.js";
import { verifyPassword } from "./password.js";

describe("POST /auth/password/reset — participante conclui o reset", () => {
  let db: AppDatabase; let app: Awaited<ReturnType<typeof buildApp>>;
  const phone = "5571993951582";

  beforeEach(async () => {
    db = createDatabase(":memory:");
    app = await buildApp(loadConfig({ REQUIRE_GROUP_MEMBERSHIP: "false", NODE_ENV: "test", DATABASE_PATH: ":memory:", JWT_SECRET: "reset-secret-with-enough-length-ok", AUTH_CODE_PEPPER: "reset-pepper-ok", AUTH_DEV_MODE: "true" }), db);
    const stamp = new Date().toISOString();
    db.prepare("INSERT INTO users (id,name,phone,group_code,created_at,updated_at) VALUES ('u1','Ana',?, '1',?,?)").run(normalizePhone(phone), stamp, stamp);
  });
  afterEach(async () => { await app.close(); db.close(); });

  it("com código válido, redefine a senha e permite login com ela", async () => {
    const { code } = createPasswordReset(db, phone, "SELF");
    const res = await app.inject({ method: "POST", url: "/auth/password/reset", payload: { phone, code, newPassword: "NovaSenhaForte123" } });
    expect(res.statusCode).toBe(200);
    // a senha nova foi gravada (hash confere) e não exige troca
    const row = db.prepare("SELECT password_hash AS hash, must_change AS mustChange FROM user_passwords WHERE user_id='u1'").get() as { hash: string; mustChange: number };
    expect(verifyPassword("NovaSenhaForte123", row.hash)).toBe(true);
    expect(row.mustChange).toBe(0);
  });

  it("código errado é recusado (401) e não muda a senha", async () => {
    createPasswordReset(db, phone, "OWNER", { id: "o", name: "Root" });
    const res = await app.inject({ method: "POST", url: "/auth/password/reset", payload: { phone, code: "000000", newPassword: "QualquerCoisa123" } });
    expect(res.statusCode).toBe(401);
    expect(db.prepare("SELECT 1 FROM user_passwords WHERE user_id='u1'").get()).toBeUndefined();
  });

  it("o código é de uso único (não serve 2x)", async () => {
    const { code } = createPasswordReset(db, phone, "SELF");
    expect((await app.inject({ method: "POST", url: "/auth/password/reset", payload: { phone, code, newPassword: "PrimeiraSenha123" } })).statusCode).toBe(200);
    const again = await app.inject({ method: "POST", url: "/auth/password/reset", payload: { phone, code, newPassword: "SegundaSenha123" } });
    expect(again.statusCode).toBe(404);   // 404 = não há pedido vivo (já consumido)
  });

  it("sem conta ativa para o telefone, responde 404", async () => {
    const { code } = createPasswordReset(db, "5571900000000", "SELF");
    const res = await app.inject({ method: "POST", url: "/auth/password/reset", payload: { phone: "5571900000000", code, newPassword: "SenhaForte123" } });
    expect(res.statusCode).toBe(404);
  });
});
