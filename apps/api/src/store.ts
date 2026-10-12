// AUDITORIA / loja configurável: produtos editáveis pelo painel ROOT_OWNER.
// Antes, o catálogo era estático no código (payments.ts). Agora vive no banco e
// é a fonte de verdade server-side de preço, moedas e passes — o cliente nunca
// dita valor. Métodos de pagamento continuam resolvidos por effectivePaymentConfig.
import type { AppDatabase } from "./db.js";

export type StoreProduct = {
  code: string;
  title: string;
  description: string;
  amountCents: number;
  creditsMillis: number;   // 1000 millis = 1 moeda
  extraPasses: number;
  active: boolean;
  sortOrder: number;
  itemReference: string;
  /** Item de inventario concedido na compra (ex.: SKIP). */
  grantsItem?: string;
  grantsItemQty: number;
  /** Ilustracao enviada pelo painel (data URL). */
  imageDataUrl?: string;
  /** >0 => produto de assinatura: concede SUPER por N dias. */
  subscriptionDays: number;
};

const CODE_RE = /^[A-Z0-9_]{2,40}$/;

export function listStoreProducts(db: AppDatabase, opts: { activeOnly?: boolean } = {}): StoreProduct[] {
  const rows = db.prepare(`SELECT code,title,description,amount_cents AS amountCents,credits_millis AS creditsMillis,
    extra_passes AS extraPasses,active,sort_order AS sortOrder,item_reference AS itemReference,
    grants_item AS grantsItem, COALESCE(grants_item_qty,0) AS grantsItemQty,
    image_data_url AS imageDataUrl, COALESCE(subscription_days,0) AS subscriptionDays
    FROM store_products ${opts.activeOnly ? "WHERE active=1" : ""} ORDER BY sort_order, code`).all() as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    code: String(r.code), title: String(r.title), description: String(r.description),
    amountCents: Number(r.amountCents), creditsMillis: Number(r.creditsMillis), extraPasses: Number(r.extraPasses),
    active: Boolean(r.active), sortOrder: Number(r.sortOrder), itemReference: String(r.itemReference),
    grantsItem: r.grantsItem ? String(r.grantsItem) : undefined, grantsItemQty: Number(r.grantsItemQty ?? 0),
    imageDataUrl: r.imageDataUrl ? String(r.imageDataUrl) : undefined, subscriptionDays: Number(r.subscriptionDays ?? 0)
  }));
}

/** Produto ATIVO por código, para o fluxo de compra. undefined se inexistente ou inativo. */
export function getActiveStoreProduct(db: AppDatabase, code: string): StoreProduct | undefined {
  return listStoreProducts(db, { activeOnly: true }).find((p) => p.code === code);
}

export type StoreProductInput = {
  code: string; title: string; description?: string; amountCents: number;
  credits?: number; creditsMillis?: number; extraPasses?: number; active?: boolean; sortOrder?: number; itemReference?: string;
  grantsItem?: string; grantsItemQty?: number; imageDataUrl?: string; subscriptionDays?: number;
};

