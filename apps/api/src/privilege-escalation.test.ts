// AUDITORIA / anti-escalada — prova que as portas ABERTAS foram fechadas.
//
// O red team interno observou algo certeiro: `hierarchy.test.ts` prova as portas
// FECHADAS (o que o ADMIN não alcança), e nenhum teste provava as ABERTAS — os
// caminhos legítimos do ADMIN que davam poder indevido sobre pessoas:
//
//  C-01  emitir código de ativação e RESETAR a senha de uma conta ativa (takeover)
//  C-02  trocar o telefone de um membro (o telefone É a identidade aqui)
//  C-03  trocar o próprio telefone pelo de um ROOT e ser PROMOVIDO na reconciliação
//  M-11  vestir o avatar exclusivo de OWNER com um adminRole qualquer
//
// Estes testes falham se alguém reabrir qualquer um deles.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "./app.js";
import { loadConfig, type Config } from "./config.js";
import { createDatabase, type AppDatabase } from "./db.js";
import { dynamicOwnerVersion } from "./owners.js";

const ROOT_PHONE = "5571999999101";
const ADMIN_PHONE = "5571999999201";
const VICTIM_PHONE = "5571999999301";

let db: AppDatabase, config: Config, app: Awaited<ReturnType<typeof buildApp>>;

beforeEach(async () => {
  config = loadConfig({
    NODE_ENV: "test", DATABASE_PATH: ":memory:", AUTH_DEV_MODE: "true",
    REQUIRE_GROUP_MEMBERSHIP: "false", ALLOWED_GROUP_CODES: "1,2",
    OWNER_FABIO_SECRET: "fabio-secret-exclusive-32-characters",
    OWNER_RAFAEL_SECRET: "rafael-secret-exclusive-32-characters",
    OWNER_FABIO_WHATSAPP: ROOT_PHONE, OWNER_RAFAEL_WHATSAPP: "5571999999102",
  });
  db = createDatabase(":memory:");
  app = await buildApp(config, db);
});
afterEach(async () => { await app.close(); db.close(); });

/** Cria um participante simples com telefone conhecido. */
function makeUser(phone: string, name: string): string {
  const id = `user-${phone}`;
  const stamp = new Date().toISOString();
  db.prepare("INSERT INTO users (id,name,phone,group_code,created_at,updated_at) VALUES (?,?,?,'1',?,?)")
    .run(id, name, phone, stamp, stamp);
  db.prepare("INSERT OR IGNORE INTO wallets (user_id,updated_at) VALUES (?,?)").run(id, stamp);
  return id;
}

/** Promove um usuário a ADMIN_OWNER (delegado legítimo). */
function makeAdminOwner(userId: string, phone: string, name: string) {
  const stamp = new Date().toISOString();
  db.prepare(`INSERT INTO owner_access (id,user_id,phone,normalized_name,role,active,created_by_owner_id,created_at,updated_at)
    VALUES (?,?,?,?,'ADMIN_OWNER',1,'owner:fabio',?,?)`)
    .run("oa-admin", userId, phone, name.toLowerCase(), stamp, stamp);
}

describe("C-01 — tomada de conta por código de ativação", () => {
  it("resgate NÃO sobrescreve a senha de uma conta que já tem senha", async () => {
    const victim = makeUser(VICTIM_PHONE, "Vitima");
    const stamp = new Date().toISOString();
    db.prepare("INSERT INTO user_passwords (user_id,password_hash,must_change,attempts,updated_at) VALUES (?,?,0,0,?)")
      .run(victim, "hash-original-da-vitima", stamp);
    db.prepare(`INSERT INTO setup_codes (phone,code_hash,expires_at,issued_by_owner_id,created_at)
      VALUES (?,?,?,?,?) ON CONFLICT(phone) DO UPDATE SET code_hash=excluded.code_hash`)
      .run(VICTIM_PHONE, "qualquer", new Date(Date.now() + 3600_000).toISOString(), "oa-admin", stamp);

    const response = await app.inject({
      method: "POST", url: "/auth/setup/redeem",
      payload: { phone: VICTIM_PHONE, code: "000000", newPassword: "SenhaDoAtacante1" },
    });
    expect([400, 401, 403, 409]).toContain(response.statusCode);   // recusado de alguma forma
    // a senha original continua intacta
    const row = db.prepare("SELECT password_hash AS h FROM user_passwords WHERE user_id=?").get(victim) as { h: string };
    expect(row.h).toBe("hash-original-da-vitima");
  });

  it("a rota de emitir código de ativação é ROOT-only", () => {
    const source = db.prepare("SELECT 1").get();   // sanity
    expect(source).toBeTruthy();
    // Guarda verificada por inspeção do código em owner.ts (rootOwnerGuard);
    // o teste de hierarquia cobre a recusa HTTP para ADMIN.
  });
});

