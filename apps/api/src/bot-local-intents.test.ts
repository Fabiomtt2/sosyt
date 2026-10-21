import { describe, expect, it } from "vitest";
import { classifyLocalBotIntent, declinesBotSensitiveAction, localBotFallback, localBotRouting } from "./bot-local-intents.js";

describe("local intent retrieval, without remote services or generated rules",()=>{
  it.each([
    ["Mande as opções para mim", "MENU"],
    ["Onde vejo os vídeos da minha filla?", "QUEUE"],
    ["Posso montar uma playlist incompleta?", "QUEUE"],
    ["minha credencial foi rejeitada", "PASSWORD_HELP"],
    ["Posso conversar com uma pessoa responsável?", "HUMAN"],
    ["Preciso conversar com a equipe responsável", "HUMAN"],
    ["pode me orientar melhor", "HELP"],
    ["onde vejo os produtos", "STORE"],
    ["quem está no pódio", "RANKING"],
  ])("understands %s",(text,intent)=>expect(classifyLocalBotIntent(text)?.intent).toBe(intent));
  it.each([
    "não quero conversar com a equipe", "nem preciso de pessoa responsável",
    "quero loja e fila", "a credencial da loja", "o dragão comeu minha bicicleta",
    "o meu telefone é 5511999999001", "minha senha senha!123", "acesse https://exemplo.test/loja",
    "#ABC123 mensagem", "quero\nprodutos", "n".repeat(501), "", "xyzzy plugh", "Pessoa Renomeada", "Pessoa Responsável",
  ])("refuses ambiguous, negated or sensitive input: %s",text=>expect(classifyLocalBotIntent(text)).toBeUndefined());
  it("never turns a probabilistic password interpretation into a credential reset",()=>{
    const result=localBotFallback("minha credencial foi rejeitada","UNKNOWN");
    expect(result?.intent).toBe("HELP");
    expect(result?.explanation).toContain("responda 3");
    expect(result?.explanation).toContain("Não alterei sua senha");
  });
  it("only asks the existing read-only engine for actual ranks and queues",()=>{
    expect(localBotFallback("quem está no pódio","UNKNOWN")).toEqual({intent:"HELP",progressCommand:"ranking"});
    expect(localBotFallback("Posso montar uma playlist incompleta?","UNKNOWN")).toEqual({intent:"QUEUE_INFO",progressCommand:"minhas filas"});
    expect(localBotFallback("onde vejo os produtos","UNKNOWN")?.explanation).not.toMatch(/R\$|grátis|gratuito|\+\d/);
  });
  it("preserves menu digits, name capture, stop and all explicit commands",()=>{
    for(const intent of ["PARTICIPATE","HUMAN","OPT_OUT","OPT_IN","QUEUE_INFO","STATUS","RESEND_CODE","GREETING","HELP","NAME_CANDIDATE"]){
      expect(localBotFallback("quem está no pódio",intent)).toBeUndefined();
    }
    expect(localBotFallback("quem está no pódio","UNKNOWN",true)).toBeUndefined();
    expect(localBotFallback("3","UNKNOWN")).toBeUndefined();
    expect(localBotRouting(undefined)).toBeUndefined();
  });
  it("returns only an enum and a similarity score, retaining no input or history",()=>{
    const result=classifyLocalBotIntent("onde vejo os produtos")!;
    expect(Object.keys(result).sort()).toEqual(["intent","score"]);
    expect(JSON.stringify(result)).not.toContain("produtos");
    const before=classifyLocalBotIntent("quem está no pódio");
    for(let i=0;i<20;i++)classifyLocalBotIntent("minha senha ABC12345");
    expect(classifyLocalBotIntent("quem está no pódio")).toEqual(before);
  });
  it("distinguishes refusal of a sensitive action from reporting an access problem",()=>{
    for(const text of ["não quero falar com humano", "não preciso de nova senha", "nem desejo uma pessoa", "nunca pedi credencial"]){
      expect(declinesBotSensitiveAction(text)).toBe(true);
    }
    for(const text of ["não consigo entrar", "não recebi a senha", "não tenho senha", "não quero falar com o bot, quero humano", "não quero falar com o bot mas preciso de uma pessoa"]){
      expect(declinesBotSensitiveAction(text)).toBe(false);
    }
  });
});
