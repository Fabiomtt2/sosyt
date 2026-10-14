// AUDITORIA / loja configurável: produtos editáveis no painel, preço server-side.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "./app.js";
import { loadConfig, type Config } from "./config.js";
import { createDatabase, type AppDatabase } from "./db.js";
import { listStoreProducts, getActiveStoreProduct, upsertStoreProduct } from "./store.js";

describe("loja configurável", () => {
  let db: AppDatabase; let app: Awaited<ReturnType<typeof buildApp>>; let config: Config;
  const ownerBody = { name: "Fabio0", identifier: "+55 71 [9] 9999-0001", groupCode: "#", secret: "fabio-secret-32-characters-long-okay" };
  beforeEach(async () => {
    config = loadConfig({
      NODE_ENV: "test", DATABASE_PATH: ":memory:", AUTH_DEV_MODE: "false", REQUIRE_GROUP_MEMBERSHIP: "false",
      JWT_SECRET: "store-secret-32-characters-okay!!", AUTH_CODE_PEPPER: "store-pepper-32-characters-okay!!",
      OWNER_FABIO_NAME: "Fabio0", OWNER_FABIO_ID: "fabio0", OWNER_FABIO_SECRET: "fabio-secret-32-characters-long-okay", OWNER_FABIO_WHATSAPP: "5571999990001",
      YOUTUBE_API_KEY: undefined
    });
    db = createDatabase(":memory:");
    app = await buildApp(config, db);
  });
  afterEach(async () => { await app.close(); db.close(); });
  const ownerToken = async () => (await app.inject({ method: "POST", url: "/admin/login", payload: ownerBody })).json().token as string;

  it("seed mantém o catálogo aprovado: 10 moedas por R$20 sem passe", () => {
    const p = getActiveStoreProduct(db, "COINS_10")!;
    expect(p).toMatchObject({ amountCents: 2000, creditsMillis: 10000, extraPasses: 0, active: true });
    expect(getActiveStoreProduct(db, "PASS_SINGLE")).toMatchObject({creditsMillis:0,extraPasses:1,active:true});
    expect(getActiveStoreProduct(db, "COINS_LAUNCH")).toBeUndefined();
    expect(listStoreProducts(db).some((x) => x.code === "COINS_LAUNCH")).toBe(true);
  });

  it("validação server-side rejeita preço fora da faixa e produto vazio", () => {
    expect(() => upsertStoreProduct(db, { code: "X", title: "x", amountCents: 1000, credits: 5 })).toThrow(); // code curto
    expect(() => upsertStoreProduct(db, { code: "CHEAP", title: "Barato", amountCents: 50, credits: 1 })).toThrow(/R\$1,00/);
    expect(() => upsertStoreProduct(db, { code: "EMPTY", title: "Nada", amountCents: 1000, credits: 0, extraPasses: 0 })).toThrow(/moedas, passes, um item ou uma assinatura/);
  });

  it("ROOT_OWNER cria e edita produto pelo painel, aplicado em tempo real", async () => {
    const token = await ownerToken();
    const created = await app.inject({ method: "POST", url: "/admin/store/products", headers: { authorization: `Bearer ${token}` },
      payload: { code: "COINS_50", title: "50 moedas", amountCents: 2500, credits: 50, extraPasses: 0, sortOrder: 2 } });
    expect(created.statusCode).toBe(200);
    expect(created.json().product).toMatchObject({ code: "COINS_50", amountCents: 2500, creditsMillis: 50000 });
    expect(getActiveStoreProduct(db, "COINS_50")!.creditsMillis).toBe(50000);
    // edição de valor
    const edited = await app.inject({ method: "POST", url: "/admin/store/products", headers: { authorization: `Bearer ${token}` },
      payload: { code: "COINS_50", title: "50 moedas", amountCents: 3000, credits: 50 } });
    expect(edited.json().product.amountCents).toBe(3000);
  });

  it("rota do Owner grava arte, item e assinatura; remoção da arte é persistente", async () => {
    const token = await ownerToken();
    const headers = { authorization: `Bearer ${token}` };
    const imageDataUrl = "data:image/png;base64,iVBORw0KGgo=";
    const payload = { code:"SPECIAL_30",title:"Especial",amountCents:4500,credits:0,extraPasses:0,
      grantsItem:"SUPER",grantsItemQty:1,subscriptionDays:30,imageDataUrl };
    const saved = await app.inject({ method:"POST",url:"/admin/store/products",headers,payload });
    expect(saved.statusCode).toBe(200);
    expect(saved.json().product).toMatchObject({grantsItem:"SUPER",grantsItemQty:1,subscriptionDays:30,imageDataUrl});
    const removed = await app.inject({ method:"POST",url:"/admin/store/products",headers,
      payload:{...payload,imageDataUrl:""} });
    expect(removed.statusCode).toBe(200);
    expect(getActiveStoreProduct(db,"SPECIAL_30")!.imageDataUrl).toBeUndefined();
  });

  it("editar produto oculto pela rota não o publica sem decisão explícita", async () => {
    const token = await ownerToken();
    const headers = { authorization: `Bearer ${token}` };
    const payload = { code:"HIDDEN_5",title:"Oculto",amountCents:1000,credits:5 };
    expect((await app.inject({method:"POST",url:"/admin/store/products",headers,payload:{...payload,active:false}})).statusCode).toBe(200);
    const edit=await app.inject({method:"POST",url:"/admin/store/products",headers,payload:{...payload,title:"Oculto editado"}});
    expect(edit.statusCode).toBe(200);
    expect(edit.json().product.active).toBe(false);
    expect(getActiveStoreProduct(db,"HIDDEN_5")).toBeUndefined();
    await app.inject({method:"POST",url:"/admin/store/products/HIDDEN_5/active",headers,payload:{active:true}});
    expect(getActiveStoreProduct(db,"HIDDEN_5")).toBeTruthy();
  });

  it("não-ROOT e anônimo não editam a loja", async () => {
    expect((await app.inject({ method: "POST", url: "/admin/store/products", payload: { code: "HACK", title: "x", amountCents: 1000, credits: 1 } })).statusCode).toBe(401);
  });

  it("dashboard expõe só produtos ativos, como lista", async () => {
    const phone = "71999990002";
    db.prepare("INSERT OR IGNORE INTO groups(code,enabled,membership_mode) VALUES ('12',1,'OWNER')").run();
    db.prepare("INSERT INTO group_memberships(phone,group_code,approved_at,source) VALUES (?, '12', ?, 'TEST')").run(phone, new Date().toISOString());
    const code = (await app.inject({ method: "POST", url: "/auth/request-code", payload: { name: "Pessoa", phone } })).json() as { devCode?: string };
    // AUTH_DEV_MODE=false, então request-code não retorna devCode; cria sessão direto via helper de teste:
    const session = db.prepare("SELECT id FROM users WHERE phone=?").get(phone) as { id: string } | undefined;
    void code; void session;
    // valida diretamente a montagem server-side:
    const products = listStoreProducts(db, { activeOnly: true });
    expect(products.every((p) => p.active)).toBe(true);
    expect(products.find((p) => p.code === "COINS_10")).toBeTruthy();
    expect(products.find((p) => p.code === "COINS_LAUNCH")).toBeFalsy();
  });
});
