// AUDITORIA / HYBRID+ — testes do motor de grupos e dos freios anti-ban.
//
// Cada bloco corresponde a um risco que a reauditoria levantou. O cliente recebe
// `fetchImpl` injetado, então tudo roda sem rede.
import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_CADENCE, EvolutionSafetyError, assertDistinctFromOfficial, createEvolutionClient,
  nextSendDelayMs, pickGroupWithRoom, pickVariant, spreadFanOut, warmupCapForDay,
  type GroupSlot,
} from "./bot-evolution.js";

const CONFIG = { url: "https://evo.example.com/", instance: "sosyt", apiKey: "k".repeat(16), number: "5571999990000" };

function fakeFetch(handler: (url: string, init: Record<string, unknown>) => { status?: number; body?: unknown }) {
  const calls: Array<{ url: string; init: Record<string, unknown> }> = [];
  const impl = async (url: string, init: Record<string, unknown> = {}) => {
    calls.push({ url, init });
    const { status = 200, body = {} } = handler(url, init);
    return { ok: status >= 200 && status < 300, status, json: async () => body };
  };
  return { impl: impl as never, calls };
}

describe("separação de número — a trava mais importante", () => {
  it("recusa usar o mesmo número do OTP no motor de grupos", () => {
    expect(() => assertDistinctFromOfficial("5571999990000", "5571999990000")).toThrow(EvolutionSafetyError);
    try { assertDistinctFromOfficial("+55 71 99999-0000", "5571999990000"); }
    catch (cause) { expect((cause as EvolutionSafetyError).code).toBe("SAME_NUMBER_AS_OFFICIAL"); }
  });

  it("aceita números distintos e não trava quando algum ainda não foi configurado", () => {
    expect(() => assertDistinctFromOfficial("5571999990000", "5571888880000")).not.toThrow();
    expect(() => assertDistinctFromOfficial(undefined, "5571888880000")).not.toThrow();
    expect(() => assertDistinctFromOfficial("5571999990000", undefined)).not.toThrow();
  });
});

describe("cadência com jitter", () => {
  it("o intervalo fica sempre dentro da janela configurada", () => {
    for (const r of [0, 0.25, 0.5, 0.99, 1]) {
      const delay = nextSendDelayMs(DEFAULT_CADENCE, () => r);
      expect(delay).toBeGreaterThanOrEqual(DEFAULT_CADENCE.minGapMs);
      expect(delay).toBeLessThanOrEqual(DEFAULT_CADENCE.maxGapMs);
    }
  });

  it("intervalos variam — não é cadência robótica fixa", () => {
    const valores = new Set([0.1, 0.4, 0.7, 0.95].map((r) => nextSendDelayMs(DEFAULT_CADENCE, () => r)));
    expect(valores.size).toBeGreaterThan(1);
  });
});

describe("fan-out espalhado (40 grupos não podem receber em rajada)", () => {
  it("espalha dentro da janela e em ordem crescente", () => {
    const delays = spreadFanOut(40, DEFAULT_CADENCE, () => 0.5);
    expect(delays).toHaveLength(40);
    expect(delays[0]).toBeGreaterThanOrEqual(0);
    expect(delays.at(-1)!).toBeLessThanOrEqual(DEFAULT_CADENCE.fanOutWindowMs);
    expect([...delays].sort((a, b) => a - b)).toEqual(delays);
  });

  it("o último envio não sai em segundos — é isso que evita a assinatura de bot", () => {
    const delays = spreadFanOut(40, DEFAULT_CADENCE, () => 0);
    expect(delays.at(-1)!).toBeGreaterThan(10 * 60_000);  // bem além de uma rajada
  });

  it("casos de borda não quebram", () => {
    expect(spreadFanOut(0)).toEqual([]);
    expect(spreadFanOut(1)).toEqual([0]);
  });
});

