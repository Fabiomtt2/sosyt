import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, ownerApi, ApiError } from "./api";

describe("contrato HTTP do cliente", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    vi.stubGlobal("localStorage", { getItem: (key: string) => key === "conexao_owner_token" ? "owner-token" : "participant-token" });
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) });
  });
  afterEach(() => { vi.unstubAllGlobals(); fetchMock.mockReset(); });
  it("POST de aprovação e exportação sem corpo não declaram JSON vazio", async () => {
    await api.approveDemoPix("payment"); await api.exportRound("cycle");
    for (const [, options] of fetchMock.mock.calls) {
      expect(options.method).toBe("POST");
      expect(options.headers["content-type"]).toBeUndefined();
      expect(options.headers.authorization).toBe("Bearer participant-token");
    }
  });
  it("ações administrativas usam somente o token Owner", async () => {
    await ownerApi.decide("request", "APPROVED");
    const [, options] = fetchMock.mock.calls[0];
    expect(options.headers.authorization).toBe("Bearer owner-token");
    expect(options.headers["content-type"]).toBe("application/json");
    expect(JSON.parse(options.body)).toEqual({ status: "APPROVED" });
  });
  it("preserva status e mensagem de erro para decisão de sessão", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 403, json: async () => ({ message: "Acesso revogado" }) });
    await expect(api.dashboard()).rejects.toMatchObject({ status: 403, message: "Acesso revogado" });
    await expect(api.dashboard()).rejects.toBeInstanceOf(ApiError);
  });

  it("traduz falha de rede para mensagem compreensível", async () => {
    fetchMock.mockRejectedValue(new TypeError("NetworkError attempting to fetch resource."));
    await expect(api.dashboard()).rejects.toMatchObject({
      status: 0,
      message: expect.stringContaining("Não conseguimos conectar ao SOS YouTube agora")
    });
  });
});
