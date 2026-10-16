// AUDITORIA / avatares sazonais e de evento — campanha com janela de tempo.
//
// Pedido do dono: as categorias SEASONAL e EVENT ficam visíveis APENAS para o ROOT
// por padrão, e é ele quem decide se entram (e por quanto tempo) na lista que os
// usuários comuns enxergam. Isso vira gamificação: um avatar de Natal que aparece
// em dezembro e some em janeiro tem valor justamente por ser passageiro — quem
// escolheu naquela época carrega a marca da campanha.
//
// Decisões de desenho:
//
//  - O PADRÃO É OCULTO. Subir arte sazonal não a publica. Publicar é ato explícito
//    do ROOT, com data de início e fim. Assim uma remessa de Natal pode ficar pronta
//    em outubro sem vazar na escolha de ninguém.
//  - A JANELA É A VERDADE. Não existe "despublicar na mão e esquecer": passou de
//    `visible_until`, sai da lista sozinho. Menos uma coisa para o dono lembrar.
//  - QUEM JÁ ESCOLHEU, FICA. Se a campanha encerra, o avatar some da ESCOLHA mas
//    continua no perfil de quem o adotou — é exatamente isso que dá valor de troféu.
//    Tirar da pessoa o que ela ganhou seria punir quem participou.
//  - O TIER CONTINUA MANDANDO. Campanha controla VISIBILIDADE; tier controla QUEM
//    PODE USAR. Um sazonal marcado SUPER continua exigindo assinatura ativa.
import type { AppDatabase } from "./db.js";
import type { AvatarCategory, AvatarTier } from "./avatar-tiers.js";

/** Categorias que nascem ocultas e dependem de campanha para aparecer. */
export const CAMPAIGN_CATEGORIES: readonly AvatarCategory[] = ["SEASONAL", "EVENT"];

export const isCampaignCategory = (category: string): boolean =>
  (CAMPAIGN_CATEGORIES as readonly string[]).includes(category);

export class CampaignError extends Error {
  constructor(public readonly code: string, message: string, public readonly statusCode = 400) {
    super(message);
    this.name = "CampaignError";
  }
}

/** Colunas de campanha, aditivas (o catálogo existente continua funcionando). */
export function ensureAvatarCampaign(db: AppDatabase) {
  const columns = db.prepare("PRAGMA table_info(avatar_catalog)").all() as Array<{ name: string }>;
  const has = (name: string) => columns.some((c) => c.name === name);
  if (!columns.length) return;   // catálogo ainda não existe neste banco
  if (!has("visible_from")) db.exec("ALTER TABLE avatar_catalog ADD COLUMN visible_from TEXT");
  if (!has("visible_until")) db.exec("ALTER TABLE avatar_catalog ADD COLUMN visible_until TEXT");
  if (!has("campaign_label")) db.exec("ALTER TABLE avatar_catalog ADD COLUMN campaign_label TEXT");
  db.exec("CREATE INDEX IF NOT EXISTS idx_avatar_catalog_window ON avatar_catalog(category,visible_from,visible_until);");
}

export type CampaignWindow = { from?: string; until?: string; label?: string };

/**
 * Fragmento SQL que decide se uma linha é visível para o PARTICIPANTE agora.
 *
 * Regra: categorias normais aparecem sempre (se ativas). SEASONAL/EVENT só quando
 * houver janela aberta — `visible_from` já começou e `visible_until` ainda não passou.
 * Sem janela definida, a categoria de campanha permanece oculta.
 */
export const VISIBLE_TO_PARTICIPANT_SQL = `
  active=1 AND (
    category NOT IN ('SEASONAL','EVENT')
    OR (
      visible_from IS NOT NULL AND visible_from <= :now
      AND (visible_until IS NULL OR visible_until > :now)
    )
  )`;

/** Um avatar específico está visível para o participante agora? */
export function isVisibleToParticipant(db: AppDatabase, slug: string, at: Date = new Date()): boolean {
  const row = db.prepare(
    `SELECT 1 AS ok FROM avatar_catalog WHERE slug=:slug AND ${VISIBLE_TO_PARTICIPANT_SQL}`,
  ).get({ slug, now: at.toISOString() }) as { ok: number } | undefined;
  return Boolean(row);
}

export type CampaignRow = {
  slug: string; tier: AvatarTier; category: string; label: string; active: number;
  sortOrder: number; visibleFrom?: string; visibleUntil?: string; campaignLabel?: string;
  live: boolean;
};

/**
 * Lista para o PARTICIPANTE: só o que está visível agora. É esta a lista que a
 * tela de escolha consome.
 */
