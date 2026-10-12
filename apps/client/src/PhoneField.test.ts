import { describe, expect, it } from "vitest";
import { countriesForPhoneSearch, isCompletePhoneField, splitPhoneEntry } from "./PhoneField";

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

describe("telefone colado e preenchimento automático",()=>{
  it("mantém os nove dígitos separados dos seletores",()=>{
    expect(splitPhoneEntry("99999-1234","BR","71")).toEqual({country:"BR",ddd:"71",subscriber:"999991234"});
  });
  it.each(["+55 (71) 99999-1234","5571999991234","71 99999-1234","0055 71 99999-1234"])("separa o telefone completo %s",raw=>{
    expect(splitPhoneEntry(raw,"BR","11")).toEqual({country:"BR",ddd:"71",subscriber:"999991234"});
    expect(splitPhoneEntry(raw)).toEqual({country:"BR",ddd:"71",subscriber:"999991234"});
  });
  it("preserva excesso de dígitos para rejeitar, sem formar outro telefone válido",()=>{
    const result=splitPhoneEntry("9999912340","BR","71");
    expect(result.subscriber).toBe("9999912340");
    expect(isCompletePhoneField("+5571"+result.subscriber)).toBe(false);
  });
  it("não inventa país para número local e preserva número estrangeiro completo",()=>{
    expect(splitPhoneEntry("999991234")).toEqual({country:undefined,ddd:"",subscriber:"999991234"});
    expect(splitPhoneEntry("+1 (202) 555-0187","BR","71")).toEqual({country:"US",ddd:"",subscriber:"2025550187"});
  });
});
