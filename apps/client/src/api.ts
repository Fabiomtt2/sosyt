const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3333";

export class ApiError extends Error {}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = localStorage.getItem("conexao_token");
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...options.headers
    }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new ApiError(payload.message ?? "Não foi possível concluir a operação.");
  return payload as T;
}

export const api = {
  requestCode: (body: { name: string; phone: string; groupCode: string }) => request<{ devCode?: string }>("/auth/request-code", { method: "POST", body: JSON.stringify(body) }),
  verifyCode: (body: { phone: string; code: string }) => request<{ token: string }>("/auth/verify", { method: "POST", body: JSON.stringify(body) }),
  dashboard: () => request<Dashboard>("/dashboard"),
  submit: (url: string) => request("/rounds/current/submissions", { method: "POST", body: JSON.stringify({ url }) }),
  createPix: (email: string, cpf: string) => request<Pix>("/payments/pix", { method: "POST", body: JSON.stringify({ email, cpf }) }),
  approveDemoPix: (id: string) => request(`/payments/${id}/demo-approve`, { method: "POST" }),
  youtubeConnect: (returnTo: "web" | "app") => request<{ url: string }>(`/youtube/connect?returnTo=${returnTo}`),
  exportRound: (id: string) => request<{ playlistId: string }>(`/rounds/${id}/export`, { method: "POST" })
};

export type Slot = { slot: number; youtubeUrl?: string; videoId?: string; userName?: string; groupCode?: string; createdAt?: string };
export type Round = { id: string; sequence: number; status: "OPEN" | "READY"; slots: Slot[]; completedAt?: string; export?: { status: string; playlistId?: string } };
export type Dashboard = {
  user: { id: string; name: string; phone: string; groupCode: string };
  wallet: { promo: number; purchased: number; reward: number; total: number; extraPasses: number };
  openRound: Round;
  readyRounds: Round[];
  viewer: { contributionsInOpenRound: number; youtubeConnected: boolean };
};
export type Pix = { id: string; providerPaymentId: string; status: string; qrCode?: string; qrCodeBase64?: string; ticketUrl?: string };

