// AUDITORIA / HYBRID+ F0 — testes do núcleo de automações (render + catálogo).
import { describe, expect, it } from "vitest";
import {
  AUTOMATION_CATALOG,
  AUTOMATION_CATEGORIES,
  AUTOMATION_EVENTS,
  automationMeta,
  automationsByCategory,
  formatXpRanking,
  isAutomationEvent,
  renderTemplate,
  unknownPlaceholders,
  WHATSAPP_TEXT_LIMIT,
} from "./bot-automations.js";

describe("HYBRID+ / render de mensagens", () => {
  it("substitui placeholders conhecidos", () => {
    const out = renderTemplate("Oi {nome}, aba {aba} da fila {fila}.", { nome: "Fábio", aba: 1, fila: 7 });
    expect(out).toBe("Oi Fábio, aba 1 da fila 7.");
  });

  it("mantém placeholders desconhecidos intactos (não some silenciosamente)", () => {
    expect(renderTemplate("Oi {nome}, {inexistente}!", { nome: "Rafael" })).toBe("Oi Rafael, {inexistente}!");
  });

  it("corta no limite de texto do WhatsApp", () => {
    const out = renderTemplate("{x}", { x: "a".repeat(WHATSAPP_TEXT_LIMIT + 500) });
    expect(out.length).toBe(WHATSAPP_TEXT_LIMIT);
  });

  it("escapa nada além da chave — valores com chaves não reentram em loop", () => {
    // Um valor que contém '{nome}' não deve ser re-expandido numa segunda passada.
    expect(renderTemplate("{a}", { a: "{nome}", nome: "X" })).toBe("{nome}");
  });
});

describe("HYBRID+ / catálogo", () => {
  it("todo texto padrão só usa placeholders declarados no próprio evento", () => {
    for (const meta of AUTOMATION_CATALOG) {
      expect(unknownPlaceholders(meta.event, meta.defaultText), `evento ${meta.event}`).toEqual([]);
    }
  });

  it("eventos periódicos declaram intervalo padrão; não-periódicos não precisam", () => {
    for (const meta of AUTOMATION_CATALOG) {
      if (meta.periodic) expect(meta.defaultIntervalMinutes, meta.event).toBeGreaterThan(0);
    }
  });

  it("canais e alvos são válidos", () => {
    for (const meta of AUTOMATION_CATALOG) {
      expect(["OFFICIAL", "EVOLUTION"]).toContain(meta.defaultChannel);
      expect(["MEMBER", "OWNERS", "GROUP", "ALL_GROUPS"]).toContain(meta.defaultTarget);
    }
  });

  it("isAutomationEvent reconhece os eventos do catálogo e rejeita o resto", () => {
    for (const event of AUTOMATION_EVENTS) expect(isAutomationEvent(event)).toBe(true);
    expect(isAutomationEvent("NAO_EXISTE")).toBe(false);
  });

  it("automationMeta lança em evento inexistente", () => {
    // @ts-expect-error — proposital: evento fora do union
    expect(() => automationMeta("NAO_EXISTE")).toThrow();
  });

  it("unknownPlaceholders aponta variável inválida para o evento", () => {
    // UPLOAD_NOTICE não tem {ranking}
    expect(unknownPlaceholders("UPLOAD_NOTICE", "{nome} {ranking}")).toEqual(["ranking"]);
  });

  it("toda automação tem categoria válida e dependências válidas", () => {
    for (const meta of AUTOMATION_CATALOG) {
      expect(AUTOMATION_CATEGORIES, meta.event).toContain(meta.category);
      for (const req of meta.requires ?? []) expect(["GAMIFICATION"], meta.event).toContain(req);
    }
  });

  it("automationsByCategory cobre cada evento exatamente uma vez", () => {
    const grouped = automationsByCategory().flatMap((g) => g.items.map((i) => i.event));
    expect(grouped.sort()).toEqual([...AUTOMATION_EVENTS].sort());
    expect(new Set(grouped).size).toBe(AUTOMATION_EVENTS.length);
  });

  it("o catálogo tem um conjunto rico de automações (experiência completa)", () => {
    expect(AUTOMATION_CATALOG.length).toBeGreaterThanOrEqual(15);
  });
});

describe("HYBRID+ / ranking de XP", () => {
  it("formata com medalhas e posições", () => {
    const out = formatXpRanking([
      { name: "Ana", xp: 320 },
      { name: "Bia", xp: 210 },
      { name: "Caio", xp: 150 },
      { name: "Davi", xp: 90 },
    ]);
    expect(out).toBe("🥇 Ana — 320 XP\n🥈 Bia — 210 XP\n🥉 Caio — 150 XP\n4. Davi — 90 XP");
  });

  it("respeita o limite de posições", () => {
    const entries = Array.from({ length: 20 }, (_, i) => ({ name: `U${i}`, xp: 100 - i }));
    expect(formatXpRanking(entries, 3).split("\n")).toHaveLength(3);
  });

  it("lista vazia vira string vazia", () => {
    expect(formatXpRanking([])).toBe("");
  });
});