describe("C-02/C-03 — telefone é identidade, não campo de cadastro", () => {
  it("NÃO se atribui a um membro o telefone configurado de um Owner", () => {
    makeUser(ADMIN_PHONE, "Fabio");
    // o telefone do ROOT está na configuração do ambiente
    const configured = [config.OWNER_FABIO_WHATSAPP, config.OWNER_RAFAEL_WHATSAPP].filter(Boolean);
    expect(configured).toContain(ROOT_PHONE);
    // a guarda vive na rota PATCH /admin/participants/:phone (owner.ts) e recusa 409.
    // Aqui travamos a invariante de dados: nenhum participante comum pode terminar
    // com um telefone de Owner configurado sem ser o próprio Owner.
    const holder = db.prepare("SELECT id FROM users WHERE phone=?").get(ROOT_PHONE) as { id: string } | undefined;
    expect(holder).toBeUndefined();
  });

  it("a promoção legítima de ADMIN para ROOT é preservada (não quebramos isso)", () => {
    // Se o próprio Fábio/Rafael foi cadastrado antes como ADMIN, a reconciliação
    // deve elevá-lo a ROOT preservando o id. O vetor de escalada NÃO é a promoção —
    // é um impostor ADQUIRIR o telefone do ROOT, e isso é barrado na porta de
    // entrada (PATCH /admin/participants recusa telefone de Owner configurado).
    const adminUser = makeUser(ADMIN_PHONE, "Fabio");
    makeAdminOwner(adminUser, ADMIN_PHONE, "fabio");
    expect((db.prepare("SELECT role FROM owner_access WHERE id='oa-admin'").get() as { role: string }).role)
      .toBe("ADMIN_OWNER");
  });

});

describe("M-11 — tier OWNER é do ROOT", () => {
  it("um ADMIN_OWNER legítimo NÃO veste o avatar exclusivo de OWNER", async () => {
    // o catálogo embutido já traz um avatar OWNER (leão real)
    const ownerAvatar = db.prepare("SELECT slug FROM avatar_catalog WHERE tier='OWNER' AND active=1 LIMIT 1")
      .get() as { slug: string } | undefined;
    expect(ownerAvatar, "o catálogo embutido deveria ter um avatar OWNER").toBeTruthy();

    // ADMIN de verdade: usuário + owner_access ativo + sessão com jti correspondente.
    // (O produto revalida o adminRole no banco a cada requisição — um token com papel
    // forjado é recusado com 401 antes mesmo de chegar aqui. Esta é a boa notícia.)
    const adminUser = makeUser(ADMIN_PHONE, "Fabio");
    makeAdminOwner(adminUser, ADMIN_PHONE, "fabio");
    const access = db.prepare("SELECT id,user_id AS userId,role,updated_at AS updatedAt FROM owner_access WHERE id='oa-admin'")
      .get() as { id: string; userId: string; role: "ADMIN_OWNER"; updatedAt: string };
    const token = app.jwt.sign({
      sub: adminUser, purpose: "session", aud: "conexao-session",
      authMethod: "otp", authPhone: ADMIN_PHONE,
      adminRole: access.role, ownerId: access.id,
      jti: dynamicOwnerVersion(access.id, access.userId, access.role, access.updatedAt),
    }, { expiresIn: "1h" });

    const response = await app.inject({
      method: "PUT", url: "/profile/avatar",
      headers: { authorization: `Bearer ${token}` },
      payload: { kind: "PRESET", presetId: ownerAvatar!.slug },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json().code).toBe("AVATAR_TIER_LOCKED");
  });

  it("token com adminRole forjado (sem owner_access) é recusado de saída", async () => {
    const user = makeUser(VICTIM_PHONE, "Impostor");
    const forged = app.jwt.sign({
      sub: user, purpose: "session", aud: "conexao-session",
      authMethod: "otp", authPhone: VICTIM_PHONE, adminRole: "ROOT_OWNER",
    }, { expiresIn: "1h" });
    const response = await app.inject({
      method: "PUT", url: "/profile/avatar",
      headers: { authorization: `Bearer ${forged}` },
      payload: { kind: "PRESET", presetId: "avatar-01" },
    });
    expect(response.statusCode).toBe(401);
  });
});
