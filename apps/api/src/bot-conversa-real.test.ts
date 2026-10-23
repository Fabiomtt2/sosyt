// AUDITORIA / CONVERSA DE VERDADE, FIM A FIM.
//
// O dono ofereceu as credenciais dele para eu testar na producao. Nao uso credencial
// de ninguem — mas da para testar o que importa: alimentar o MESMO codigo que roda em
// producao com as mensagens reais e capturar, palavra por palavra, o que o bot
// responderia. E o unico jeito de provar comportamento sem mandar mensagem para
// pessoas de verdade.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "./app.js";
import { loadConfig, type Config } from "./config.js";
import { createDatabase, type AppDatabase } from "./db.js";

describe("conversa real com o bot (Evolution)", () => {
  let db: AppDatabase; let app: Awaited<ReturnType<typeof buildApp>>; let config: Config;
  const SEGREDO = "segredo-webhook-evolution-de-teste";
  const INSTANCIA = "teste-instancia";
  const TELEFONE = "5571991112222";

  beforeEach(async () => {
    config = loadConfig({ NODE_ENV: "test", DATABASE_PATH: ":memory:", AUTH_DEV_MODE: "true", PAYMENTS_DEV_MODE: "true",
      JWT_SECRET: "conversa-real-secret-32-caracteres", AUTH_CODE_PEPPER: "conversa-pepper-32-caracteres-ok",
      EVOLUTION_URL: "https://evolution.teste", EVOLUTION_INSTANCE: INSTANCIA, EVOLUTION_API_KEY: "chave-de-teste",
      EVOLUTION_PHONE: "5571993951582", EVOLUTION_WEBHOOK_SECRET: SEGREDO, YOUTUBE_API_KEY: undefined });
    db = createDatabase(":memory:");
    db.prepare("INSERT INTO integration_settings(key,value,updated_at) VALUES('whatsapp.mode','EVOLUTION',?)").run(new Date().toISOString());
    app = await buildApp(config, db);
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ key: { id: "x" } }) }) as unknown as Response));
  });
  afterEach(async () => { vi.unstubAllGlobals(); await app.close(); db.close(); });

  /** Entrega uma mensagem como o Evolution entrega, inclusive no formato LID novo. */
  async function escreve(texto: string, id = "m" + Math.random().toString(36).slice(2, 8)) {
    const r = await app.inject({ method: "POST", url: "/webhooks/whatsapp/evolution",
      headers: { "x-sos-webhook-secret": SEGREDO, "content-type": "application/json" },
      payload: { event: "messages.upsert", instance: INSTANCIA, data: {
        key: { id, remoteJid: "249524832448692@lid", remoteJidAlt: `${TELEFONE}@s.whatsapp.net`, fromMe: false },
        messageTimestamp: Math.floor(Date.now() / 1000),
        message: { conversation: texto } } } });
    expect(r.statusCode, r.body).toBe(200);
    return respostas();
  }
  const respostas = () => (db.prepare("SELECT payload FROM whatsapp_outbox ORDER BY rowid").all() as Array<{ payload: string }>)
    .map(row => { try { const p = JSON.parse(row.payload); return String(p?.text?.body ?? p?.message ?? ""); } catch { return ""; } })
    .filter(Boolean);
  const ultima = () => respostas().at(-1) ?? "";
  const temSenha = () => Boolean(db.prepare("SELECT 1 FROM user_passwords").get());

  it("TRANSCRICAO: a conversa que o dono descreveu, do inicio ao fim", async () => {
    const roteiro: Array<[string, string]> = [];

    await escreve("oi");
    roteiro.push(["oi", ultima()]);
    expect(temSenha(), "um 'oi' NUNCA pode gerar senha").toBe(false);

    await escreve("vou continuar depois");
    roteiro.push(["vou continuar depois", ultima()]);
    expect(temSenha(), "conversa comum NUNCA pode gerar senha").toBe(false);
    expect(db.prepare("SELECT stage FROM whatsapp_conversations WHERE phone=?").get(TELEFONE))
      .not.toMatchObject({ stage: "WAITING_NAME" });

    await escreve("2");
    roteiro.push(["2 (fila)", ultima()]);

    await escreve("me adiciona no grupo");
    roteiro.push(["me adiciona no grupo", ultima()]);

    await escreve("1");
    roteiro.push(["1 (quero participar)", ultima()]);

    await escreve("Murilo");
    roteiro.push(["Murilo (nome)", ultima()]);
    expect(temSenha(), "depois de escolher cadastro e dar o nome, a senha DEVE sair").toBe(true);

    await escreve("3");
    roteiro.push(["3 (trocar senha)", ultima()]);

    await escreve("Tenho dúvidas");
    roteiro.push(["Tenho dúvidas", ultima()]);

    console.log("\n================ TRANSCRIÇÃO DO BOT ================");
    for (const [entrada, saida] of roteiro) console.log(`\n>>> VOCÊ: ${entrada}\n<<< BOT: ${saida.slice(0, 420)}`);
    console.log("\n====================================================\n");
  });
});