export function listVisibleCatalog(db: AppDatabase, at: Date = new Date()): CampaignRow[] {
  const rows = db.prepare(
    `SELECT slug,tier,category,label,active,sort_order AS sortOrder,
     visible_from AS visibleFrom, visible_until AS visibleUntil, campaign_label AS campaignLabel
     FROM avatar_catalog WHERE ${VISIBLE_TO_PARTICIPANT_SQL} ORDER BY sort_order,created_at`,
  ).all({ now: at.toISOString() }) as Omit<CampaignRow, "live">[];
  return rows.map((r) => ({ ...r, live: true }));
}

/**
 * Lista para o ROOT: tudo, inclusive campanhas agendadas ou encerradas, com a marca
 * de quais estão no ar. É o painel de curadoria.
 */
export function listCampaignCatalog(db: AppDatabase, at: Date = new Date()): CampaignRow[] {
  const now = at.toISOString();
  const rows = db.prepare(
    `SELECT slug,tier,category,label,active,sort_order AS sortOrder,
     visible_from AS visibleFrom, visible_until AS visibleUntil, campaign_label AS campaignLabel
     FROM avatar_catalog ORDER BY category,sort_order,created_at`,
  ).all() as Omit<CampaignRow, "live">[];
  return rows.map((r) => ({
    ...r,
    live: r.active === 1 && (
      !isCampaignCategory(r.category)
      || Boolean(r.visibleFrom && r.visibleFrom <= now && (!r.visibleUntil || r.visibleUntil > now))
    ),
  }));
}

/**
 * Publica (ou reagenda) uma campanha para um conjunto de avatares. Só faz sentido
 * para SEASONAL/EVENT — recusa o resto, para o ROOT não achar que "escondeu" um
 * avatar comum e depois descobrir que ele continua à vista.
 */
export function publishCampaign(
  db: AppDatabase, slugs: string[], window: CampaignWindow, at: Date = new Date(),
): { updated: number } {
  ensureAvatarCampaign(db);
  if (!slugs.length) throw new CampaignError("NO_SLUGS", "Escolha ao menos um avatar da campanha.");
  const from = window.from ?? at.toISOString();
  const until = window.until;
  if (until && Date.parse(until) <= Date.parse(from)) {
    throw new CampaignError("BAD_WINDOW", "O fim da campanha precisa ser depois do início.");
  }
  const rows = db.prepare(
    `SELECT slug,category FROM avatar_catalog WHERE slug IN (${slugs.map(() => "?").join(",")})`,
  ).all(...slugs) as Array<{ slug: string; category: string }>;
  if (rows.length !== slugs.length) {
    throw new CampaignError("UNKNOWN_SLUG", "Algum avatar da lista não existe mais no catálogo.", 404);
  }
  const invalid = rows.filter((r) => !isCampaignCategory(r.category));
  if (invalid.length) {
    throw new CampaignError("NOT_CAMPAIGN_CATEGORY",
      "Campanha vale só para avatares Sazonais ou de Evento. Os demais já ficam sempre visíveis.");
  }
  const update = db.prepare(
    "UPDATE avatar_catalog SET visible_from=?,visible_until=?,campaign_label=?,updated_at=? WHERE slug=?",
  );
  let updated = 0;
  db.transaction(() => {
    for (const slug of slugs) {
      updated += update.run(from, until ?? null, window.label ?? null, at.toISOString(), slug).changes;
    }
  })();
  return { updated };
}

/**
 * Encerra a campanha AGORA: some da escolha, mas quem já adotou continua com o
 * avatar no perfil (é o que transforma a campanha em troféu).
 */
export function endCampaign(db: AppDatabase, slugs: string[], at: Date = new Date()): { updated: number } {
  ensureAvatarCampaign(db);
  if (!slugs.length) throw new CampaignError("NO_SLUGS", "Escolha ao menos um avatar da campanha.");
  const update = db.prepare("UPDATE avatar_catalog SET visible_until=?,updated_at=? WHERE slug=?");
  let updated = 0;
  db.transaction(() => {
    for (const slug of slugs) updated += update.run(at.toISOString(), at.toISOString(), slug).changes;
  })();
  return { updated };
}

/** Resumo por campanha, para o painel do ROOT. */
export function campaignSummary(db: AppDatabase, at: Date = new Date()) {
  const all = listCampaignCatalog(db, at).filter((r) => isCampaignCategory(r.category));
  const byLabel = new Map<string, { label: string; total: number; live: number; from?: string; until?: string }>();
  for (const row of all) {
    const key = row.campaignLabel ?? "(sem campanha)";
    const entry = byLabel.get(key) ?? { label: key, total: 0, live: 0, from: row.visibleFrom, until: row.visibleUntil };
    entry.total += 1;
    if (row.live) entry.live += 1;
    byLabel.set(key, entry);
  }
  return {
    campaigns: [...byLabel.values()].sort((a, b) => a.label.localeCompare(b.label, "pt-BR")),
    hidden: all.filter((r) => !r.live).length,
    live: all.filter((r) => r.live).length,
  };
}
