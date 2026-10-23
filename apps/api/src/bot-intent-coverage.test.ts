// AUDITORIA / COBERTURA DE FALA REAL — guarda-corpo, nao enfeite.
//
// Medicao que originou este arquivo: de 31 mensagens que a comunidade de fato escreve,
// 13 nao recebiam resposta especifica — caiam no menu genérico. O diagnostico importa
// porque contraria o palpite obvio: nao era fraqueza do classificador, eram ASSUNTOS
// INTEIROS ausentes do vocabulario (grupo, pagamento, avatar, upload, agradecimento).
//
// O pior caso era "grupo": a automacao de entrada em grupo existia e NAO havia como
// pedi-la falando. Quem escrevia "me adiciona no grupo" recebia um menu.
//
// Este teste fixa o resultado. Se alguem mexer nos gatilhos e uma dessas frases voltar
// a cair no vazio, o teste quebra e explica o porque.
import { describe, expect, it } from "vitest";
import { classifyInbound, type InboundIntent } from "./bot-inbound.js";
import { classifyLocalBotIntent } from "./bot-local-intents.js";

/** Frase real -> intencao que PRECISA atende-la. */
const FALA_REAL: Array<[string, InboundIntent]> = [
  ["como eu entro no grupo", "GROUP_ACCESS"],
  ["me adiciona no grupo por favor", "GROUP_ACCESS"],
  ["qual o link do grupo do whatsapp", "GROUP_ACCESS"],
  ["nao estou em nenhum grupo", "GROUP_ACCESS"],
  ["onde eu coloco o link do meu canal", "UPLOAD_HELP"],
  ["meu video nao aparece na lista", "UPLOAD_HELP"],
  ["como faco pra mandar meu video", "UPLOAD_HELP"],
  ["isso e pago", "PAYMENT"],
  ["tem mensalidade", "PAYMENT"],
  ["como eu pago o pix", "PAYMENT"],
  ["qual o valor da assinatura super", "PAYMENT"],
  ["como troco meu avatar", "AVATAR"],
  ["como consigo os emblemas", "AVATAR"],
  ["obrigado", "THANKS"],
  ["valeu demais", "THANKS"],
  ["nao recebi minha senha", "RESEND_CODE"],
  ["perdi minha senha", "RESEND_CODE"],
  ["que horas abre a fila", "QUEUE_INFO"],
  ["quem ta ganhando", "HELP"],
  ["quantas moedas eu tenho", "HELP"],
  ["bom dia", "GREETING"],
];

describe("cobertura de intencao em fala real", () => {
  it("toda frase da sonda cai na intencao certa", () => {
    for (const [frase, esperada] of FALA_REAL) {
      expect(classifyInbound(frase), frase).toBe(esperada);
    }
  });

  it("nenhuma frase da sonda fica sem resposta especifica", () => {
    const orfas = FALA_REAL.filter(([frase]) => classifyInbound(frase) === "UNKNOWN" && !classifyLocalBotIntent(frase));
    expect(orfas.map(([frase]) => frase)).toEqual([]);
  });

  it("agradecer nao engole um pedido real na mesma mensagem", () => {
    // "obrigado, mas nao consigo entrar" e um PEDIDO, nao um agradecimento.
    expect(classifyInbound("obrigado, mas nao consigo entrar")).toBe("RESEND_CODE");
    expect(classifyInbound("valeu, mas tenho duvidas")).toBe("HUMAN");
  });

  it("pedir o grupo nao reabre cadastro de quem ja tem conta", () => {
    // Era a queixa do dono: "como entro" casava PARTICIPATE e o bot reoferecia cadastro.
    expect(classifyInbound("como entro no grupo")).toBe("GROUP_ACCESS");
    expect(classifyInbound("quero entrar no grupo")).toBe("GROUP_ACCESS");
    // e o cadastro continua acessivel para quem realmente quer se cadastrar
    expect(classifyInbound("quero participar")).toBe("PARTICIPATE");
    expect(classifyInbound("1")).toBe("PARTICIPATE");
  });
});
