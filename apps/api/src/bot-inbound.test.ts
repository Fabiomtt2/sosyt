// AUDITORIA / HYBRID+ — testes de "ninguém nunca fala sozinho" + opt-out.
//
// Cada teste aqui corresponde a uma porta de vácuo que a reauditoria encontrou.
import Database from "better-sqlite3";
import { beforeEach, describe, expect, it } from "vitest";
import type { AppDatabase } from "./db.js";
import {
  classifyInbound, ensureBotOptOut, isOptedOut, looksLikeName, mayReceive,
  nameRejectionReason, extractPreferredName, normalizeInbound, replyFor, setOptOut,
  DECLINED_FOLLOWUP_REPLY, MEDIA_REPLY, TOO_LONG_REPLY,
} from "./bot-inbound.js";

describe("extração conservadora do nome no cadastro conversacional",()=>{
  it.each([
    ["Meu nome é Ana Maria","Ana Maria"],
    ["me chamo João Pedro","João Pedro"],
    ["Eu sou Beatriz","Beatriz"],
    ["Pode me chamar de Léo","Léo"],
    ["Oi, meu nome é Milena e quero participar","Milena"],
    ["Olá! Me chamo Carolina.","Carolina"],
    ["Rafael Costa","Rafael Costa"],
  ])("transforma %s em %s", (message,expected)=>{
    expect(extractPreferredName(message)).toBe(expected);
  });
  it("prioriza nome ao continuar cadastro sem engolir comandos sensíveis",()=>{
    expect(classifyInbound("Meu nome é Ana e quero participar",{awaitingName:true})).toBe("NAME_CANDIDATE");
    expect(classifyInbound("Meu nome é Ana e quero participar")).toBe("PARTICIPATE");
    expect(classifyInbound("Tenho dúvidas",{awaitingName:true})).toBe("HUMAN");
    expect(classifyInbound("PARE",{awaitingName:true})).toBe("OPT_OUT");
  });
  it.each(["Meu nome é","me chamo","https://example.com","1",""])("não registra frases incompletas ou inseguras: %s",message=>{
    expect(extractPreferredName(message)).toBeUndefined();
  });
});

describe("HYBRID+ / classificação da entrada", () => {
  it("entende 'quero participar' com e sem acento, maiúscula ou não", () => {
    for (const t of ["quero participar", "QUERO PARTICIPAR", "Quero Participar!", "quero participár"]) {
      expect(classifyInbound(t), t).toBe("PARTICIPATE");
    }
  });

  it("entende 'humano' — a porta que o próprio bot prometia e não existia", () => {
    for (const t of ["humano", "HUMANO", "quero falar com humano", "me passa pra um atendente", "falar com uma pessoa"]) {
      expect(classifyInbound(t), t).toBe("HUMAN");
    }
  });

  it("entende pedidos de parar (opt-out)", () => {
    for (const t of ["PARE", "parar", "não quero mais receber", "me tira dessa lista", "STOP"]) {
      expect(classifyInbound(t), t).toBe("OPT_OUT");
    }
  });

  it("entende o pedido de voltar a receber", () => {
    expect(classifyInbound("quero voltar a receber")).toBe("OPT_IN");
  });

  it("entende saudação, ajuda, status e código não recebido", () => {
    expect(classifyInbound("oi")).toBe("GREETING");
    expect(classifyInbound("Bom dia!")).toBe("GREETING");
    expect(classifyInbound("preciso de ajuda")).toBe("HELP");
    expect(classifyInbound("qual o status?")).toBe("STATUS");
    expect(classifyInbound("não chegou meu código")).toBe("RESEND_CODE");
  });

  it("'oi' dentro de outra palavra NÃO vira saudação", () => {
    expect(classifyInbound("coisa estranha aconteceu")).not.toBe("GREETING");
  });

  it("o que não casa com nada vira UNKNOWN — mas nunca silêncio", () => {
    const intent = classifyInbound("xyzzy plugh");
    expect(intent).toBe("UNKNOWN");
    expect(replyFor(intent)).toBeTruthy();
  });

  it("TODA intenção tem resposta, menos as que têm fluxo próprio", () => {
    const intents = ["HUMAN", "OPT_OUT", "OPT_IN", "STATUS", "RESEND_CODE", "GREETING", "HELP", "UNKNOWN"] as const;
    for (const i of intents) expect(replyFor(i), i).toBeTruthy();
    expect(replyFor("PARTICIPATE")).toBeUndefined();   // fluxo de cadastro
    expect(replyFor("NAME_CANDIDATE")).toBeUndefined();
  });

  it("texto vazio não quebra", () => {
    expect(classifyInbound("   ")).toBe("UNKNOWN");
  });
});

