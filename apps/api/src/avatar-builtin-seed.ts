// AUDITORIA / HYBRID+ — catálogo embutido de avatares (arte do Sol/ASTRA).
//
// O Sol gerou dois atlas ilustrados (comuns 6×6, exclusivos 2×2) e desenhou todo o
// mapeamento — slug, tier, categoria, nome — em `avatar-builtin.ts`, mas a camada
// não chegou a ser ligada: o catálogo em produção nascia VAZIO. Aqui eu trago o
// design dele e sirvo cada avatar como imagem individual já recortada (em
// `assets/builtin-avatars/`), reusando a infraestrutura de catálogo que já está no
// ar (GET /avatars/:slug + o seletor com gating por tier). Mérito da arte: Sol/ASTRA.
//
// Decisões:
//  - slug no formato `cat-<12 hex>` (o único que a validação atual aceita), DERIVADO
//    do nome — determinístico, então re-semear é idempotente.
//  - INSERT OR IGNORE: nunca sobrescreve um avatar que o Owner editou ou subiu.
//  - COMMON para todos; SUPER só para assinantes ativos; OWNER só para donos — o
//    gating já é garantido no servidor por `canUseAvatarTier`.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import type { AppDatabase } from "./db.js";
import { ensureAvatarCatalog, type AvatarCategory, type AvatarTier } from "./avatar-tiers.js";

type BuiltinAvatar = { name: string; tier: AvatarTier; category: AvatarCategory; label: string; sortOrder: number };

// 36 comuns (atlas 6×6) — ordem = índice no atlas. Categorias e nomes do Sol/ASTRA.
const COMMON: Array<[string, AvatarCategory, string]> = [
  ["curls", "PEOPLE", "Criadora de cachos"], ["glasses", "PEOPLE", "Criador de óculos"],
  ["headphones", "PEOPLE", "Criadora musical"], ["silver-curls", "PEOPLE", "Inspiração prateada"],
  ["beanie", "PEOPLE", "Criador de gorro"], ["violet-hair", "PEOPLE", "Expressão violeta"],
  ["podcaster", "PEOPLE", "Voz da comunidade"], ["braid", "PEOPLE", "Criadora de trança"],
  ["storyteller", "PEOPLE", "Contador de histórias"], ["freckles", "PEOPLE", "Criadora de sardas"],
  ["teal-glasses", "PEOPLE", "Olhar criativo"], ["hoodie", "PEOPLE", "Criador de ideias"],
  ["puppy", "ANIMALS", "Cachorrinho caramelo"], ["parakeet", "ANIMALS", "Periquito alegre"],
  ["capybara", "ANIMALS", "Capivara tranquila"], ["rabbit", "ANIMALS", "Coelhinho curioso"],
  ["sloth", "ANIMALS", "Preguiça acolhedora"], ["otter", "ANIMALS", "Lontra sorridente"],
  ["red-panda", "ANIMALS", "Panda-vermelho"], ["owl", "ANIMALS", "Corujinha atenta"],
  ["whale", "ANIMALS", "Baleia gentil"], ["turtle", "ANIMALS", "Tartaruga companheira"],
  ["penguin", "ANIMALS", "Pinguim contente"], ["hedgehog", "ANIMALS", "Ouriço fofinho"],
  ["mint-dragon", "CREATURES", "Dragão de menta"], ["cloud", "CREATURES", "Nuvem de ideias"],
  ["star", "CREATURES", "Estrela de pêssego"], ["mushroom", "CREATURES", "Amigo da floresta"],
  ["robot", "CREATURES", "Robô criativo"], ["moon", "CREATURES", "Lua sorridente"],
  ["camera", "OBJECTS", "Câmera de histórias"], ["microphone", "OBJECTS", "Microfone lilás"],
  ["music", "OBJECTS", "Nota musical"], ["plant", "OBJECTS", "Brotinho criativo"],
  ["book", "OBJECTS", "Livro de descobertas"], ["planet", "OBJECTS", "Pequeno universo"],
];

// 4 exclusivos (atlas 2×2) — SUPER e OWNER, com a estética neon/galáxia e dourada.
const EXCLUSIVE: BuiltinAvatar[] = [
  { name: "super-cat", tier: "SUPER", category: "ANIMALS", label: "Gatinho galáxia", sortOrder: 200 },
  { name: "super-fox", tier: "SUPER", category: "ANIMALS", label: "Raposa galáxia", sortOrder: 201 },
  { name: "super-unicorn", tier: "SUPER", category: "CREATURES", label: "Unicórnio arco-íris", sortOrder: 202 },
  { name: "owner-lion", tier: "OWNER", category: "ANIMALS", label: "Leão real", sortOrder: 300 },
];

export const BUILTIN_AVATARS: readonly BuiltinAvatar[] = [
  ...COMMON.map(([name, category, label], index) => ({
    name, tier: "COMMON" as const, category, label, sortOrder: 100 + index,
  })),
  ...EXCLUSIVE,
];

/** Slug determinístico no formato aceito pela validação (`cat-<12 hex>`). */
export function builtinSlug(name: string): string {
  return "cat-" + createHash("sha256").update("builtin-" + name).digest("hex").slice(0, 12);
}

/**
 * Popula o catálogo com a coleção embutida. Idempotente e não-destrutivo:
 * INSERT OR IGNORE garante que uma edição do Owner no mesmo slug seja preservada.
 * Arquivo de imagem ausente é ignorado (não derruba o boot).
 */
export function ensureBuiltinAvatars(db: AppDatabase): { seeded: number } {
  ensureAvatarCatalog(db);
  const now = new Date().toISOString();
  const insert = db.prepare(`INSERT OR IGNORE INTO avatar_catalog
    (slug,tier,category,label,image,mime,active,sort_order,created_at,updated_at)
    VALUES (?,?,?,?,?, 'image/webp',1,?,?,?)`);
  let seeded = 0;
  db.transaction(() => {
    for (const avatar of BUILTIN_AVATARS) {
      let image: Buffer;
      try {
        image = readFileSync(fileURLToPath(new URL("../assets/builtin-avatars/builtin-" + avatar.name + ".webp", import.meta.url)));
      } catch {
        continue; // arte ausente neste ambiente — segue sem quebrar
      }
      seeded += insert.run(builtinSlug(avatar.name), avatar.tier, avatar.category, avatar.label, image, avatar.sortOrder, now, now).changes;
    }
  })();
  return { seeded };
}
