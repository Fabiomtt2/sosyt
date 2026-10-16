// AUDITORIA / testes das campanhas de avatar (sazonais e de evento).
import Database from "better-sqlite3";
import { beforeEach, describe, expect, it } from "vitest";
import type { AppDatabase } from "./db.js";
import { ensureAvatarCatalog } from "./avatar-tiers.js";
import {
  CAMPAIGN_CATEGORIES, CampaignError, campaignSummary, endCampaign, ensureAvatarCampaign,
  isCampaignCategory, isVisibleToParticipant, listCampaignCatalog, listVisibleCatalog, publishCampaign,
} from "./avatar-campaign.js";

const NOW = new Date("2026-12-10T12:00:00Z");
let db: AppDatabase;

function put(slug: string, category: string, tier = "COMMON") {
  const stamp = "2026-10-01T00:00:00Z";
  db.prepare(`INSERT INTO avatar_catalog (slug,tier,category,label,image,mime,active,sort_order,created_at,updated_at)
    VALUES (?,?,?,?,?, 'image/webp',1,0,?,?)`)
    .run(slug, tier, category, slug, Buffer.from("x"), stamp, stamp);
}

beforeEach(() => {
  db = new Database(":memory:") as AppDatabase;
  ensureAvatarCatalog(db);
  ensureAvatarCampaign(db);
});

describe("padrão: sazonal e evento nascem OCULTOS", () => {
  it("as categorias de campanha são SEASONAL e EVENT", () => {
    expect(CAMPAIGN_CATEGORIES).toEqual(["SEASONAL", "EVENT"]);
    expect(isCampaignCategory("SEASONAL")).toBe(true);
    expect(isCampaignCategory("PEOPLE")).toBe(false);
  });

  it("subir arte sazonal NÃO a publica — o participante não vê", () => {
    put("cat-natal01", "SEASONAL");
    put("cat-evento01", "EVENT");
    put("cat-pessoa01", "PEOPLE");
    const visible = listVisibleCatalog(db, NOW).map((r) => r.slug);
    expect(visible).toEqual(["cat-pessoa01"]);          // só a comum
    expect(isVisibleToParticipant(db, "cat-natal01", NOW)).toBe(false);
  });

  it("o ROOT enxerga tudo, com a marca de quem está no ar", () => {
    put("cat-natal01", "SEASONAL");
    put("cat-pessoa01", "PEOPLE");
    const all = listCampaignCatalog(db, NOW);
    expect(all).toHaveLength(2);
    expect(all.find((r) => r.slug === "cat-natal01")!.live).toBe(false);
    expect(all.find((r) => r.slug === "cat-pessoa01")!.live).toBe(true);
  });
});

describe("publicar campanha por janela de tempo", () => {
  it("publicada dentro da janela, aparece para o participante", () => {
    put("cat-natal01", "SEASONAL");
    publishCampaign(db, ["cat-natal01"], {
      from: "2026-12-01T00:00:00Z", until: "2027-01-05T00:00:00Z", label: "Natal 2026",
    }, NOW);
    expect(isVisibleToParticipant(db, "cat-natal01", NOW)).toBe(true);
    expect(listVisibleCatalog(db, NOW).map((r) => r.slug)).toContain("cat-natal01");
  });

  it("agendada para o futuro ainda NÃO aparece", () => {
    put("cat-carnaval", "SEASONAL");
    publishCampaign(db, ["cat-carnaval"], { from: "2027-02-01T00:00:00Z", label: "Carnaval" }, NOW);
    expect(isVisibleToParticipant(db, "cat-carnaval", NOW)).toBe(false);
    // ...mas o ROOT já vê que está agendada
    expect(listCampaignCatalog(db, NOW).find((r) => r.slug === "cat-carnaval")!.visibleFrom).toBeTruthy();
  });

  it("a janela expira SOZINHA — ninguém precisa lembrar de despublicar", () => {
    put("cat-natal01", "SEASONAL");
    publishCampaign(db, ["cat-natal01"], {
      from: "2026-12-01T00:00:00Z", until: "2027-01-05T00:00:00Z",
    }, NOW);
    const depois = new Date("2027-01-06T00:00:00Z");
    expect(isVisibleToParticipant(db, "cat-natal01", depois)).toBe(false);
    expect(listVisibleCatalog(db, depois).map((r) => r.slug)).not.toContain("cat-natal01");
  });

  it("sem data de fim, fica no ar até o ROOT encerrar", () => {
    put("cat-evento01", "EVENT");
    publishCampaign(db, ["cat-evento01"], { from: "2026-12-01T00:00:00Z" }, NOW);
    expect(isVisibleToParticipant(db, "cat-evento01", new Date("2027-06-01T00:00:00Z"))).toBe(true);
  });

  it("publica um lote de uma vez", () => {
    put("a", "SEASONAL"); put("b", "SEASONAL"); put("c", "EVENT");
    const result = publishCampaign(db, ["a", "b", "c"], { from: "2026-12-01T00:00:00Z", label: "Festas" }, NOW);
    expect(result.updated).toBe(3);
    expect(listVisibleCatalog(db, NOW)).toHaveLength(3);
  });
});

