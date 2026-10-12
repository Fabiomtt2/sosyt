// AUDITORIA / saúde do número Business: classificação de cenários reais
// (ban, token revogado, qualidade RED/YELLOW) e recomendação de troca.
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { classify, checkNumberHealth, lastNumberHealth, REPLACEMENT_STEPS } from "./number-health.js";
import { createDatabase, type AppDatabase } from "./db.js";
import { loadConfig, type Config } from "./config.js";

describe("saúde do número Business", () => {
  let db: AppDatabase; let config: Config;
  beforeEach(() => {
    config = loadConfig({ NODE_ENV: "test", DATABASE_PATH: ":memory:", JWT_SECRET: "nh-secret-32-characters-okay!!!!!", AUTH_CODE_PEPPER: "nh-pepper-32-characters-okay!!!!!", YOUTUBE_API_KEY: undefined });
    db = createDatabase(":memory:");
  });
  afterEach(() => db.close());

  it("número sumiu do WABA => banido, recomenda TROCA", () => {
    const v = classify({ httpOk: true, httpStatus: 200, found: false });
    expect(v.status).toBe("UNUSABLE");
    expect(v.shouldReplaceNumber).toBe(true);
    expect(v.recommendation).toMatch(/Troque o número/i);
  });

  it("status BANNED/RESTRICTED => inutilizável, recomenda TROCA", () => {
    for (const platform of ["BANNED", "RESTRICTED", "DISABLED"]) {
      const v = classify({ httpOk: true, httpStatus: 200, found: true, platform });
      expect(v.status).toBe("UNUSABLE");
      expect(v.shouldReplaceNumber).toBe(true);
    }
  });

  it("qualidade RED => degradado e já sugere preparar troca", () => {
    const v = classify({ httpOk: true, httpStatus: 200, found: true, quality: "RED" });
    expect(v.status).toBe("DEGRADED");
    expect(v.shouldReplaceNumber).toBe(true);
  });

  it("qualidade YELLOW => degradado, mas ainda NÃO troca", () => {
    const v = classify({ httpOk: true, httpStatus: 200, found: true, quality: "YELLOW" });
    expect(v.status).toBe("DEGRADED");
    expect(v.shouldReplaceNumber).toBe(false);
  });

  it("token revogado (401/code 190) => credencial, NÃO é ban do número", () => {
    const v = classify({ httpOk: false, httpStatus: 401, errorCode: 190, found: false });
    expect(v.status).toBe("UNUSABLE");
    expect(v.shouldReplaceNumber).toBe(false);          // o número segue válido
    expect(v.recommendation).toMatch(/System User Access Token/i);
  });

  it("número saudável => HEALTHY sem ação", () => {
    const v = classify({ httpOk: true, httpStatus: 200, found: true, quality: "GREEN", platform: "CONNECTED" });
    expect(v.status).toBe("HEALTHY");
    expect(v.shouldReplaceNumber).toBe(false);
  });

  it("sem integração configurada => UNKNOWN e persiste o diagnóstico", async () => {
    const health = await checkNumberHealth(db, config, {});
    expect(health.status).toBe("UNKNOWN");
    expect(health.detail).toMatch(/não configurada/i);
    expect(lastNumberHealth(db)?.status).toBe("UNKNOWN");   // painel lê sem bater na Meta
  });

  it("passo a passo da troca orienta número descartável", () => {
    expect(REPLACEMENT_STEPS[0]).toMatch(/descartável/i);
    expect(REPLACEMENT_STEPS.join(" ")).toMatch(/Phone Number ID/);
  });
});
