import { describe, expect, it } from "vitest";
import { countriesForPhoneSearch, isCompletePhoneField } from "./PhoneField";

describe("PhoneField", () => {
  it("aceita celular brasileiro com DDD real e nono dígito", () => {
    expect(isCompletePhoneField("+5571999991234")).toBe(true);
  });

  it("rejeita DDD brasileiro inexistente e celular sem nono dígito", () => {
    expect(isCompletePhoneField("+5570999991234")).toBe(false);
    expect(isCompletePhoneField("+557199991234")).toBe(false);
  });

  it("aceita número internacional válido fora do Brasil", () => {
    expect(isCompletePhoneField("+12025550187")).toBe(true);
  });

  it("varre DDI por prefixo como o motor de DDD", () => {
    const withFive=countriesForPhoneSearch("5");
    expect(withFive.length).toBeGreaterThan(1);
    expect(withFive.every((item)=>item.callingCode.startsWith("5"))).toBe(true);

    const withFiftyFive=countriesForPhoneSearch("55");
    expect(withFiftyFive.some((item)=>item.country==="BR" && item.callingCode==="55")).toBe(true);
    expect(withFiftyFive.every((item)=>item.callingCode.startsWith("55"))).toBe(true);

    expect(countriesForPhoneSearch("Brasil").some((item)=>item.country==="BR")).toBe(true);
  });
});
