// AUDITORIA / HYBRID+ — testes do despachante (automação -> motor certo).
import Database from "better-sqlite3";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppDatabase } from "./db.js";
import type { Config } from "./config.js";
import { ensureBotAutomations, saveAutomationSettings } from "./bot-automation-store.js";
import { ensureBotOptOut, setOptOut } from "./bot-inbound.js";
import { ensureBotDelivery, DEFAULT_DELIVERY_POLICY } from "./bot-delivery-policy.js";
import { DEFAULT_CADENCE, type EvolutionClient } from "./bot-evolution.js";
import {
  dispatchAutomation, planGroupFanout, renderAutomation, runGroupPlan, targetGroups,
} from "./bot-dispatch.js";

const config = {} as Config;
let db: AppDatabase;

beforeEach(() => {
  db = new Database(":memory:") as AppDatabase;
  ensureBotAutomations(db); ensureBotOptOut(db); ensureBotDelivery(db);
  db.exec(`CREATE TABLE groups (code TEXT PRIMARY KEY, enabled INTEGER NOT NULL DEFAULT 1,
    whatsapp_group_id TEXT, membership_mode TEXT, last_synced_at TEXT, join_url TEXT);`);
  const g = db.prepare("INSERT INTO groups (code,enabled,whatsapp_group_id) VALUES (?,?,?)");
  g.run("1", 1, "111@g.us"); g.run("2", 1, "222@g.us"); g.run("3", 1, "333@g.us");
  g.run("4", 0, "444@g.us");            // desativado
  g.run("5", 1, null);                  // sem id do WhatsApp
});

describe("render da automação", () => {
  it("renderiza o texto com as variáveis e classifica a entrega", () => {
    const r = renderAutomation(db, "QUEUE_OPEN", { fila: 7, link: "x" });
    expect("skipped" in r).toBe(false);
    if (!("skipped" in r)) {
      expect(r.channel).toBe("EVOLUTION"); expect(r.target).toBe("ALL_GROUPS");
      // o texto pode vir de uma VARIANTE (anti-repetição); todas citam a fila e o link
      expect(r.text.toLowerCase()).toContain("fila 7"); expect(r.deliveryClass).toBe("QUEUE");
    }
  });

  it("pula automação desligada", async () => {
    // AUDITORIA: por pedido do dono as automações nascem LIGADAS; para testar o pulo,
    // desligamos explicitamente — que é o que o Owner faria no painel.
    const { saveAutomationSettings } = await import("./bot-automation-store.js");
    saveAutomationSettings(db, "QUEUE_STATUS", { enabled: false }, { id: "root", name: "Root" });
    expect(renderAutomation(db, "QUEUE_STATUS", {})).toEqual({ skipped: "disabled" });
  });

  it("evento inexistente é pulado, não quebra", () => {
    expect(renderAutomation(db, "NAO_EXISTE", {})).toEqual({ skipped: "unknown-event" });
  });

  it("suporte é transacional (não pode ser cortado por orçamento)", () => {
    const r = renderAutomation(db, "SUPPORT_AUTO", { nome: "Ana" });
    if (!("skipped" in r)) expect(r.deliveryClass).toBe("TRANSACTIONAL");
  });
});

describe("resolução de grupos-alvo", () => {
  it("ALL_GROUPS traz só os habilitados COM id do WhatsApp", () => {
    const groups = targetGroups(db, "ALL_GROUPS", {});
    expect(groups.map((g) => g.code)).toEqual(["1", "2", "3"]); // 4 off, 5 sem id
  });
  it("GROUP exige um código e respeita habilitado/id", () => {
    expect(targetGroups(db, "GROUP", { groupCode: "2" })).toEqual([{ code: "2", groupId: "222@g.us" }]);
    expect(targetGroups(db, "GROUP", { groupCode: "4" })).toEqual([]); // desativado
    expect(targetGroups(db, "GROUP", {})).toEqual([]);                 // sem código
  });
});

describe("plano de fan-out", () => {
  it("uma mensagem por grupo, com atrasos crescentes dentro da janela", () => {
    const plan = planGroupFanout([{ code: "1", groupId: "a" }, { code: "2", groupId: "b" }, { code: "3", groupId: "c" }],
      "oi", DEFAULT_CADENCE, () => 0.5);
    expect(plan).toHaveLength(3);
    expect(plan.map((p) => p.delayMs)).toEqual([...plan.map((p) => p.delayMs)].sort((a, b) => a - b));
    expect(plan.every((p) => p.text === "oi")).toBe(true);
  });
});

