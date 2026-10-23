// AUDITORIA / a queixa do dono: "o bot envia a mesma mensagem padrão ... não há variação".
import { beforeEach, describe, expect, it } from "vitest";
import { createDatabase, type AppDatabase } from "./db.js";
import { variedInboundReply, menuVariantCount } from "./bot-menu-variants.js";
import { replyFor } from "./bot-inbound.js";

describe("menu do bot: varia o acolhimento, preserva o contrato", () => {
  let db: AppDatabase;
  beforeEach(() => { db = createDatabase(":memory:"); });

  it("nao repete a saudacao em sequencia (era UMA string fixa)", () => {
    // O motor de nao-repeticao garante: nenhuma repeticao dentro de uma janela de
    // ceil(poco * 0.6) escolhas recentes. Com 10 aberturas, a janela e 6. Entao a
    // promessa honesta nao e "10 distintas em 10" — e "nenhuma se repete entre seis
    // seguidas", que e exatamente o que a pessoa percebe como "nao se repete".
    const aberturas = Array.from({ length: 24 }, () => variedInboundReply(db, "GREETING")!.split("\n")[0]!);
    for (let i = 0; i + 6 <= aberturas.length; i++) {
      const janela = aberturas.slice(i, i + 6);
      expect(new Set(janela).size, `repetiu dentro da janela ${i}: ${JSON.stringify(janela)}`).toBe(6);
    }
    // e, ao longo do tempo, o poco inteiro circula (nao ficam duas ou tres favoritas)
    expect(new Set(aberturas).size).toBeGreaterThanOrEqual(8);
  });

  it("as opcoes 1..5 e o atalho humano estao em TODA variante", () => {
    for (const intent of ["GREETING", "HELP", "UNKNOWN"]) {
      for (let i = 0; i < 12; i++) {
        const texto = variedInboundReply(db, intent)!;
        expect(texto, intent).toContain("1. ENTRAR");
        expect(texto, intent).toContain("3. SENHA");
        expect(texto, intent).toContain("5. MOEDAS");
        expect(texto, intent).toContain("Tenho dúvidas");
      }
    }
  });

  it("o 'nao entendi' assume que nao entendeu, sem fingir", () => {
    const textos = Array.from({ length: 7 }, () => variedInboundReply(db, "UNKNOWN")!);
    for (const texto of textos) expect(texto.toLowerCase()).toMatch(/não entendi|não captei|não consegui|não ficou claro|me pegou/);
  });

  it("intencao sem poco devolve undefined para o fluxo cair na resposta unica", () => {
    for (const intent of ["OPT_OUT", "OPT_IN", "STATUS", "HUMAN", "QUEUE_INFO"]) {
      expect(variedInboundReply(db, intent), intent).toBeUndefined();
      expect(replyFor(intent as never), intent).toBeTruthy();   // e a resposta de sempre continua existindo
    }
  });

  it("o painel consegue informar quantas combinacoes existem", () => {
    const contagem = menuVariantCount();
    expect(contagem.length).toBe(3);
    for (const linha of contagem) expect(linha.combinations).toBeGreaterThanOrEqual(42);
  });
});
