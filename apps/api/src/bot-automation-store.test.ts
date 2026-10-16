// AUDITORIA / HYBRID+ — testes da camada do Owner (persistência, validação, auditoria).
//
// Cobrem explicitamente os achados da reauditoria: identificação mínima em grupo
// (nunca telefone), placeholder com acento rejeitado no save, e trilha de quem mudou.
import Database from "better-sqlite3";
import { beforeEach, describe, expect, it } from "vitest";
import type { AppDatabase } from "./db.js";
import { automationMeta, renderTemplate } from "./bot-automations.js";
import {
  AutomationValidationError, automationAudit, automationSettings, ensureBotAutomations,
  listAutomationSettings, resetAutomationSettings, saveAutomationSettings, validateAutomationText,
} from "./bot-automation-store.js";

let db: AppDatabase;
beforeEach(() => {
  db = new Database(":memory:") as AppDatabase;
  ensureBotAutomations(db);
});

const OWNER = { id: "own-1", name: "Fábio" };

describe("HYBRID+ / padrão de fábrica", () => {
  it("sem nada salvo, devolve o padrão do catálogo e marca customized=false", () => {
    const s = automationSettings(db, "WELCOME_MEMBER");
    const meta = automationMeta("WELCOME_MEMBER");
    expect(s.customized).toBe(false);
    expect(s.text).toBe(meta.defaultText);
    expect(s.enabled).toBe(meta.defaultEnabled);
    expect(s.channel).toBe(meta.defaultChannel);
  });

  it("lista o catálogo inteiro", () => {
    expect(listAutomationSettings(db)).toHaveLength(22);
  });
});

describe("HYBRID+ / regra: identificação mínima em grupo", () => {
  it("rejeita telefone em mensagem de GRUPO", () => {
    expect(() => validateAutomationText("UPLOAD_NOTICE", "{nome} ({numero}) enviou", "GROUP"))
      .toThrow(AutomationValidationError);
    try {
      validateAutomationText("UPLOAD_NOTICE", "{nome} ({numero})", "GROUP");
    } catch (cause) {
      expect((cause as AutomationValidationError).code).toBe("PERSONAL_DATA_IN_GROUP");
    }
  });

  it("rejeita {telefone} e {whatsapp} também, e em ALL_GROUPS", () => {
    for (const key of ["telefone", "whatsapp", "phone"]) {
      expect(() => validateAutomationText("QUEUE_OPEN", `fila {fila} {${key}}`, "ALL_GROUPS"))
        .toThrow(AutomationValidationError);
    }
  });

  it("aceita nome, sala e posição — a identificação que o dono autorizou", () => {
    const meta = automationMeta("UPLOAD_NOTICE");
    expect(meta.placeholders).toEqual(["nome", "sala", "posicao", "aba", "fila", "url"]);
    expect(meta.placeholders).not.toContain("numero");
    expect(() => validateAutomationText(
      "UPLOAD_NOTICE", "{nome} — sala {sala}, posição {posicao} — aba {aba} da fila {fila}", "GROUP",
    )).not.toThrow();
  });

  it("o texto padrão do catálogo não vaza dado pessoal em nenhum evento de grupo", () => {
    for (const s of listAutomationSettings(db)) {
      if (s.target === "GROUP" || s.target === "ALL_GROUPS") {
        expect(() => validateAutomationText(s.event, s.text, s.target), s.event).not.toThrow();
      }
    }
  });

  it("o save BLOQUEIA de verdade, não só avisa", () => {
    expect(() => saveAutomationSettings(db, "UPLOAD_NOTICE", { text: "{nome} {numero}" }, OWNER))
      .toThrow(AutomationValidationError);
    // nada foi gravado
    expect(automationSettings(db, "UPLOAD_NOTICE").customized).toBe(false);
  });
});

