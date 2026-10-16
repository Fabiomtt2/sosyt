// AUDITORIA / testes do importador da biblioteca de avatares (tier/categoria por pasta).
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AppDatabase } from "./db.js";
import { listCatalog } from "./avatar-tiers.js";
import {
  AVATAR_MAX_BYTES, importAvatarLibrary, labelFromFileName, librarySlug, scanLibrary,
} from "./avatar-library-import.js";

/** WebP mínimo válido (cabeçalho RIFF/WEBP + recheio). */
function webpBytes(padding = 2000): Buffer {
  const head = Buffer.alloc(12);
  head.write("RIFF", 0, "ascii"); head.writeUInt32LE(padding + 4, 4); head.write("WEBP", 8, "ascii");
  return Buffer.concat([head, Buffer.alloc(padding, 7)]);
}

let root: string;
let db: AppDatabase;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "sosyt-avatars-"));
  db = new Database(":memory:") as AppDatabase;
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

function put(tier: string, category: string, file: string, bytes = webpBytes()) {
  mkdirSync(join(root, tier, category), { recursive: true });
  writeFileSync(join(root, tier, category, file), bytes);
}

describe("varredura da biblioteca (a pasta define tier e categoria)", () => {
  it("encontra os WebP nas pastas TIER/CATEGORIA", () => {
    put("COMMON", "PEOPLE", "criadora-cachos.webp");
    put("SUPER", "CREATURES", "dragao-cristal.webp");
    put("OWNER", "ANIMALS", "leao-real.webp");
    const { candidates } = scanLibrary(root);
    expect(candidates).toHaveLength(3);
    expect(candidates.find((c) => c.name === "dragao-cristal")).toMatchObject({ tier: "SUPER", category: "CREATURES" });
  });

  it("aceita nome de pasta em minúscula", () => {
    put("super", "seasonal", "natal.webp");
    expect(scanLibrary(root).candidates[0]).toMatchObject({ tier: "SUPER", category: "SEASONAL" });
  });

  it("REJEITA prévia PNG e miniatura — o lightbox ficaria pixelado", () => {
    put("COMMON", "PEOPLE", "previa.png");
    const { candidates, rejected } = scanLibrary(root);
    expect(candidates).toHaveLength(0);
    expect(rejected[0].reason).toMatch(/WebP master/);
  });

  it("rejeita arquivo acima do limite da API", () => {
    put("COMMON", "OBJECTS", "gigante.webp", webpBytes(AVATAR_MAX_BYTES + 100));
    const { candidates, rejected } = scanLibrary(root);
    expect(candidates).toHaveLength(0);
    expect(rejected[0].reason).toMatch(/acima de/);
  });

  it("pasta com tier/categoria fora do vocabulário é relatada, não derruba o resto", () => {
    put("COMMON", "PEOPLE", "ok.webp");
    mkdirSync(join(root, "LENDARIO", "PEOPLE"), { recursive: true });
    mkdirSync(join(root, "COMMON", "ALIENS"), { recursive: true });
    const { candidates, rejected } = scanLibrary(root);
    expect(candidates).toHaveLength(1);                       // o válido entrou
    expect(rejected.map((r) => r.reason).join(" ")).toMatch(/tier desconhecido/);
    expect(rejected.map((r) => r.reason).join(" ")).toMatch(/categoria desconhecida/);
  });

  it("raiz inexistente não quebra", () => {
    expect(scanLibrary(join(root, "nao-existe"))).toEqual({ candidates: [], rejected: [] });
  });
});

describe("importação para o catálogo", () => {
  it("importa e separa por tier e categoria", () => {
    put("COMMON", "PEOPLE", "ana.webp");
    put("COMMON", "ANIMALS", "gato.webp");
    put("SUPER", "CREATURES", "unicornio.webp");
    put("OWNER", "ANIMALS", "leao.webp");
    const report = importAvatarLibrary(db, root);
    expect(report.imported).toBe(4);
    expect(report.byTier).toEqual({ COMMON: 2, SUPER: 1, OWNER: 1 });
    expect(report.byCategory).toEqual({ PEOPLE: 1, ANIMALS: 2, CREATURES: 1 });
    const catalog = listCatalog(db, { activeOnly: true });
    expect(catalog).toHaveLength(4);
    expect(catalog.find((c) => c.label === "Unicornio")?.tier).toBe("SUPER");
  });

  it("gera slug válido para a regra do app (cat-<12 hex>) e sem colisão", () => {
    put("COMMON", "PEOPLE", "a.webp"); put("SUPER", "PEOPLE", "a.webp");
    importAvatarLibrary(db, root);
    const slugs = listCatalog(db).map((c) => c.slug);
    expect(slugs.every((s) => /^cat-[0-9a-f]{12}$/.test(s))).toBe(true);
    expect(new Set(slugs).size).toBe(slugs.length);   // mesmo nome em tiers != não colide
  });

  it("é idempotente: reimportar não duplica", () => {
    put("COMMON", "PEOPLE", "ana.webp");
    importAvatarLibrary(db, root);
    const again = importAvatarLibrary(db, root);
    expect(again.imported).toBe(0);
    expect(again.skippedExisting).toBe(1);
    expect(listCatalog(db)).toHaveLength(1);
  });

  it("NÃO sobrescreve avatar que o Owner editou no mesmo slug", () => {
    put("SUPER", "CREATURES", "unicornio.webp");
    const slug = librarySlug("SUPER", "CREATURES", "unicornio");
    importAvatarLibrary(db, root);
    db.prepare("UPDATE avatar_catalog SET label='Nome do Owner' WHERE slug=?").run(slug);
    importAvatarLibrary(db, root);
    expect((db.prepare("SELECT label FROM avatar_catalog WHERE slug=?").get(slug) as { label: string }).label)
      .toBe("Nome do Owner");
  });

  it("bytes que não são WebP de verdade são recusados", () => {
    mkdirSync(join(root, "COMMON", "OBJECTS"), { recursive: true });
    writeFileSync(join(root, "COMMON", "OBJECTS", "falso.webp"), Buffer.from("isto nao e webp"));
    const report = importAvatarLibrary(db, root);
    expect(report.imported).toBe(0);
    expect(report.rejected.some((r) => /não é um WebP válido/.test(r.reason))).toBe(true);
  });

  it("a imagem guardada é servível (blob real no catálogo)", () => {
    put("COMMON", "PEOPLE", "ana.webp", webpBytes(5000));
    importAvatarLibrary(db, root);
    const row = db.prepare("SELECT image,mime FROM avatar_catalog LIMIT 1").get() as { image: Buffer; mime: string };
    expect(row.mime).toBe("image/webp");
    expect(row.image.length).toBeGreaterThan(5000);
  });
});

describe("rótulo legível", () => {
  it("converte o nome do arquivo em nome apresentável", () => {
    expect(labelFromFileName("dragao-cristal.webp")).toBe("Dragao cristal");
    expect(labelFromFileName("leao_real.webp")).toBe("Leao real");
  });
});
