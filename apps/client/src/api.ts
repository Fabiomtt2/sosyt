const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3333";

export class ApiError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = localStorage.getItem("conexao_token");
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      ...(options.body !== undefined ? { "content-type": "application/json" } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...options.headers
    }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new ApiError(payload.message ?? "Não foi possível concluir a operação.", response.status);
  return payload as T;
}

export const api = {
  requestCode: (body: { name: string; phone: string; groupCode: string }) => request<{ devCode?: string }>("/auth/request-code", { method: "POST", body: JSON.stringify(body) }),
  verifyCode: (body: { phone: string; code: string }) => request<{ token: string }>("/auth/verify", { method: "POST", body: JSON.stringify(body) }),
  dashboard: () => request<Dashboard>("/dashboard"),
  submit: (url: string) => request("/rounds/current/submissions", { method: "POST", body: JSON.stringify({ url }) }),
  createPix: (email: string, cpf: string) => request<Pix>("/payments/pix", { method: "POST", body: JSON.stringify({ email, cpf }) }),
  paymentStatus: (id: string) => request<{ id: string; status: string }>(`/payments/${id}`),
  approveDemoPix: (id: string) => request(`/payments/${id}/demo-approve`, { method: "POST" }),
  youtubeConnect: (returnTo: "web" | "app") => request<{ url: string }>(`/youtube/connect?returnTo=${returnTo}`),
  exportRound: (id: string) => request<{ playlistId: string }>(`/rounds/${id}/export`, { method: "POST" })
};

export type Slot = { userId?: string; slot: number; youtubeUrl?: string; videoId?: string; userName?: string; groupCode?: string; createdAt?: string };
export type Round = { id: string; sequence: number; status: "OPEN" | "READY"; slots: Slot[]; completedAt?: string; export?: { status: string; playlistId?: string } };
export type Dashboard = {
  user: { id: string; name: string; phone: string; groupCode: string };
  wallet: { promo: number; purchased: number; reward: number; total: number; extraPasses: number; paymentHold: boolean };
  openRound: Round;
  readyRounds: Round[];
  viewer: { contributionsInOpenRound: number; youtubeConnected: boolean };
};
export type Pix = { id: string; providerPaymentId: string; status: string; qrCode?: string; qrCodeBase64?: string; ticketUrl?: string };


export type OwnerOverview = {
  month: string; owner: { name: string; groupCode: string };
  metrics: { registeredUsers: number; activeUsers30d: number; approvedMembers: number; requestsTotal: number; pendingRequests: number; requestsMonth: number; completedCyclesMonth: number; playlistsCreatedMonth: number; approvedPurchasesMonth: number; demoPurchasesMonth: number; revenueCentsMonth: number };
  groups: Array<{ code: string; enabled: number }>;
  requests: Array<{ id: string; name: string; phone: string; preferredGroup?: string; status: string; createdAt: string }>;
  users: Array<{ id: string; name: string; phone: string; groupCode: string; lastSeenAt?: string; balanceMillis: number; extraPasses: number; paymentHold: number }>;
  members: Array<{ phone: string; groupCode: string; revokedAt?: string }>;
  purchases: Array<{ id: string; name: string; phone: string; provider: string; status: string; amountCents: number; createdAt: string }>;
};
function ownerRequest<T>(path: string, options: RequestInit = {}) {
  return request<T>(path, { ...options, headers: { ...options.headers, authorization: `Bearer ${localStorage.getItem("conexao_owner_token") ?? ""}` } });
}
export const ownerApi = {
  login: (body: { name: string; identifier: string; groupCode: "0"; secret: string }) => request<{ token: string; role: "owner" }>("/admin/login", { method: "POST", body: JSON.stringify(body) }),
  overview: (month: string) => ownerRequest<OwnerOverview>(`/admin/overview?month=${month}`),
  group: (code: string, enabled: boolean) => ownerRequest("/admin/groups", { method: "POST", body: JSON.stringify({ code, enabled }) }),
  approveMember: (phone: string, groupCode: string) => ownerRequest("/admin/members", { method: "POST", body: JSON.stringify({ phone, groupCode }) }),
  revoke: (phone: string) => ownerRequest(`/admin/members/${phone}`, { method: "DELETE" }),
  decide: (id: string, status: "APPROVED" | "DECLINED", groupCode?: string) => ownerRequest(`/admin/requests/${id}/decision`, { method: "POST", body: JSON.stringify({ status, groupCode }) }),
  exportUsers: async () => {
    const result = await fetch(`${API_URL}/admin/users.csv`, { headers: { authorization: `Bearer ${localStorage.getItem("conexao_owner_token") ?? ""}` } });
    if (!result.ok) throw new ApiError("Não foi possível exportar os usuários.", result.status);
    const url = URL.createObjectURL(await result.blob());
    const link = document.createElement("a"); link.href = url; link.download = "conexao-usuarios.csv"; link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
};
export const participationApi = {
  groups: () => request<{ groups: string[]; ownerContactAvailable: boolean; membershipRequired: boolean }>("/public/groups"),
  join: (body: { name: string; phone: string; groupCode?: string; consent: boolean }) => request<{ message: string; whatsappUrl?: string; alreadyApproved?: boolean }>("/participation/request", { method: "POST", body: JSON.stringify(body) })
};
