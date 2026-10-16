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
