// AUDITORIA / emblemas de nível — arte do Sol/ASTRA, finalmente ligada.
//
// O Sol desenhou 12 emblemas de progressão (broto → coroa) e o ASTRA chegou a
// gerar o atlas, mas a arte nunca foi integrada: o nível aparecia só como número e
// os emblemas antigos continuavam em CSS. Aqui a arte entra de verdade.
//
// A faixa de níveis é mapeada nos 12 degraus, então qualquer nível (inclusive o 30
// que o dono quer como "SUPER") sempre tem um emblema digno. A progressão visual
// acompanha a jornada: broto e muda no começo, louros e cristais no meio, metais e
// coroa no topo.
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

export type LevelEmblem = {
  /** degrau 1..12 */
  tier: number;
  /** nome do arquivo (sem extensão), também usado como slug público */
  slug: string;
  /** rótulo amigável, para o painel e o alt da imagem */
  label: string;
  /** menor nível que alcança este emblema */
  fromLevel: number;
};

/**
 * Os 12 degraus. `fromLevel` cresce de 3 em 3 até o 30 e então segue — assim o nível
 * 30 (o "SUPER" visual que o dono descreveu) cai na coroa.
 */
export const LEVEL_EMBLEMS: readonly LevelEmblem[] = [
  { tier: 1, slug: "level-01-broto", label: "Broto", fromLevel: 1 },
  { tier: 2, slug: "level-02-muda", label: "Muda", fromLevel: 3 },
  { tier: 3, slug: "level-03-louros", label: "Louros", fromLevel: 6 },
  { tier: 4, slug: "level-04-cristal-rosa", label: "Cristal", fromLevel: 9 },
  { tier: 5, slug: "level-05-cristais", label: "Cristais", fromLevel: 12 },
  { tier: 6, slug: "level-06-bronze", label: "Bronze", fromLevel: 15 },
  { tier: 7, slug: "level-07-bronze-louros", label: "Bronze Laureado", fromLevel: 18 },
  { tier: 8, slug: "level-08-prata", label: "Prata", fromLevel: 21 },
  { tier: 9, slug: "level-09-ouro-escudo", label: "Ouro", fromLevel: 24 },
  { tier: 10, slug: "level-10-ouro-estrela", label: "Ouro Estelar", fromLevel: 27 },
  { tier: 11, slug: "level-11-alado", label: "Alado", fromLevel: 30 },
  { tier: 12, slug: "level-12-coroa", label: "Coroa", fromLevel: 40 },
];

/** Emblema do nível informado. Nível 0 ou inválido cai no primeiro degrau. */
export function emblemForLevel(level: number): LevelEmblem {
  const value = Number.isFinite(level) ? Math.max(1, Math.trunc(level)) : 1;
  let chosen = LEVEL_EMBLEMS[0];
  for (const emblem of LEVEL_EMBLEMS) if (value >= emblem.fromLevel) chosen = emblem;
  return chosen;
}

/** Próximo emblema a conquistar (undefined quando já está no topo). */
export function nextEmblem(level: number): LevelEmblem | undefined {
  const current = emblemForLevel(level);
  return LEVEL_EMBLEMS.find((e) => e.tier === current.tier + 1);
}

const emblemsRoot = () => fileURLToPath(new URL("../assets/level-emblems", import.meta.url));

/** Bytes do emblema para servir na rota pública. `undefined` se o arquivo sumiu. */
export function emblemImage(slug: string): Buffer | undefined {
  if (!/^level-\d{2}-[a-z-]+$/.test(slug)) return undefined;   // nunca sai do diretório
  const path = `${emblemsRoot()}/${slug}.webp`;
  return existsSync(path) ? readFileSync(path) : undefined;
}

/** Catálogo para o painel/cliente: degrau, rótulo, nível e URL da imagem. */
export function emblemCatalog(): Array<LevelEmblem & { url: string }> {
  return LEVEL_EMBLEMS.map((e) => ({ ...e, url: `/level-emblems/${e.slug}` }));
}