describe("guardas de campanha", () => {
  it("recusa publicar avatar que NÃO é de campanha", () => {
    put("cat-pessoa01", "PEOPLE");
    expect(() => publishCampaign(db, ["cat-pessoa01"], { from: "2026-12-01T00:00:00Z" }, NOW))
      .toThrow(/Sazonais ou de Evento/);
  });

  it("recusa janela invertida", () => {
    put("cat-natal01", "SEASONAL");
    expect(() => publishCampaign(db, ["cat-natal01"], {
      from: "2027-01-05T00:00:00Z", until: "2026-12-01T00:00:00Z",
    }, NOW)).toThrow(/depois do início/);
  });

  it("recusa slug inexistente e lista vazia", () => {
    expect(() => publishCampaign(db, ["nao-existe"], { from: "2026-12-01T00:00:00Z" }, NOW)).toThrow(CampaignError);
    expect(() => publishCampaign(db, [], { from: "2026-12-01T00:00:00Z" }, NOW)).toThrow(/ao menos um/);
  });
});

describe("encerrar campanha", () => {
  it("some da escolha na hora", () => {
    put("cat-natal01", "SEASONAL");
    publishCampaign(db, ["cat-natal01"], { from: "2026-12-01T00:00:00Z" }, NOW);
    expect(isVisibleToParticipant(db, "cat-natal01", NOW)).toBe(true);
    endCampaign(db, ["cat-natal01"], NOW);
    expect(isVisibleToParticipant(db, "cat-natal01", new Date(NOW.getTime() + 1000))).toBe(false);
  });

  it("QUEM JÁ ESCOLHEU CONTINUA COM O AVATAR — a linha do catálogo não é apagada", () => {
    put("cat-natal01", "SEASONAL");
    publishCampaign(db, ["cat-natal01"], { from: "2026-12-01T00:00:00Z" }, NOW);
    endCampaign(db, ["cat-natal01"], NOW);
    // o avatar continua existindo e servível (perfil de quem adotou não quebra)
    const row = db.prepare("SELECT slug,active FROM avatar_catalog WHERE slug=?").get("cat-natal01") as
      { slug: string; active: number };
    expect(row).toMatchObject({ slug: "cat-natal01", active: 1 });
  });
});

describe("tier continua mandando em QUEM pode usar", () => {
  it("campanha controla visibilidade, não permissão", () => {
    put("cat-natal-super", "SEASONAL", "SUPER");
    publishCampaign(db, ["cat-natal-super"], { from: "2026-12-01T00:00:00Z" }, NOW);
    const row = listVisibleCatalog(db, NOW).find((r) => r.slug === "cat-natal-super")!;
    expect(row.live).toBe(true);
    expect(row.tier).toBe("SUPER");   // o gating por tier segue valendo no servidor
  });
});

describe("resumo para o painel do ROOT", () => {
  it("agrupa por campanha e conta no ar x oculto", () => {
    put("a", "SEASONAL"); put("b", "SEASONAL"); put("c", "EVENT");
    publishCampaign(db, ["a", "b"], { from: "2026-12-01T00:00:00Z", label: "Natal 2026" }, NOW);
    const summary = campaignSummary(db, NOW);
    expect(summary.live).toBe(2);
    expect(summary.hidden).toBe(1);                       // o EVENT sem campanha
    expect(summary.campaigns.find((c) => c.label === "Natal 2026")?.total).toBe(2);
  });
});
