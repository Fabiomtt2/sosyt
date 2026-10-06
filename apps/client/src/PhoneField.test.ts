import { describe, expect, it } from "vitest";
import { isCompletePhoneField } from "./PhoneField";

describe("PhoneField", () => {
  it("aceita celular brasileiro com DDD real e nono dígito", () => {
    expect(isCompletePhoneField("+5571992679840")).toBe(true);
  });

  it("rejeita DDD brasileiro inexistente e celular sem nono dígito", () => {
    expect(isCompletePhoneField("+5570992679840")).toBe(false);
    expect(isCompletePhoneField("+557192679840")).toBe(false);
  });

  it("aceita número internacional válido fora do Brasil", () => {
    expect(isCompletePhoneField("+12025550187")).toBe(true);
  });
});
