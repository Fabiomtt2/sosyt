// AUDITORIA / catálogo de avatares gerenciável pelo painel (gamificação).
//
// Avatar vira DADO, não código: o ROOT_OWNER faz upload da ilustração (gerada
// pela IA), escolhe tier e categoria, e o avatar aparece na escolha sem tocar no
// repositório. Suporta avatares comuns, SUPER (só assinantes ativos), OWNER (só
// donos) e categorias sazonais/evento.
//
// Princípio do projeto: **nunca confiar no cliente**. O webapp esconde os
// bloqueados, mas quem decide é a checagem no servidor, aqui.
import { createHash, randomUUID } from "node:crypto";
import type { AppDatabase } from "./db.js";
import { effectiveSuper } from "./super.js";

export type AvatarTier = "COMMON" | "SUPER" | "OWNER";
export const AVATAR_TIERS: AvatarTier[] = ["COMMON", "SUPER", "OWNER"];
// Categorias: as quatro do ASTRA + sazonais/evento para o futuro.
export const AVATAR_CATEGORIES = ["PEOPLE", "ANIMALS", "CREATURES", "OBJECTS", "SEASONAL", "EVENT"] as const;
export type AvatarCategory = (typeof AVATAR_CATEGORIES)[number];

export type CatalogRow = {
  slug: string; tier: AvatarTier; category: AvatarCategory; label: string;
  active: number; sortOrder: number; createdAt: string;
};

export function ensureAvatarCatalog(db: AppDatabase) {
  db.exec(`CREATE TABLE IF NOT EXISTS avatar_catalog (
    slug TEXT PRIMARY KEY,
    tier TEXT NOT NULL DEFAULT 'COMMON',
    category TEXT NOT NULL DEFAULT 'OBJECTS',
    label TEXT NOT NULL,
    image BLOB NOT NULL,
    mime TEXT NOT NULL DEFAULT 'image/webp',
    active INTEGER NOT NULL DEFAULT 1,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );`);
}

/** O usuário é dono (ROOT ou ADMIN)? Avatar OWNER é exclusivo deles. */
export function isOwnerUser(db: AppDatabase, userId: string): boolean {
  return Boolean(db.prepare("SELECT 1 FROM owner_access WHERE user_id=? AND active=1").get(userId));
}

/**
 * Pode usar um avatar deste tier AGORA?
 * - COMMON: qualquer um.
 * - SUPER: assinante SUPER **ativo** (effectiveSuper deriva do vencimento; ROOT é ilimitado).
 * - OWNER: somente donos.
 */
export function canUseAvatarTier(db: AppDatabase, userId: string, tier: AvatarTier): boolean {
  if (tier === "COMMON") return true;
  if (tier === "OWNER") return isOwnerUser(db, userId);
  return effectiveSuper(db, userId).active || isOwnerUser(db, userId);
}

export function catalogTierOf(db: AppDatabase, slug: string): AvatarTier | undefined {
  const row = db.prepare("SELECT tier FROM avatar_catalog WHERE slug=? AND active=1").get(slug) as { tier: AvatarTier } | undefined;
  return row?.tier;
}

export function listCatalog(db: AppDatabase, opts: { activeOnly?: boolean } = {}): CatalogRow[] {
  const where = opts.activeOnly ? "WHERE active=1" : "";
  return db.prepare(`SELECT slug,tier,category,label,active,sort_order AS sortOrder,created_at AS createdAt
    FROM avatar_catalog ${where} ORDER BY sort_order,created_at`).all() as CatalogRow[];
}

/** Grava/atualiza um avatar do catálogo. A imagem já vem normalizada (WEBP quadrado). */
export function upsertCatalogAvatar(db: AppDatabase, input: {
  slug?: string; tier: AvatarTier; category: AvatarCategory; label: string; imageWebp: Buffer; sortOrder?: number;
}): string {
  const slug = input.slug ?? `cat-${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO avatar_catalog (slug,tier,category,label,image,mime,active,sort_order,created_at,updated_at)
    VALUES (?,?,?,?,?, 'image/webp',1,?,?,?)
    ON CONFLICT(slug) DO UPDATE SET tier=excluded.tier,category=excluded.category,label=excluded.label,
      image=excluded.image,sort_order=excluded.sort_order,updated_at=excluded.updated_at`)
    .run(slug, input.tier, input.category, input.label, input.imageWebp, input.sortOrder ?? 0, now, now);
  return slug;
}

/** Valida bytes WEBP (mesma checagem do avatar CUSTOM) e devolve o Buffer. */
export function decodeWebpDataUrl(dataUrl: string): Buffer | undefined {
  const match = /^data:image\/webp;base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!match) return undefined;
  const bytes = Buffer.from(match[1], "base64");
  const valid = bytes.length >= 12 && bytes.length <= 200_000
    && bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP";
  return valid ? bytes : undefined;
}

export const avatarImageEtag = (image: Buffer) => '"' + createHash("sha256").update(image).digest("hex").slice(0, 32) + '"';
