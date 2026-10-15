// AUDITORIA / progressão visual por nível.
//
// A especificação do dono é explícita: o rótulo "Nível N" começa na cor padrão do
// texto e ganha destaque a cada faixa, até o nível 30 alcançar o patamar visual de
// SUPER/OWNER — privilégio puramente visual, sem nenhum poder funcional.
//
// O emblema já mudava de cor por faixa; o TEXTO não. Estes testes travam as duas
// coisas, para que uma limpeza de CSS futura não desfaça a progressão em silêncio.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const css = readFileSync(fileURLToPath(new URL("./gamification.css", import.meta.url)), "utf8");

/** As cinco faixas, da base ao topo — mesma ordem de `tiers` em GamificationPanel. */
const TIERS = ["beginning", "connection", "creator", "crown", "constellation"] as const;

function ruleFor(selector: string): string | undefined {
  const match = new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{([^}]*)\\}`).exec(css);
  return match?.[1];
}

describe("progressão visual de nível", () => {
  it("toda faixa tem cor própria no emblema", () => {
    for (const tier of TIERS) {
      const rule = ruleFor(`.journey-tier-${tier} .journey-level-emblem`);
      expect(rule, `faixa ${tier} sem estilo de emblema`).toBeTruthy();
      expect(rule, `faixa ${tier} sem cor`).toMatch(/color|background/);
    }
  });

  it("toda faixa define a cor do TEXTO do rótulo", () => {
    for (const tier of TIERS) {
      const rule = ruleFor(`.journey-tier-${tier} .journey-level-label`);
      expect(rule, `faixa ${tier} sem cor de texto`).toBeTruthy();
      expect(rule, `faixa ${tier} sem propriedade color`).toMatch(/color/);
    }
  });

  it("o nível 1 usa a cor padrão do texto, como o dono pediu", () => {
    expect(ruleFor(".journey-tier-beginning .journey-level-label")).toMatch(/color\s*:\s*inherit/);
  });

  it("as faixas acima da primeira NÃO usam a cor padrão (há progressão real)", () => {
    for (const tier of TIERS.slice(1)) {
      expect(ruleFor(`.journey-tier-${tier} .journey-level-label`), tier).not.toMatch(/color\s*:\s*inherit/);
    }
  });

  it("cada faixa tem cor distinta — progressão, não repetição", () => {
    const cores = TIERS.slice(1).map((tier) => /color\s*:\s*(#[0-9a-f]{3,8})/i.exec(ruleFor(`.journey-tier-${tier} .journey-level-label`) ?? "")?.[1]);
    expect(cores.every(Boolean), "alguma faixa sem cor hexadecimal").toBe(true);
    expect(new Set(cores).size, "faixas repetem a mesma cor").toBe(cores.length);
  });

  it("o topo (nível 30) alcança destaque equivalente a SUPER/OWNER", () => {
    const topo = ruleFor(".journey-tier-constellation .journey-level-label b");
    expect(topo).toBeTruthy();
    // gradiente aplicado ao texto é o tratamento mais forte da escala
    expect(topo).toMatch(/background(-clip)?/);
  });

  it("o destaque do nível 30 no chat e no correio continua existindo", () => {
    const premium = readFileSync(fileURLToPath(new URL("./premium.css", import.meta.url)), "utf8");
    expect(premium).toMatch(/\.gc-level-accent/);
    expect(premium).toMatch(/\.message-level30/);
  });

  it("a progressão é só visual: nenhuma regra concede poder funcional", () => {
    // Guarda de conceito: se alguém esconder/mostrar controle por faixa, aparece aqui.
    for (const tier of TIERS) {
      const rule = ruleFor(`.journey-tier-${tier} .journey-level-label`) ?? "";
      expect(rule, `faixa ${tier} mexendo em exibição`).not.toMatch(/display\s*:\s*none|visibility\s*:\s*hidden|pointer-events/);
    }
  });
});
