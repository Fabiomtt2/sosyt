import { describe, expect, it } from "vitest";
import { isInternationalPhone, normalizePhone, isBrazilMobile } from "./phone.js";

describe("normalização de WhatsApp", () => {
  it("canoniza separadores sem limitar o país", () => {
    expect(normalizePhone("+55 71 99999-0001")).toBe("5571999990001");
    expect(normalizePhone("+1 (202) 555-0187")).toBe("12025550187");
    expect(normalizePhone("+351 912 345 678")).toBe("351912345678");
  });

  it("mantém compatibilidade com celular brasileiro legado e valida E.164", () => {
    expect(normalizePhone("71 99999-0001")).toBe("5571999990001");
    expect(isBrazilMobile("+55 71 99999-0001")).toBe(true);
    expect(isInternationalPhone("+1 202 555 0187")).toBe(true);
    expect(isInternationalPhone("+1 20")).toBe(false);
  });
});
