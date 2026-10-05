import { describe, expect, it } from "vitest";
import { isBrazilMobile, normalizeBrazilMobile } from "./phone.js";

describe("normalização móvel brasileira", () => {
  it("canoniza formato nacional e internacional", () => {
    expect(normalizeBrazilMobile("71 99999-0001")).toBe("5571999990001");
    expect(normalizeBrazilMobile("+55 71 [9]9999-0001")).toBe("5571999990001");
  });

  it("rejeita celular incompleto", () => {
    expect(isBrazilMobile("+55 71 [9]999-0002")).toBe(false);
  });
});
