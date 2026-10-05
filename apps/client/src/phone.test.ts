import { describe, expect, it } from "vitest";
import { formatBrazilMobileInput, isCompleteBrazilMobile } from "./phone";

describe("telefone móvel brasileiro", () => {
  it("formata DDI, DDD e nono dígito obrigatório", () => {
    expect(formatBrazilMobileInput("5571999990001")).toBe("+55 71 [9]9999-0001");
    expect(formatBrazilMobileInput("+55 71 99999-0001")).toBe("+55 71 [9]9999-0001");
  });

  it("aceita somente móvel brasileiro completo como cadastro", () => {
    expect(isCompleteBrazilMobile("+55 71 [9]9999-0001")).toBe(true);
    expect(isCompleteBrazilMobile("+55 71 [9]999-0002")).toBe(false);
  });
});