describe("warm-up do número novo", () => {
  it("começa baixo e chega ao teto cheio ao fim do aquecimento", () => {
    expect(warmupCapForDay(0)).toBe(DEFAULT_CADENCE.warmupStartCap);
    expect(warmupCapForDay(DEFAULT_CADENCE.warmupDays)).toBe(DEFAULT_CADENCE.dailyCapTotal);
    expect(warmupCapForDay(999)).toBe(DEFAULT_CADENCE.dailyCapTotal);
  });

  it("sobe de forma monotônica, sem salto", () => {
    let anterior = 0;
    for (let dia = 0; dia <= DEFAULT_CADENCE.warmupDays; dia++) {
      const cap = warmupCapForDay(dia);
      expect(cap).toBeGreaterThanOrEqual(anterior);
      anterior = cap;
    }
  });
});

describe("rotação de texto", () => {
  it("alterna entre variantes conforme a semente", () => {
    const vs = ["a", "b", "c"];
    expect(pickVariant(vs, 0)).toBe("a");
    expect(pickVariant(vs, 1)).toBe("b");
    expect(pickVariant(vs, 5)).toBe("c");
    expect(pickVariant(vs, -4)).toBe("b");   // semente negativa não quebra
  });

  it("lista vazia é erro explícito, não envio silencioso", () => {
    expect(() => pickVariant([], 1)).toThrow(EvolutionSafetyError);
  });
});

describe("roteador de capacidade — 'grupo 2 cheio, entra no 3 ou no 1'", () => {
  const grupos: GroupSlot[] = [
    { code: "1", memberCount: 180, capacity: 200 },
    { code: "2", memberCount: 200, capacity: 200 },   // cheio
    { code: "3", memberCount: 40, capacity: 200 },
  ];

  it("respeita o grupo preferido quando ainda há vaga", () => {
    expect(pickGroupWithRoom(grupos, "3")?.code).toBe("3");
  });

  it("transborda quando o preferido está cheio", () => {
    const escolhido = pickGroupWithRoom(grupos, "2");
    expect(escolhido?.code).not.toBe("2");
    expect(escolhido?.code).toBe("1");   // o mais cheio COM vaga fecha o ciclo antes
  });

  it("sem preferência, escolhe o mais cheio que ainda cabe", () => {
    expect(pickGroupWithRoom(grupos)?.code).toBe("1");
  });

  it("ignora grupo desativado", () => {
    const escolhido = pickGroupWithRoom([
      { code: "1", memberCount: 10, capacity: 200, enabled: false },
      { code: "2", memberCount: 20, capacity: 200 },
    ]);
    expect(escolhido?.code).toBe("2");
  });

  it("devolve indefinido quando tudo está cheio — nunca estoura capacidade", () => {
    expect(pickGroupWithRoom([{ code: "1", memberCount: 200, capacity: 200 }])).toBeUndefined();
    expect(pickGroupWithRoom([])).toBeUndefined();
  });
});

