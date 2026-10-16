// AUDITORIA / importador da biblioteca de avatares — separação por TIER e CATEGORIA.
//
// O Sol entrega o acervo numa árvore de pastas que já carrega a classificação:
//
//     <raiz>/<TIER>/<CATEGORIA>/<nome>.webp
//     ex.:  avatares_para_integracao/SUPER/CREATURES/dragao-cristal.webp
//
// Este módulo varre essa árvore e popula o catálogo, preservando o que o Owner já
// editou. É o "incremento por separação de grupo": a pasta É a fonte da verdade do
// tier e da categoria, então acrescentar arte nova vira copiar arquivo + rodar o
// importador — sem tocar em código.
//
// Contrato validado com o pacote do Sol: WebP quadrado, bytes <= 200.000 (a API
// recusa acima disso), tier em {COMMON,SUPER,OWNER}, categoria entre as seis do
// catálogo. O gating por tier continua sendo decidido NO SERVIDOR (canUseAvatarTier):
// a cor ou o brilho da ilustração não concede privilégio nenhum.
//
// Importante: NÃO importar as prévias circulares PNG nem as miniaturas de 209px —
// o lightbox amplia e ficaria pixelado. Só os masters WebP em tamanho nativo.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import type { AppDatabase } from "./db.js";
import {
  AVATAR_CATEGORIES, AVATAR_TIERS, ensureAvatarCatalog,
  type AvatarCategory, type AvatarTier,
} from "./avatar-tiers.js";

/** Limite da API para o blob do avatar. */
export const AVATAR_MAX_BYTES = 200_000;

export type LibraryCandidate = {
  tier: AvatarTier; category: AvatarCategory; name: string; file: string; bytes: number;
};
export type ImportReport = {
  imported: number; skippedExisting: number;
  rejected: Array<{ file: string; reason: string }>;
  byTier: Record<string, number>;
  byCategory: Record<string, number>;
};

/** Slug determinístico no formato que a validação do app aceita (`cat-<12 hex>`). */
export function librarySlug(tier: string, category: string, name: string): string {
  return "cat-" + createHash("sha256").update(`lib:${tier}:${category}:${name}`).digest("hex").slice(0, 12);
}

/** Nome legível a partir do arquivo: "dragao-cristal.webp" -> "Dragao cristal". */
export function labelFromFileName(file: string): string {
  const base = file.replace(/\.(webp|png|jpg|jpeg)$/i, "").replace(/[-_]+/g, " ").trim();
  return base.charAt(0).toUpperCase() + base.slice(1);
}

const isTier = (value: string): value is AvatarTier => (AVATAR_TIERS as string[]).includes(value);
const isCategory = (value: string): value is AvatarCategory => (AVATAR_CATEGORIES as readonly string[]).includes(value);

function listDirs(path: string): string[] {
  try { return readdirSync(path, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name); }
  catch { return []; }
}

/**
 * Varre `<raiz>/<TIER>/<CATEGORIA>/*.webp`. Tolerante: pasta com nome fora do
 * vocabulário é ignorada (em vez de derrubar a importação inteira), e o motivo
 * aparece no relatório — o Owner precisa saber o que NÃO entrou e por quê.
 */
export function scanLibrary(root: string): { candidates: LibraryCandidate[]; rejected: Array<{ file: string; reason: string }> } {
  const candidates: LibraryCandidate[] = [];
  const rejected: Array<{ file: string; reason: string }> = [];
  for (const tierDir of listDirs(root)) {
    const tier = tierDir.toUpperCase();
    if (!isTier(tier)) { rejected.push({ file: tierDir, reason: `tier desconhecido: ${tierDir}` }); continue; }
    for (const catDir of listDirs(join(root, tierDir))) {
      const category = catDir.toUpperCase();
      if (!isCategory(category)) { rejected.push({ file: `${tierDir}/${catDir}`, reason: `categoria desconhecida: ${catDir}` }); continue; }
      const dir = join(root, tierDir, catDir);
      let entries: string[] = [];
      try { entries = readdirSync(dir); } catch { continue; }
      for (const file of entries) {
        if (!/\.webp$/i.test(file)) {
          if (/\.(png|jpe?g)$/i.test(file)) rejected.push({ file: `${tierDir}/${catDir}/${file}`, reason: "só WebP master é aceito (prévia/miniatura não serve para o lightbox)" });
          continue;
        }
        const full = join(dir, file);
        let bytes = 0;
        try { bytes = statSync(full).size; } catch { continue; }
        if (bytes > AVATAR_MAX_BYTES) { rejected.push({ file: `${tierDir}/${catDir}/${file}`, reason: `acima de ${AVATAR_MAX_BYTES} bytes (${bytes})` }); continue; }
        candidates.push({ tier, category, name: file.replace(/\.webp$/i, ""), file: full, bytes });
      }
    }
  }
  return { candidates, rejected };
}

/** Valida os bytes como WEBP de verdade (mesma checagem do upload do painel). */
function isWebp(bytes: Buffer): boolean {
  return bytes.length >= 12
    && bytes.subarray(0, 4).toString("ascii") === "RIFF"
    && bytes.subarray(8, 12).toString("ascii") === "WEBP";
}

/**
 * Importa a biblioteca para o catálogo. Idempotente e não-destrutivo:
 * INSERT OR IGNORE preserva qualquer avatar que o Owner já tenha editado ou subido.
 */
export function importAvatarLibrary(db: AppDatabase, root: string): ImportReport {
  ensureAvatarCatalog(db);
  const { candidates, rejected } = scanLibrary(root);
  const report: ImportReport = { imported: 0, skippedExisting: 0, rejected: [...rejected], byTier: {}, byCategory: {} };
  const now = new Date().toISOString();
  const insert = db.prepare(`INSERT OR IGNORE INTO avatar_catalog
    (slug,tier,category,label,image,mime,active,sort_order,created_at,updated_at)
    VALUES (?,?,?,?,?, 'image/webp',1,?,?,?)`);

  db.transaction(() => {
    candidates.forEach((item, index) => {
      let image: Buffer;
      try { image = readFileSync(item.file); }
      catch { report.rejected.push({ file: item.file, reason: "não foi possível ler o arquivo" }); return; }
      if (!isWebp(image)) { report.rejected.push({ file: item.file, reason: "não é um WebP válido" }); return; }
      // ordenação: COMMON primeiro, depois SUPER, depois OWNER
      const tierOrder = item.tier === "COMMON" ? 1000 : item.tier === "SUPER" ? 2000 : 3000;
      const changes = insert.run(
        librarySlug(item.tier, item.category, item.name),
        item.tier, item.category, labelFromFileName(item.name + ".webp"),
        image, tierOrder + index, now, now,
      ).changes;
      if (changes) {
        report.imported += 1;
        report.byTier[item.tier] = (report.byTier[item.tier] ?? 0) + 1;
        report.byCategory[item.category] = (report.byCategory[item.category] ?? 0) + 1;
      } else {
        report.skippedExisting += 1;
      }
    });
  })();
  return report;
}
