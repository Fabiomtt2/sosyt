// AUDITORIA / a queixa do dono: "o bot envia a mesma mensagem padrão ... não há variação".
import { beforeEach, describe, expect, it } from "vitest";
import { createDatabase, type AppDatabase } from "./db.js";
import { variedInboundReply, menuVariantCount } from "./bot-menu-variants.js";
import { replyFor } from "./bot-inbound.js";

describe("menu do bot: varia o acolhimento, preserva o contrato", () => {
  let db: AppDatabase;
  beforeEach(() => { db = createDatabase(":memory:"); });

  it("nao repete a saudacao em sequencia (era UMA string fixa)", () => {
    const vistas = new Set<string>();
    for (let i = 0; i < 10; i++) vistas.add(variedInboundReply(db, "GREETING")!);
    // 10 aberturas x 6 fechos: dez chamadas seguidas tem que trazer dez mensagens distintas
    expect(vistas.size).toBe(10);
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