describe("cliente do Evolution", () => {
  it("reporta sessão de pé e sessão caída", async () => {
    const aberta = fakeFetch((url) => ({ body: url.includes("fetchInstances") ? [{ name: CONFIG.instance, ownerJid: CONFIG.number + "@s.whatsapp.net" }] : { instance: { state: "open" } } }));
    expect((await createEvolutionClient({ config: CONFIG, fetchImpl: aberta.impl }).health()).connected).toBe(true);

    const fechada = fakeFetch(() => ({ body: { instance: { state: "close" } } }));
    expect((await createEvolutionClient({ config: CONFIG, fetchImpl: fechada.impl }).health()).connected).toBe(false);

    // AUDITORIA / identidade: sessão aberta de OUTRO número é tratada como não confiável.
    const outro = fakeFetch((url) => ({ body: url.includes("fetchInstances") ? [{ name: CONFIG.instance, ownerJid: "5511999999999@s.whatsapp.net" }] : { instance: { state: "open" } } }));
    expect(await createEvolutionClient({ config: CONFIG, fetchImpl: outro.impl }).health()).toMatchObject({ connected: false, state: "identity_unverified" });
  });

  it("falha de rede não explode: vira 'desconectado' para o breaker decidir", async () => {
    const quebrado = (async () => { throw new Error("ECONNREFUSED"); }) as never;
    const health = await createEvolutionClient({ config: CONFIG, fetchImpl: quebrado }).health();
    expect(health.connected).toBe(false);
    expect(health.detail).toBeTruthy();
  });

  it("envia texto para o grupo com a chave de API no cabeçalho", async () => {
    const f = fakeFetch(() => ({ body: { key: { id: "m1" } } }));
    await createEvolutionClient({ config: CONFIG, fetchImpl: f.impl }).sendGroupText("123@g.us", "Olá!");
    expect(f.calls[0].url).toContain("/message/sendText/sosyt");
    expect((f.calls[0].init.headers as Record<string, string>).apikey).toBe(CONFIG.apiKey);
    expect(JSON.parse(String(f.calls[0].init.body))).toEqual({ number: "123@g.us", text: "Olá!" });
  });

  it("lê participantes já normalizados em dígitos", async () => {
    const f = fakeFetch(() => ({ body: { participants: [{ id: "5571999991111@s.whatsapp.net" }, { id: "5571999992222@s.whatsapp.net" }] } }));
    const phones = await createEvolutionClient({ config: CONFIG, fetchImpl: f.impl }).groupParticipants("123@g.us");
    expect(phones).toEqual(["5571999991111", "5571999992222"]);
  });

  it("adiciona e remove participante com a ação correta", async () => {
    const f = fakeFetch(() => ({ body: { ok: true } }));
    const client = createEvolutionClient({ config: CONFIG, fetchImpl: f.impl });
    await client.addParticipant("123@g.us", "+55 71 99999-3333");
    await client.removeParticipant("123@g.us", "5571999994444");
    expect(JSON.parse(String(f.calls[0].init.body))).toEqual({ action: "add", participants: ["5571999993333"] });
    expect(JSON.parse(String(f.calls[1].init.body))).toEqual({ action: "remove", participants: ["5571999994444"] });
  });

  it("erro do servidor vira EvolutionSafetyError com o status", async () => {
    const f = fakeFetch(() => ({ status: 502, body: { message: "bad gateway" } }));
    await expect(createEvolutionClient({ config: CONFIG, fetchImpl: f.impl }).sendGroupText("g", "x"))
      .rejects.toThrow(/502/);
  });
});

describe("identidade tolera sufixo de device no ownerJid (achado do revisor)", () => {
  it("ownerJid com :device@server ainda é reconhecido como o número salvo", async () => {
    const f = fakeFetch((url) => ({ body: url.includes("fetchInstances")
      ? [{ name: CONFIG.instance, ownerJid: CONFIG.number + ":12@s.whatsapp.net" }]
      : { instance: { state: "open" } } }));
    expect((await createEvolutionClient({ config: CONFIG, fetchImpl: f.impl }).health()).connected).toBe(true);
  });
});

describe("sameWhatsAppNumber — tolera o 9º dígito brasileiro (bug do bot mudo)", () => {
  it("559 com 9 == JID sem 9 (557193951582 == 5571993951582)", async () => {
    const { sameWhatsAppNumber } = await import("./bot-evolution.js");
    expect(sameWhatsAppNumber("557193951582", "5571993951582")).toBe(true);
    expect(sameWhatsAppNumber("5571993951582", "557193951582")).toBe(true);
    expect(sameWhatsAppNumber("5571993951582", "5571993951582")).toBe(true);
  });
  it("números DIFERENTES não casam", async () => {
    const { sameWhatsAppNumber } = await import("./bot-evolution.js");
    expect(sameWhatsAppNumber("5571993951582", "5571993978956")).toBe(false);  // bot vs Rafael
    expect(sameWhatsAppNumber("557193951582", "557193978956")).toBe(false);
  });
  it("health aceita a sessão quando o ownerJid vem sem o 9", async () => {
    const CFG = { url: "https://evo.example.com/", instance: "sosyt", apiKey: "k".repeat(16), number: "5571993951582" };
    const f = fakeFetch((url) => ({ body: url.includes("fetchInstances")
      ? [{ name: CFG.instance, ownerJid: "557193951582@s.whatsapp.net" }]   // SEM o 9
      : { instance: { state: "open" } } }));
    expect((await createEvolutionClient({ config: CFG, fetchImpl: f.impl }).health()).connected).toBe(true);
  });
});