export function upsertStoreProduct(db: AppDatabase, input: StoreProductInput): StoreProduct {
  const code = String(input.code).toUpperCase();
  if (!CODE_RE.test(code)) throw Object.assign(new Error("Código do produto inválido (use A-Z, 0-9 e _)."), { statusCode: 400 });
  const amountCents = Math.round(Number(input.amountCents));
  if (!Number.isInteger(amountCents) || amountCents < 100 || amountCents > 500000) throw Object.assign(new Error("Valor deve ficar entre R$1,00 e R$5.000,00."), { statusCode: 400 });
  const creditsMillis = input.creditsMillis != null ? Math.round(Number(input.creditsMillis)) : Math.round(Number(input.credits ?? 0) * 1000);
  if (!Number.isInteger(creditsMillis) || creditsMillis < 0 || creditsMillis > 100_000_000) throw Object.assign(new Error("Quantidade de moedas inválida."), { statusCode: 400 });
  const extraPasses = Math.round(Number(input.extraPasses ?? 0));
  if (!Number.isInteger(extraPasses) || extraPasses < 0 || extraPasses > 1000) throw Object.assign(new Error("Quantidade de passes inválida."), { statusCode: 400 });
  const grantsItem = input.grantsItem ? String(input.grantsItem).toUpperCase() : undefined;
  if (grantsItem && !CODE_RE.test(grantsItem)) throw Object.assign(new Error("Código do item inválido."), { statusCode: 400 });
  const grantsItemQty = Math.max(0, Math.round(Number(input.grantsItemQty ?? (grantsItem ? 1 : 0))));
  const subscriptionDays = Math.max(0, Math.round(Number(input.subscriptionDays ?? 0)));
  // Ilustracao: aceita apenas imagem embutida (data URL) e limita o tamanho.
  const imageDataUrl = typeof input.imageDataUrl === "string" && input.imageDataUrl.trim() ? input.imageDataUrl.trim() : undefined;
  if (imageDataUrl !== undefined) {
    if (!/^data:image\/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(imageDataUrl)) throw Object.assign(new Error("Envie uma imagem PNG, JPG, WEBP ou GIF."), { statusCode: 400 });
    if (imageDataUrl.length > 400_000) throw Object.assign(new Error("A imagem deve ter no máximo ~300 KB."), { statusCode: 400 });
  }
  if (creditsMillis === 0 && extraPasses === 0 && subscriptionDays === 0 && !(grantsItem && grantsItemQty > 0)) throw Object.assign(new Error("O produto precisa conceder moedas, passes, um item ou uma assinatura."), { statusCode: 400 });
  const title = String(input.title ?? "").trim();
  if (title.length < 2 || title.length > 80) throw Object.assign(new Error("Título deve ter entre 2 e 80 caracteres."), { statusCode: 400 });
  const description = String(input.description ?? "").trim().slice(0, 400);
  const existing = db.prepare("SELECT active FROM store_products WHERE code=?").get(code) as { active:number } | undefined;
  const active = input.active === undefined ? (existing ? Boolean(existing.active) : true) : Boolean(input.active);
  const sortOrder = Number.isFinite(Number(input.sortOrder)) ? Math.round(Number(input.sortOrder)) : 100;
  const itemReference = (input.itemReference && /^[a-z0-9-]{2,60}$/.test(input.itemReference)) ? input.itemReference : code.toLowerCase().replace(/_/g, "-");
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO store_products (code,title,description,amount_cents,credits_millis,extra_passes,active,sort_order,item_reference,grants_item,grants_item_qty,image_data_url,subscription_days,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(code) DO UPDATE SET title=excluded.title,description=excluded.description,amount_cents=excluded.amount_cents,
      credits_millis=excluded.credits_millis,extra_passes=excluded.extra_passes,active=excluded.active,
      sort_order=excluded.sort_order,item_reference=excluded.item_reference,
      grants_item=excluded.grants_item,grants_item_qty=excluded.grants_item_qty,
      image_data_url=CASE WHEN ?=1 THEN excluded.image_data_url ELSE store_products.image_data_url END,
      subscription_days=excluded.subscription_days,updated_at=excluded.updated_at`)
    .run(code, title, description, amountCents, creditsMillis, extraPasses, active ? 1 : 0, sortOrder, itemReference, grantsItem ?? null, grantsItemQty, imageDataUrl ?? null, subscriptionDays, now, input.imageDataUrl === undefined ? 0 : 1);
  return getActiveStoreProduct(db, code) ?? listStoreProducts(db).find((p) => p.code === code)!;
}

export function setStoreProductActive(db: AppDatabase, code: string, active: boolean): void {
  db.prepare("UPDATE store_products SET active=?, updated_at=? WHERE code=?").run(active ? 1 : 0, new Date().toISOString(), String(code).toUpperCase());
}
