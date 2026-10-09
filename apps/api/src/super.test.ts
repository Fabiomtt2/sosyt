// AUDITORIA / assinatura SUPER: privilégios derivados da data de expiração,
// revogados sozinhos ao vencer. ROOT tem tudo, ADMIN não.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "./app.js";
import { loadConfig, type Config } from "./config.js";
import { createDatabase, type AppDatabase } from "./db.js";
import { normalizePhone } from "./phone.js";
import { superState, effectiveSuper, grantSuper, revokeSuper, createPin, activePins, pinSlotsFree, SUPER_UPLOADS_PER_ROUND } from "./super.js";
import { itemQuantity, consumeItem, ITEM_SKIP } from "./inventory.js";
import { getActiveStoreProduct } from "./store.js";

describe("assinatura SUPER", () => {
  let db: AppDatabase; let app: Awaited<ReturnType<typeof buildApp>>; let config: Config;
  beforeEach(async () => {
    config = loadConfig({ NODE_ENV: "test", DATABASE_PATH: ":memory:", AUTH_DEV_MODE: "true", REQUIRE_GROUP_MEMBERSHIP: "false",
      JWT_SECRET: "super-secret-32-characters-okay!!", AUTH_CODE_PEPPER: "super-pepper-32-characters-okay!!", YOUTUBE_API_KEY: undefined });
    db = createDatabase(":memory:"); app = await buildApp(config, db);
  });
  afterEach(async () => { await app.close(); db.close(); });
  const auth = (t: string) => ({ authorization: `Bearer ${t}` });
  async function register(phone: string) {
    const normalized = normalizePhone(phone), stamp = new Date().toISOString();
    db.prepare("INSERT OR IGNORE INTO groups(code,enabled,membership_mode) VALUES ('12',1,'OWNER')").run();
    db.prepare("INSERT INTO group_memberships(phone,group_code,approved_at,source) VALUES (?, '12', ?, 'TEST') ON CONFLICT(phone) DO NOTHING").run(normalized, stamp);
    const req = await app.inject({ method: "POST", url: "/auth/request-code", payload: { name: "Pessoa", phone } });
    const ver = await app.inject({ method: "POST", url: "/auth/verify", payload: { phone, code: req.json().devCode } });
    return { token: ver.json().token as string, id: ver.json().user.id as string };
  }
  const makeRoot = (userId: string) => {
    const now = new Date().toISOString();
    db.prepare(`INSERT INTO owner_access (id,user_id,phone,normalized_name,role,active,created_at,updated_at)
      VALUES ('oa-root',?,?,?, 'ROOT_OWNER',1,?,?)`).run(userId, "5571999990001", "fabio", now, now);
  };

  it("produto SUPER_30 custa R$45 e concede 30 dias", () => {
    const p = getActiveStoreProduct(db, "SUPER_30")!;
    expect(p.amountCents).toBe(4500);
    expect(p.subscriptionDays).toBe(30);
  });

  it("sem assinatura não há privilégio", async () => {
    const u = await register("71992000001");
    const s = effectiveSuper(db, u.id);
    expect(s.active).toBe(false);
    expect(s.uploadsPerRound).toBe(1);
    expect(s.canPin).toBe(false);
  });

  it("conceder liga os privilégios; VENCER revoga tudo sozinho", async () => {
    const u = await register("71992000002");
    grantSuper(db, u.id, { days: 30, source: "GIFT" });
    const live = superState(db, u.id);
    expect(live.active).toBe(true);
    expect(live.uploadsPerRound).toBe(SUPER_UPLOADS_PER_ROUND);
    expect(live.secondsRemaining).toBeGreaterThan(29 * 86400);
    // empurra a expiracao para o passado: nenhuma rotina roda, e mesmo assim acaba
    db.prepare("UPDATE super_subscriptions SET expires_at=? WHERE user_id=?").run(new Date(Date.now() - 1000).toISOString(), u.id);
    const dead = superState(db, u.id);
    expect(dead.active).toBe(false);
    expect(dead.uploadsPerRound).toBe(1);
    expect(dead.canPin).toBe(false);
  });

  it("renovar SOMA ao tempo restante em vez de substituir", async () => {
    const u = await register("71992000003");
    const first = grantSuper(db, u.id, { days: 10, source: "PURCHASE", referenceId: "pay-1" });
    const second = grantSuper(db, u.id, { days: 10, source: "PURCHASE", referenceId: "pay-2" });
    expect(second.secondsRemaining).toBeGreaterThan(first.secondsRemaining + 9 * 86400);
    // e o mesmo pagamento reenviado nao estende de novo
    const replay = grantSuper(db, u.id, { days: 10, source: "PURCHASE", referenceId: "pay-2" });
    expect(replay.expiresAt).toBe(second.expiresAt);
  });

  it("revogar derruba privilégios e divulgações na hora", async () => {
    const u = await register("71992000004");
    grantSuper(db, u.id, { days: 30, source: "GIFT" });
    createPin(db, u.id, "Passa lá no meu canal e deixa um like, comentario e view!");
    expect(activePins(db).length).toBe(1);
    revokeSuper(db, u.id, "Fabio");
    expect(superState(db, u.id).active).toBe(false);
    expect(activePins(db).length).toBe(0);
  });

  it("divulgação: só SUPER, uma por pessoa, 3 no sistema, sem link nem venda", async () => {
    const a = await register("71992000005"), b = await register("71992000006"), c = await register("71992000007"), d = await register("71992000008");
    expect(() => createPin(db, a.id, "Vem ver meu canal, deixa o like!")).toThrow(/SUPER/);
    for (const u of [a, b, c, d]) grantSuper(db, u.id, { days: 30, source: "GIFT" });
    expect(() => createPin(db, a.id, "Entra no meu grupo e compre o curso")).toThrow(/sem vendas/i);
    expect(() => createPin(db, a.id, "Meu canal youtube.com/eu, se inscreve")).toThrow(/link|sem vendas/i);
    createPin(db, a.id, "Novo video no ar! Um like e um comentario ajudam demais.");
    expect(() => createPin(db, a.id, "Outra divulgacao minha agora mesmo, por favor")).toThrow(/ja tem uma divulgacao|já tem uma divulgação/i);
    createPin(db, b.id, "Conteudo novo toda terca, deixa sua visualizacao!");
    createPin(db, c.id, "Se curtir, deixa like e comenta no meu video novo!");
    expect(pinSlotsFree(db)).toBe(0);
    expect(() => createPin(db, d.id, "Tambem queria divulgar meu canal aqui agora")).toThrow(/vagas/i);
  });

  it("ROOT tem SUPER e TODOS os itens, ilimitados e sem gastar", async () => {
    const root = await register("71999990001");
    makeRoot(root.id);
    const s = effectiveSuper(db, root.id);
    expect(s.active).toBe(true);
    expect(s.canPin).toBe(true);
    // item que ele nunca comprou — e qualquer item futuro — ja esta disponivel
    expect(itemQuantity(db, root.id, ITEM_SKIP)).toBeGreaterThan(1000);
    expect(itemQuantity(db, root.id, "ITEM_QUE_AINDA_NAO_EXISTE")).toBeGreaterThan(1000);
    consumeItem(db, root.id, ITEM_SKIP);                       // nao gasta
    expect(itemQuantity(db, root.id, ITEM_SKIP)).toBeGreaterThan(1000);
  });

  it("ADMIN_OWNER não ganha SUPER nem itens infinitos", async () => {
    const admin = await register("71992000009");
    const now = new Date().toISOString();
    db.prepare(`INSERT INTO owner_access (id,user_id,phone,normalized_name,role,active,created_at,updated_at)
      VALUES ('oa-adm',?,?,?, 'ADMIN_OWNER',1,?,?)`).run(admin.id, normalizePhone("71992000009"), "pessoa", now, now);
    expect(effectiveSuper(db, admin.id).active).toBe(false);
    expect(itemQuantity(db, admin.id, ITEM_SKIP)).toBe(0);
  });

  it("chat: SUPER envia sem espera; comum espera", async () => {
    const common = await register("71992000010"), sup = await register("71992000011");
    grantSuper(db, sup.id, { days: 30, source: "GIFT" });
    const send = (t: string, body: string) => app.inject({ method: "POST", url: "/chat/global", headers: auth(t), payload: { body } });
    expect((await send(common.token, "primeira do comum")).statusCode).toBe(200);
    expect((await send(common.token, "segunda do comum")).statusCode).toBe(429);
    expect((await send(sup.token, "primeira do super")).statusCode).toBe(200);
    expect((await send(sup.token, "segunda do super, sem esperar")).statusCode).toBe(200);
    const view = await app.inject({ method: "GET", url: "/chat/global", headers: auth(sup.token) });
    expect(view.json().cooldownSeconds).toBe(0);
    expect(view.json().viewerRole).toBe("SUPER");
  });
});