describe("HYBRID+ / o nome: explicar em vez de calar", () => {
  it("durante a pergunta do nome, um texto comum é tratado como nome", () => {
    expect(classifyInbound("Fábio Mattos", { awaitingName: true })).toBe("NAME_CANDIDATE");
  });

  it("nome com link, vazio ou longo demais é recusado COM motivo (antes: silêncio)", () => {
    const casos = ["meu canal é https://youtube.com/x", "a", "n".repeat(90), "linha1\nlinha2"];
    for (const caso of casos) {
      expect(looksLikeName(caso), caso).toBe(false);
      expect(nameRejectionReason(caso), caso).toBeTruthy();   // sempre há o que dizer
    }
  });

  it("nome válido passa e não gera motivo de recusa", () => {
    expect(looksLikeName("Rafael")).toBe(true);
    expect(nameRejectionReason("Rafael")).toBeUndefined();
  });

  it("mesmo sendo comando, 'humano' ganha prioridade sobre virar nome", () => {
    expect(classifyInbound("humano", { awaitingName: true })).toBe("HUMAN");
  });
});

describe("HYBRID+ / opt-out", () => {
  let db: AppDatabase;
  beforeEach(() => { db = new Database(":memory:") as AppDatabase; ensureBotOptOut(db); });

  it("registra e remove o pedido de silêncio", () => {
    expect(isOptedOut(db, "5571999999999")).toBe(false);
    setOptOut(db, "5571999999999", true);
    expect(isOptedOut(db, "5571999999999")).toBe(true);
    setOptOut(db, "5571999999999", false);
    expect(isOptedOut(db, "5571999999999")).toBe(false);
  });

  it("registrar duas vezes não quebra", () => {
    setOptOut(db, "5571988888888", true);
    expect(() => setOptOut(db, "5571988888888", true)).not.toThrow();
  });

  it("REGRA DURA: opt-out silencia divulgação, nunca o código de acesso", () => {
    const phone = "5571977777777";
    setOptOut(db, phone, true);
    expect(mayReceive(db, phone, "ENGAGEMENT")).toBe(false);      // avisos param
    expect(mayReceive(db, phone, "LOGIN_CODE")).toBe(true);       // login continua
    expect(mayReceive(db, phone, "DECISION_NOTICE")).toBe(true);  // decisão continua
    expect(mayReceive(db, phone, "SUPPORT_REPLY")).toBe(true);    // resposta de suporte continua
  });

  it("quem não pediu silêncio recebe tudo", () => {
    expect(mayReceive(db, "5571966666666", "ENGAGEMENT")).toBe(true);
  });
});

describe("HYBRID+ / nada mais cai no silêncio", () => {
  it("áudio, foto e vídeo têm resposta", () => {
    expect(MEDIA_REPLY).toMatch(/Tenho dúvidas/);
    expect(MEDIA_REPLY.length).toBeGreaterThan(40);
  });

  it("mensagem longa demais tem resposta", () => {
    expect(TOO_LONG_REPLY).toMatch(/Tenho dúvidas/);
  });

  it("quem responde a uma recusa recebe a resposta que o texto prometia", () => {
    expect(DECLINED_FOLLOWUP_REPLY).toMatch(/Owners/);
  });
});

describe("HYBRID+ / normalização", () => {
  it("tira acento e caixa", () => {
    expect(normalizeInbound("  ÓLÁ Querô  ")).toBe("ola quero");
  });
});