describe("dispatchAutomation", () => {
  it("DM oficial enfileira pelo motor oficial injetado", () => {
    const sendOfficial = vi.fn(() => ({ queued: true }));
    const r = dispatchAutomation(db, config, "WELCOME_DM", { nome: "Ana", grupo: "1", link: "x" },
      { phone: "5571999990000" }, { sendOfficial });
    expect(sendOfficial).toHaveBeenCalledOnce();
    expect(r.official?.[0]).toMatchObject({ phone: "5571999990000", queued: true });
  });

  it("DM sem destinatário é pulado", () => {
    expect(dispatchAutomation(db, config, "WELCOME_DM", {}, {}, {}).skipped).toBe("no-recipient");
  });

  it("grupo devolve o PLANO de fan-out (execução é temporizada depois)", () => {
    const r = dispatchAutomation(db, config, "QUEUE_OPEN", { fila: 7, link: "x" }, {}, {}, { rand: () => 0.3 });
    expect(r.groupPlan).toHaveLength(3);               // grupos 1,2,3
    expect(r.groupPlan!.every((s) => s.text.includes("fila 7"))).toBe(true);
  });

  it("grupo sem nenhum grupo configurado é pulado", () => {
    db.exec("DELETE FROM groups");
    expect(dispatchAutomation(db, config, "QUEUE_OPEN", { fila: 1, link: "x" }, {}, {}).skipped).toBe("no-groups");
  });
});

function fakeClient(connected: boolean): { client: EvolutionClient; sent: string[] } {
  const sent: string[] = [];
  const client = {
    health: async () => ({ connected }),
    sendGroupText: async (groupId: string) => { sent.push(groupId); return {}; },
    groupParticipants: async () => [], addParticipant: async () => ({}), removeParticipant: async () => ({}),
  } as unknown as EvolutionClient;
  return { client, sent };
}

describe("execução do plano de grupo", () => {
  const noSleep = async () => {};
  const plan = [
    { code: "1", groupId: "111@g.us", text: "oi", delayMs: 0 },
    { code: "2", groupId: "222@g.us", text: "oi", delayMs: 10 },
    { code: "3", groupId: "333@g.us", text: "oi", delayMs: 20 },
  ];
  const dia = new Date("2026-10-15T12:00:00Z"); // 09h local, fora do silêncio

  it("sessão conectada envia a todos e registra entrega", async () => {
    const { client, sent } = fakeClient(true);
    const r = await runGroupPlan(db, plan, client, { sleep: noSleep, event: "QUEUE_OPEN", now: dia });
    expect(r).toEqual({ sent: 3, suppressed: 0, failed: 0 });
    expect(sent).toEqual(["111@g.us", "222@g.us", "333@g.us"]);
  });

  it("BREAKER: sessão caída não envia nada e marca tudo como suprimido", async () => {
    const { client, sent } = fakeClient(false);
    const r = await runGroupPlan(db, plan, client, { sleep: noSleep, now: dia });
    expect(r).toEqual({ sent: 0, suppressed: 3, failed: 0 });
    expect(sent).toEqual([]);
  });

  it("silêncio noturno suprime o envio de grupo", async () => {
    const { client } = fakeClient(true);
    const madrugada = new Date("2026-10-15T06:00:00Z"); // 03h local
    const r = await runGroupPlan(db, plan, client, { sleep: noSleep, now: madrugada });
    expect(r.suppressed).toBe(3); expect(r.sent).toBe(0);
  });

  it("falha de envio num grupo não derruba os outros", async () => {
    const sent: string[] = [];
    const client = {
      health: async () => ({ connected: true }),
      sendGroupText: async (groupId: string) => {
        if (groupId === "222@g.us") throw new Error("timeout");
        sent.push(groupId); return {};
      },
    } as unknown as EvolutionClient;
    const r = await runGroupPlan(db, plan, client, { sleep: noSleep, now: dia });
    expect(r).toEqual({ sent: 2, suppressed: 0, failed: 1 });
  });
});