describe("HYBRID+ / regra: placeholder inválido é erro no save", () => {
  it("rejeita campo com acento, que chegaria literal ao membro", () => {
    // `{nível}` não casa com a regex \w do render — é a armadilha real.
    expect(renderTemplate("{nível}", { nivel: 3 })).toBe("{nível}");
    try {
      saveAutomationSettings(db, "LEVEL_UP", { text: "Parabéns {nome}, nível {nível}!" }, OWNER);
      throw new Error("deveria ter lançado");
    } catch (cause) {
      expect((cause as AutomationValidationError).code).toBe("UNKNOWN_PLACEHOLDER");
      expect((cause as Error).message).toMatch(/não usam acento/);
      expect((cause as Error).message).toContain("{nível}");
    }
  });

  it("aceita o campo correto sem acento", () => {
    const saved = saveAutomationSettings(db, "LEVEL_UP", { text: "Parabéns {nome}, nível {nivel}!" }, OWNER);
    expect(saved.text).toBe("Parabéns {nome}, nível {nivel}!");
    expect(saved.customized).toBe(true);
  });

  it("rejeita texto vazio e texto acima do limite do WhatsApp", () => {
    expect(() => saveAutomationSettings(db, "QUEUE_COMPLETE", { text: "   " }, OWNER)).toThrow(/vazia/);
    expect(() => saveAutomationSettings(db, "QUEUE_COMPLETE", { text: "a".repeat(5000) }, OWNER)).toThrow(/limite/);
  });
});

describe("HYBRID+ / canal x alvo", () => {
  it("grupo exige Evolution", () => {
    expect(() => saveAutomationSettings(db, "QUEUE_OPEN", { channel: "OFFICIAL", target: "ALL_GROUPS" }, OWNER))
      .toThrow(/Evolution/);
  });

  it("privado exige canal oficial", () => {
    expect(() => saveAutomationSettings(db, "WELCOME_DM", { channel: "EVOLUTION", target: "MEMBER" }, OWNER))
      .toThrow(/oficial/);
  });
});

describe("HYBRID+ / intervalo dos periódicos", () => {
  it("rejeita intervalo curto demais (o bot abafaria o grupo)", () => {
    expect(() => saveAutomationSettings(db, "QUEUE_STATUS", { intervalMinutes: 5 }, OWNER))
      .toThrow(/15 minutos/);
  });

  it("aceita e guarda um intervalo válido", () => {
    expect(saveAutomationSettings(db, "QUEUE_STATUS", { intervalMinutes: 720 }, OWNER).intervalMinutes).toBe(720);
  });

  it("evento não periódico não guarda intervalo", () => {
    expect(saveAutomationSettings(db, "QUEUE_COMPLETE", { enabled: false }, OWNER).intervalMinutes).toBeUndefined();
  });
});

describe("HYBRID+ / auditoria: quem mudou o quê", () => {
  it("registra cada campo alterado com antes e depois", () => {
    saveAutomationSettings(db, "WELCOME_MEMBER", { text: "Bem-vindo {nome}!", enabled: false }, OWNER);
    const trail = automationAudit(db, "WELCOME_MEMBER");
    const fields = trail.map((t) => t.field).sort();
    expect(fields).toEqual(["enabled", "text"]);
    const textChange = trail.find((t) => t.field === "text")!;
    expect(textChange.after).toBe("Bem-vindo {nome}!");
    expect(textChange.before).toBe(automationMeta("WELCOME_MEMBER").defaultText);
    expect(textChange.actorName).toBe("Fábio");
  });

  it("não registra nada quando nada mudou", () => {
    const meta = automationMeta("QUEUE_OPEN");
    saveAutomationSettings(db, "QUEUE_OPEN", { text: meta.defaultText, enabled: meta.defaultEnabled }, OWNER);
    expect(automationAudit(db, "QUEUE_OPEN")).toHaveLength(0);
  });

  it("o reset volta ao padrão e fica registrado", () => {
    saveAutomationSettings(db, "PINNED_MESSAGE", { text: "Regras do grupo {grupo}" }, OWNER);
    const back = resetAutomationSettings(db, "PINNED_MESSAGE", OWNER);
    expect(back.customized).toBe(false);
    expect(back.text).toBe(automationMeta("PINNED_MESSAGE").defaultText);
    expect(automationAudit(db, "PINNED_MESSAGE").some((t) => t.field === "reset")).toBe(true);
  });
});

describe("HYBRID+ / evento inexistente", () => {
  it("save e reset recusam evento fora do catálogo", () => {
    expect(() => saveAutomationSettings(db, "NAO_EXISTE", { enabled: true }, OWNER)).toThrow(/não existe/);
    expect(() => resetAutomationSettings(db, "NAO_EXISTE", OWNER)).toThrow(/não existe/);
  });
});