describe("gatilho 'Tenho dúvidas' (divulgado no grupo)", () => {
  it("chama uma pessoa com ou sem acento", () => {
    expect(classifyInbound("Tenho dúvidas")).toBe("HUMAN");
    expect(classifyInbound("tenho duvidas")).toBe("HUMAN");       // sem acento
    expect(classifyInbound("Oi, tenho uma dúvida sobre a fila")).toBe("HUMAN");
  });
  it("não rouba a saudação nem a ajuda genérica", () => {
    expect(classifyInbound("oi")).toBe("GREETING");
    expect(classifyInbound("como funciona")).toBe("HELP");
  });
});

describe("OPT_OUT não silencia por substring (achado do revisor)", () => {
  it("'preparar', 'comparar', 'separar' NÃO são opt-out", () => {
    expect(classifyInbound("vou preparar meu vídeo")).not.toBe("OPT_OUT");
    expect(classifyInbound("quero comparar os canais")).not.toBe("OPT_OUT");
    expect(classifyInbound("vou separar os links")).not.toBe("OPT_OUT");
  });
  it("'pare', 'parar', 'sair' (palavra inteira) continuam opt-out", () => {
    expect(classifyInbound("pare")).toBe("OPT_OUT");
    expect(classifyInbound("quero parar")).toBe("OPT_OUT");
    expect(classifyInbound("quero sair")).toBe("OPT_OUT");
  });
});

describe("saudação e menu NUNCA viram nome (bug: cadastro criado no primeiro 'oi')", () => {
  it("durante a pergunta do nome, 'oi' continua sendo saudação", () => {
    expect(classifyInbound("oi", { awaitingName: true })).toBe("GREETING");
    expect(classifyInbound("bom dia", { awaitingName: true })).toBe("GREETING");
  });
  it("durante a pergunta do nome, um número do menu continua sendo o menu", () => {
    expect(classifyInbound("1", { awaitingName: true })).toBe("PARTICIPATE");
    expect(classifyInbound("2", { awaitingName: true })).toBe("QUEUE_INFO");
    expect(classifyInbound("3", { awaitingName: true })).toBe("RESEND_CODE");
  });
  it("um nome de verdade é aceito como nome", () => {
    expect(classifyInbound("Fábio Motta", { awaitingName: true })).toBe("NAME_CANDIDATE");
    expect(classifyInbound("Maria", { awaitingName: true })).toBe("NAME_CANDIDATE");
  });
  it("a opção 2 explica as filas", () => {
    expect(classifyInbound("fila")).toBe("QUEUE_INFO");
    expect(replyFor("QUEUE_INFO")).toMatch(/10 links/);
  });
});

describe("número do menu só vale como mensagem inteira (bug: cadastro sem escolher)", () => {
  it("texto que CONTÉM um dígito não dispara a opção do menu", () => {
    expect(classifyInbound("tenho 1 dúvida")).not.toBe("PARTICIPATE");
    expect(classifyInbound("meu telefone é 71999991234")).not.toBe("PARTICIPATE");
    expect(classifyInbound("mandei 3 vídeos")).not.toBe("RESEND_CODE");
    expect(classifyInbound("já são 5 dias")).not.toBe("HELP");
  });
  it("o dígito sozinho continua sendo a opção do menu", () => {
    expect(classifyInbound("1")).toBe("PARTICIPATE");
    expect(classifyInbound("2")).toBe("QUEUE_INFO");
    expect(classifyInbound("3")).toBe("RESEND_CODE");
    expect(classifyInbound("4")).toBe("STATUS");
    expect(classifyInbound("5")).toBe("HELP");
  });
});

describe("pedidos humanos em linguagem cotidiana",()=>{
 it.each(['TENHO DÚVIDAS','tenho duvidas','Tenho 1 dúvida sobre a senha','preciso de suporte','quero falar com o suporte','falar com a equipe','falar com um admin','falar com Rafael','falar com Fábio','atendimento pessoal'])("encaminha %s mesmo aguardando nome",(text)=>{
   expect(classifyInbound(text,{awaitingName:true})).toBe('HUMAN');
 });
 it("mantém dúvidas genéricas no menu automatizado",()=>{
   expect(classifyInbound('como funciona a fila')).toBe('QUEUE_INFO');
   expect(classifyInbound('preciso de ajuda')).toBe('HELP');
 });
});
