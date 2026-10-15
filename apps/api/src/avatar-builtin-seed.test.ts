// AUDITORIA / HYBRID+ — testes da coleção embutida de avatares.
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { beforeEach, describe, expect, it } from "vitest";
import type { AppDatabase } from "./db.js";
import { listCatalog } from "./avatar-tiers.js";
import { BUILTIN_AVATARS, builtinSlug, ensureBuiltinAvatars } from "./avatar-builtin-seed.js";

const artFor = (name: string) =>
  fileURLToPath(new URL("../assets/builtin-avatars/builtin-" + name + ".webp", import.meta.url));

let db: AppDatabase;
beforeEach(() => { db = new Database(":memory:") as AppDatabase; });

describe("coleção embutida de avatares", () => {
  it("o pacote tem 40 avatares (36 comuns + 3 SUPER + 1 OWNER)", () => {
    expect(BUILTIN_AVATARS).toHaveLength(40);
    const porTier = (t: string) => BUILTIN_AVATARS.filter((a) => a.tier === t).length;
    expect(porTier("COMMON")).toBe(36);
    expect(porTier("SUPER")).toBe(3);
    expect(porTier("OWNER")).toBe(1);
  });

  it("todo avatar tem a arte no disco (os bytes existem de verdade)", () => {
    for (const a of BUILTIN_AVATARS) {
      expect(existsSync(artFor(a.name)), a.name).toBe(true);
      const bytes = readFileSync(artFor(a.name));
      expect(bytes.subarray(0, 4).toString("ascii"), a.name).toBe("RIFF");       // webp
      expect(bytes.subarray(8, 12).toString("ascii"), a.name).toBe("WEBP");
    }
  });

  it("o slug respeita o formato que a validação do app aceita (cat-<12 hex>)", () => {
    for (const a of BUILTIN_AVATARS) expect(builtinSlug(a.name)).toMatch(/^cat-[0-9a-f]{12}$/);
    // determinístico e sem colisão
    const slugs = BUILTIN_AVATARS.map((a) => builtinSlug(a.name));
    expect(new Set(slugs).size).toBe(slugs.length);
    expect(builtinSlug("curls")).toBe(builtinSlug("curls"));
  });

  it("semeia o catálogo e deixa cada avatar servível com imagem real", () => {
    const { seeded } = ensureBuiltinAvatars(db);
    expect(seeded).toBe(40);
    const catalog = listCatalog(db, { activeOnly: true });
    expect(catalog).toHaveLength(40);
    // a imagem fica no banco, pronta para GET /avatars/:slug
    const sample = db.prepare("SELECT image,mime FROM avatar_catalog WHERE slug=?")
      .get(builtinSlug("owner-lion")) as { image: Buffer; mime: string };
    expect(sample.mime).toBe("image/webp");
    expect(sample.image.length).toBeGreaterThan(1000);
  });

  it("é idempotente — re-semear não duplica", () => {
    ensureBuiltinAvatars(db);
    const segunda = ensureBuiltinAvatars(db);
    expect(segunda.seeded).toBe(0);
    expect(listCatalog(db, { activeOnly: true })).toHaveLength(40);
  });

  it("NÃO sobrescreve um avatar que o Owner já editou no mesmo slug", () => {
    const slug = builtinSlug("curls");
    const now = new Date().toISOString();
    db.exec(`CREATE TABLE IF NOT EXISTS avatar_catalog (
      slug TEXT PRIMARY KEY, tier TEXT, category TEXT, label TEXT, image BLOB, mime TEXT,
      active INTEGER, sort_order INTEGER, created_at TEXT, updated_at TEXT);`);
    db.prepare(`INSERT INTO avatar_catalog (slug,tier,category,label,image,mime,active,sort_order,created_at,updated_at)
      VALUES (?,?,?,?,?, 'image/webp',1,0,?,?)`).run(slug, "COMMON", "PEOPLE", "Editado pelo Owner", Buffer.from("x"), now, now);
    ensureBuiltinAvatars(db);
    const row = db.prepare("SELECT label FROM avatar_catalog WHERE slug=?").get(slug) as { label: string };
    expect(row.label).toBe("Editado pelo Owner");   // preservado
  });

  it("os tiers conferem com a estética: exclusivos são SUPER/OWNER", () => {
    expect(BUILTIN_AVATARS.find((a) => a.name === "owner-lion")?.tier).toBe("OWNER");
    expect(BUILTIN_AVATARS.find((a) => a.name === "super-unicorn")?.tier).toBe("SUPER");
  });
});
