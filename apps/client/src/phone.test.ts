import { describe, expect, it } from "vitest";
import { formatInternationalPhoneInput, isCompleteInternationalPhone } from "./phone";

describe("WhatsApp internacional", () => {
  it("não força +55 nem país ao começar a digitação", () => {
    expect(formatInternationalPhoneInput("5")).toBe("5");
    expect(formatInternationalPhoneInput("+1 202 555 0187")).toBe("+1 202 555 0187");
    expect(formatInternationalPhoneInput("+351 912 345 678")).toBe("+351 912 345 678");
  });

  it("aceita números completos de diferentes países", () => {
    expect(isCompleteInternationalPhone("+55 71 99999-0001")).toBe(true);
    expect(isCompleteInternationalPhone("+1 202 555 0187")).toBe(true);
    expect(isCompleteInternationalPhone("+351 912 345 678")).toBe(true);
    expect(isCompleteInternationalPhone("+1 20")).toBe(false);
  });
});
