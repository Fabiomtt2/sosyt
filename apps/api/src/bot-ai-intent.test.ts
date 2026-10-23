// IA COM REDEA CURTA — estes testes sao a redea.
//
// O dono autorizou IA "com cuidado", com medo legitimo de o bot inventar fato.
// A protecao nao e um pedido no prompt: e a lista fechada de rotulos e a degradacao
// silenciosa. Cada teste aqui fixa uma dessas travas.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDatabase, type AppDatabase } from "./db.js";
import { aiClassifyIntent, readBotAiSettings, saveBotAiSettings, botAiUsageToday, AI_LABELS } from "./bot-ai-intent.js";

const resposta = (conteudo: string, ok = true) =>
  vi.fn<typeof fetch>(async () => ({ ok, json: async () => ({ choices: [{ message: { content: conteudo } }] }) }) as unknown as Response);

describe("IA de intencao: interpreta, nunca escreve", () => {
  let db: AppDatabase;
  const env = {} as NodeJS.ProcessEnv;
  beforeEach(() => {
    db = createDatabase(":memory:");
    saveBotAiSettings(db, { enabled: true, baseUrl: "https://api.exemplo/v1", model: "modelo-teste", apiKey: "chave-de-teste", dailyCap: 3 });
  });

  it("desligada por padrao: ninguem acorda com chamada externa que nao pediu", async () => {
    const limpo = createDatabase(":memory:");
    expect(readBotAiSettings(limpo, env).enabled).toBe(false);
    const fetchImpl = resposta("HELP");
    expect(await aiClassifyIntent(limpo, "qualquer coisa estranha", { env, fetchImpl })).toBeUndefined();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("devolve o rotulo quando ele esta na lista fechada", async () => {
    expect(await aiClassifyIntent(db, "sera que eu consigo entrar na comunidade de voces", { env, fetchImpl: resposta("GROUP_ACCESS") })).toBe("GROUP_ACCESS");
  });

  it("IGNORA rotulo inventado — a lista fechada e a trava principal", async () => {
    for (const invencao of ["DAR_DESCONTO", "TRANSFERIR_DINHEIRO", "BANIR_USUARIO", "APAGAR_CONTA"]) {
      expect(await aiClassifyIntent(db, "mensagem qualquer para classificar", { env, fetchImpl: resposta(invencao) }), invencao).toBeUndefined();
    }
  });

  it("IGNORA quando o modelo responde com frase em vez de rotulo", async () => {
    const fetchImpl = resposta("Claro! Vou verificar seu saldo e já te retorno com o valor exato.");
    expect(await aiClassifyIntent(db, "mensagem qualquer para classificar", { env, fetchImpl })).toBeUndefined();
  });

  it("NENHUMA e tratado como 'nao sei', nao como intencao", async () => {
    expect(await aiClassifyIntent(db, "mensagem qualquer para classificar", { env, fetchImpl: resposta("NENHUMA") })).toBeUndefined();
  });

  it("falha de rede, timeout ou HTTP ruim degrada em silencio (nunca lanca)", async () => {
    const explode = vi.fn(async () => { throw new Error("rede caiu"); }) as unknown as typeof fetch;
    await expect(aiClassifyIntent(db, "mensagem qualquer para classificar", { env, fetchImpl: explode })).resolves.toBeUndefined();
    await expect(aiClassifyIntent(db, "mensagem qualquer para classificar", { env, fetchImpl: resposta("HELP", false) })).resolves.toBeUndefined();
  });

  it("respeita o teto diario: um loop nao queima a cota", async () => {
    const fetchImpl = resposta("HELP");
    for (let i = 0; i < 3; i++) expect(await aiClassifyIntent(db, `mensagem numero ${i} para classificar`, { env, fetchImpl })).toBe("HELP");
    // quarta chamada: teto de 3 atingido
    expect(await aiClassifyIntent(db, "mensagem numero quatro para classificar", { env, fetchImpl })).toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(botAiUsageToday(db).calls).toBe(3);
  });

  it("nao envia telefone, nome nem historico: so o texto da mensagem", async () => {
    const fetchImpl = resposta("HELP");
    await aiClassifyIntent(db, "me explica como funciona isso ai", { env, fetchImpl });
    const corpo = JSON.parse((fetchImpl.mock.calls[0]![1] as RequestInit).body as string);
    const enviado = JSON.stringify(corpo);
    expect(enviado).toContain("me explica como funciona isso ai");
    expect(enviado).not.toMatch(/\d{10,}/);          // nenhum telefone
    expect(corpo.messages).toHaveLength(2);           // system + a mensagem. Nada mais.
    expect(corpo.temperature).toBe(0);                // classificacao nao quer criatividade
    expect(corpo.max_tokens).toBeLessThanOrEqual(32); // teto corta custo e divagacao
  });

  it("mensagem curta ou gigante nao vira chamada paga", async () => {
    const fetchImpl = resposta("HELP");
    expect(await aiClassifyIntent(db, "ok", { env, fetchImpl })).toBeUndefined();
    expect(await aiClassifyIntent(db, "x".repeat(401), { env, fetchImpl })).toBeUndefined();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("todo rotulo possivel e uma porta que o bot sabe atender", () => {
    // Se alguem acrescentar um rotulo sem resposta correspondente, isto quebra.
    expect(AI_LABELS).toContain("NENHUMA");
    expect(new Set(AI_LABELS).size).toBe(AI_LABELS.length);
  });
  // AUDITORIA / NUMERO AMBIGUO E PIOR QUE NUMERO NENHUM.
  // A primeira versao somava "o modelo disse NENHUMA" com "a chamada quebrou" na
  // mesma coluna. O painel mostrou "2 sem resposta útil" para duas respostas
  // perfeitamente corretas, e o dono concluiu — com razao — que a IA estava quebrada.
  it("separa 'a IA disse que nao sabe' de 'a IA quebrou'", async () => {
    expect(await aiClassifyIntent(db, "mensagem que o modelo nao reconhece", { env, fetchImpl: resposta("NENHUMA") })).toBeUndefined();
    let uso = botAiUsageToday(db);
    expect(uso).toMatchObject({ calls: 1, hits: 0, nenhuma: 1, failures: 0 });
    expect(uso.lastReason).toBe("NENHUMA");

    expect(await aiClassifyIntent(db, "outra mensagem qualquer aqui", { env, fetchImpl: resposta("HELP", false) })).toBeUndefined();
    uso = botAiUsageToday(db);
    expect(uso).toMatchObject({ nenhuma: 1, failures: 1 });
    expect(uso.lastReason, "o motivo tecnico precisa ficar registrado").toContain("HTTP_");
  });

  it("registra o motivo quando a resposta vem fora da lista fechada", async () => {
    await aiClassifyIntent(db, "mensagem para classificar agora", { env, fetchImpl: resposta("DAR_DESCONTO") });
    expect(botAiUsageToday(db).lastReason).toContain("RESPOSTA_FORA_DA_LISTA");
  });

  it("acerto guarda qual porta foi escolhida", async () => {
    await aiClassifyIntent(db, "mensagem para classificar agora", { env, fetchImpl: resposta("GROUP_ACCESS") });
    expect(botAiUsageToday(db)).toMatchObject({ hits: 1, lastReason: "GROUP_ACCESS" });
  });
});