describe("jidToPhone + participantes LID (impacto no sync de membros)", () => {
  it("extrai telefone de JID tradicional e recusa LID", async () => {
    const { jidToPhone } = await import("./bot-evolution.js");
    expect(jidToPhone("557192679840@s.whatsapp.net")).toBe("557192679840");
    expect(jidToPhone("557192679840:12@s.whatsapp.net")).toBe("557192679840");
    expect(jidToPhone("249524832448692@lid")).toBe("");   // LID NÃO é telefone
    expect(jidToPhone(undefined)).toBe("");
  });
  it("groupParticipants usa phoneNumber quando o id vem como LID", async () => {
    const f = fakeFetch(() => ({ body: { participants: [
      { id: "141386213019830@lid", phoneNumber: "555182253352@s.whatsapp.net", admin: null },
      { id: "170652304732240@lid", phoneNumber: "244921782221@s.whatsapp.net", admin: null },
      { id: "557193951582@s.whatsapp.net", admin: "admin" },
    ] } }));
    const phones = await createEvolutionClient({ config: CONFIG, fetchImpl: f.impl }).groupParticipants("123@g.us");
    expect(phones).toEqual(["555182253352", "244921782221", "557193951582"]);
    expect(phones.every((p) => /^[1-9]\d{7,14}$/.test(p))).toBe(true);   // nenhum LID vazou
  });
});

describe("DM nunca é bloqueada por teto diário (aprendizado de produção)", () => {
  it("o teto de warm-up vale para GRUPO, não para conversa 1:1", () => {
    // o teto existe contra disparo em massa (fenômeno de grupo). A DM é protegida por
    // cadência + breaker + orçamento POR PESSOA, não por teto global de identidade.
    expect(warmupCapForDay(0)).toBe(10);          // número novo: grupo começa baixo
    expect(warmupCapForDay(21)).toBe(120);        // depois do aquecimento, teto cheio
  });
});

describe("roteador de grupo: menor número com vaga (regra do dono, N de 1 a 99)", () => {
  const slot = (code: string, members: number, capacity = 1024) => ({ code, memberCount: members, capacity });
  it("enche o 1 primeiro, mesmo com o 2 mais cheio", () => {
    expect(pickGroupWithRoom([slot("2", 900), slot("1", 100), slot("3", 5)])?.code).toBe("1");
  });
  it("1 cheio vai para o 2 (não pula para o 3)", () => {
    expect(pickGroupWithRoom([slot("1", 1024), slot("2", 10), slot("3", 0)])?.code).toBe("2");
  });
  it("se o 1 LIBERA vaga, o próximo volta para o 1", () => {
    expect(pickGroupWithRoom([slot("1", 1023), slot("2", 500), slot("3", 20)])?.code).toBe("1");
  });
  it("ordena por número, não alfabeticamente (10 depois de 9)", () => {
    expect(pickGroupWithRoom([slot("10", 0), slot("9", 1024), slot("11", 0)])?.code).toBe("10");
  });
  it("funciona até o 99 e devolve undefined se todos estão cheios", () => {
    const cheios = Array.from({ length: 99 }, (_, i) => slot(String(i + 1), 1024));
    expect(pickGroupWithRoom(cheios)).toBeUndefined();
    expect(pickGroupWithRoom([...cheios.slice(0, 98), slot("99", 10)])?.code).toBe("99");
  });
  it("grupo desabilitado é ignorado mesmo tendo vaga", () => {
    expect(pickGroupWithRoom([{ ...slot("1", 0), enabled: false }, slot("2", 0)])?.code).toBe("2");
  });
});
