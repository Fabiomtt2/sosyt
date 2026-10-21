// AUDITORIA / catálogo de avatares: o Owner sobe a ilustração; o tier vale no
// SERVIDOR. Comum não usa SUPER/OWNER; SUPER ativo usa SUPER; Owner usa tudo.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "./app.js";
import { loadConfig, type Config } from "./config.js";
import { createDatabase, type AppDatabase } from "./db.js";
import { normalizePhone } from "./phone.js";
import { grantSuper } from "./super.js";

// WEBP mínimo válido (RIFF....WEBP + resto) só para passar a validação de bytes.
const WEBP = "data:image/webp;base64," + Buffer.concat([
  Buffer.from("RIFF"), Buffer.from([16, 0, 0, 0]), Buffer.from("WEBP"), Buffer.from("VP8 tiny-pixels")
]).toString("base64");
const ROOT_SECRET = "fabio-secret-32-characters-long-okay";

describe("catálogo de avatares", () => {
  let db: AppDatabase; let app: Awaited<ReturnType<typeof buildApp>>; let config: Config;
  beforeEach(async () => {
    config = loadConfig({ NODE_ENV: "test", DATABASE_PATH: ":memory:", AUTH_DEV_MODE: "true", REQUIRE_GROUP_MEMBERSHIP: "false",
      JWT_SECRET: "catalog-secret-32-characters-ok!!", AUTH_CODE_PEPPER: "catalog-pepper-32-characters-ok!!", YOUTUBE_API_KEY: undefined,
      OWNER_FABIO_NAME: "Fabio", OWNER_FABIO_ID: "fabio", OWNER_FABIO_SECRET: ROOT_SECRET, OWNER_FABIO_WHATSAPP: "5571999990001" });
    db = createDatabase(":memory:"); app = await buildApp(config, db);
  });
  afterEach(async () => { await app.close(); db.close(); });

  const auth = (t: string) => ({ authorization: `Bearer ${t}` });
  async function rootToken() {
    const r = await app.inject({ method: "POST", url: "/admin/login", payload: { name: "Fabio", phone: "5571999990001", groupCode: "#", secret: ROOT_SECRET } });
    expect(r.statusCode).toBe(200);
    return r.json().token as string;
  }
  async function register(phone: string) {
    const normalized = normalizePhone(phone), stamp = new Date().toISOString();
    db.prepare("INSERT OR IGNORE INTO groups(code,enabled,membership_mode) VALUES ('12',1,'OWNER')").run();
    db.prepare("INSERT INTO group_memberships(phone,group_code,approved_at,source) VALUES (?, '12', ?, 'TEST') ON CONFLICT(phone) DO NOTHING").run(normalized, stamp);
    const req = await app.inject({ method: "POST", url: "/auth/request-code", payload: { name: "Pessoa", phone } });
    const ver = await app.inject({ method: "POST", url: "/auth/verify", payload: { phone, code: req.json().devCode } });
    return { token: ver.json().token as string, id: ver.json().user.id as string };
  }
  const makeOwner = (userId: string) => {
    const now = new Date().toISOString();
    db.prepare(`INSERT INTO owner_access (id,user_id,phone,normalized_name,role,active,created_at,updated_at)
      VALUES ('oa',?,?,?, 'ROOT_OWNER',1,?,?)`).run(userId, normalizePhone("5571999990002"), "root", now, now);
  };
  const upload = (token: string, tier: string, category: string, label: string) =>
    app.inject({ method: "POST", url: "/admin/avatars", headers: auth(token), payload: { tier, category, label, dataUrl: WEBP } });
  const setAvatar = (token: string, slug: string) =>
    app.inject({ method: "PUT", url: "/profile/avatar", headers: auth(token), payload: { kind: "PRESET", presetId: slug } });

  it("só o Owner sobe avatar; o comum é barrado", async () => {
    const root = await rootToken();
    const common = await register("71994000002");
    expect((await upload(common.token, "SUPER", "CREATURES", "Fênix")).statusCode).not.toBe(200);
    const ok = await upload(root, "SUPER", "CREATURES", "Fênix");
    expect(ok.statusCode).toBe(200);
    expect(ok.json().slug).toMatch(/^cat-[a-z0-9]{12}$/);
  });

  it("gating por tier: comum NÃO usa SUPER; SUPER ativo usa; Owner usa tudo", async () => {
    const root = await rootToken();
    const superSlug = (await upload(root, "SUPER", "CREATURES", "Raposa")).json().slug;
    const ownerSlug = (await upload(root, "OWNER", "ANIMALS", "Leão")).json().slug;

    const common = await register("71994000004");
    expect((await setAvatar(common.token, superSlug)).statusCode).toBe(403);
    expect((await setAvatar(common.token, ownerSlug)).statusCode).toBe(403);
    const list = (await app.inject({ method: "GET", url: "/avatars", headers: auth(common.token) })).json().avatars as Array<{ slug: string; locked: boolean }>;
    expect(list.find((a) => a.slug === superSlug)?.locked).toBe(true);
    expect(list.some(a=>a.slug===ownerSlug)).toBe(false);

    const sup = await register("71994000005"); grantSuper(db, sup.id, { days: 30, source: "GIFT" });
    expect((await setAvatar(sup.token, superSlug)).statusCode).toBe(200);
    expect((await setAvatar(sup.token, ownerSlug)).statusCode).toBe(403);

    const ownerUser = await register("71994000009"); makeOwner(ownerUser.id);
    expect((await setAvatar(ownerUser.token, ownerSlug)).statusCode).toBe(200);
    expect((await setAvatar(ownerUser.token, superSlug)).statusCode).toBe(200);
  });

  it("SUPER só enquanto ativo: ao vencer, perde o direito", async () => {
    const root = await rootToken();
    const superSlug = (await upload(root, "SUPER", "OBJECTS", "Estrela")).json().slug;
    const sup = await register("71994000007"); grantSuper(db, sup.id, { days: 30, source: "GIFT" });
    expect((await setAvatar(sup.token, superSlug)).statusCode).toBe(200);
    db.prepare("UPDATE super_subscriptions SET expires_at=? WHERE user_id=?").run(new Date(Date.now() - 1000).toISOString(), sup.id);
    expect((await setAvatar(sup.token, superSlug)).statusCode).toBe(403);
  });

  it("serve a imagem do avatar com ETag e 304", async () => {
    const root = await rootToken();
    const slug = (await upload(root, "COMMON", "OBJECTS", "Lua")).json().slug;
    const img = await app.inject({ method: "GET", url: `/avatars/${slug}` });
    expect(img.statusCode).toBe(200);
    expect(img.headers["content-type"]).toContain("image/webp");
    expect(img.headers.etag).toBeTruthy();
    const notModified = await app.inject({ method: "GET", url: `/avatars/${slug}`, headers: { "if-none-match": String(img.headers.etag) } });
    expect(notModified.statusCode).toBe(304);
  });
});
