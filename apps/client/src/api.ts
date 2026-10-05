const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3333";

export class ApiError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = localStorage.getItem("conexao_token");
  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      ...options,
      headers: {
        ...(options.body !== undefined ? { "content-type": "application/json" } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...options.headers
      }
    });
  } catch {
    throw new ApiError("Não conseguimos conectar ao SOS YouTube agora. Verifique sua internet e tente novamente. Se o problema continuar, o serviço pode estar temporariamente indisponível.", 0);
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new ApiError(payload.message ?? "Não foi possível concluir a operação.", response.status);
  return payload as T;
}

export const api = {
  resolveRole: (body: { name: string; phone: string }) => request<{ role: "user" | "owner" }>("/auth/role", { method: "POST", body: JSON.stringify(body) }),
  requestCode: (body: { name: string; phone: string; groupCode: string }) => request<{ devCode?: string }>("/auth/request-code", { method: "POST", body: JSON.stringify(body) }),
  verifyCode: (body: { phone: string; code: string }) => request<{ token: string }>("/auth/verify", { method: "POST", body: JSON.stringify(body) }),
  dashboard: () => request<Dashboard>("/dashboard"),
  submit: (url: string) => request("/rounds/current/submissions", { method: "POST", body: JSON.stringify({ url }) }),
  createPix: (email: string, cpf: string) => request<Pix>("/payments/pix", { method: "POST", body: JSON.stringify({ email, cpf }) }),
  paymentStatus: (id: string) => request<{ id: string; status: string }>(`/payments/${id}`),
  approveDemoPix: (id: string) => request(`/payments/${id}/demo-approve`, { method: "POST" }),
  youtubeConnect: (returnTo: "web" | "app", roundId?: string) => request<{ url: string }>(`/youtube/connect?returnTo=${returnTo}${roundId ? `&roundId=${encodeURIComponent(roundId)}` : ""}`),
  exportRound: (id: string) => request<{ playlistId: string }>(`/rounds/${id}/export`, { method: "POST" }),
  saveWatchProgress: (id: string, progress: Pick<WatchProgressState, "watchedSeconds" | "durations">) =>
    request<WatchProgressState>(`/rounds/${id}/watch-progress`, { method: "PUT", body: JSON.stringify(progress) })
};

export type Slot = { userId?: string; slot: number; youtubeUrl?: string; videoId?: string; userName?: string; groupCode?: string; createdAt?: string };
export type WatchProgressState = { watchedSeconds: number[]; durations: number[]; percent: number; rewardCoins?: number; rewardDeltaCoins?: number; walletTotal?: number; updatedAt?: string };
export type Round = { id: string; sequence: number; status: "OPEN" | "READY"; slots: Slot[]; completedAt?: string; export?: { status: string; playlistId?: string; addedCount?: number; watchProgress?: WatchProgressState } };
export type Dashboard = {
  user: { id: string; name: string; phone: string; groupCode: string };
  wallet: { promo: number; purchased: number; reward: number; total: number; extraPasses: number; paymentHold: boolean };
  openRound: Round;
  readyRounds: Round[];
  viewer: { contributionsInOpenRound: number; youtubeConnected: boolean };
};
export type Pix = { id: string; providerPaymentId: string; status: string; qrCode?: string; qrCodeBase64?: string; ticketUrl?: string };


export type OwnerOverview = {
  whatsapp: { configured: boolean; otpConfigured: boolean; ownerAlertsConfigured: boolean; decisionTemplateConfigured: boolean; groupsSyncEnabled: boolean; groupsLinked: number; automaticMemberships: number; queued: number; failed: number; sent: number; membershipMode: string };
  month: string; owner: { name: string; groupCode: string };
  metrics: { registeredUsers: number; activeUsers30d: number; approvedMembers: number; requestsTotal: number; pendingRequests: number; requestsMonth: number; completedCyclesMonth: number; playlistsCreatedMonth: number; approvedPurchasesMonth: number; demoPurchasesMonth: number; revenueCentsMonth: number };
  groups: Array<{ code: string; enabled: number; whatsappGroupId?: string; membershipMode?: string; lastSyncedAt?: string }>;
  requests: Array<{ id: string; name: string; phone: string; preferredGroup?: string; status: string; source?: string; whatsappVerifiedAt?: string; createdAt: string }>;
  users: Array<{ id: string; name: string; phone: string; groupCode: string; lastSeenAt?: string; balanceMillis: number; extraPasses: number; paymentHold: number }>;
  members: Array<{ phone: string; groupCode: string; revokedAt?: string; source?: string }>;
  purchases: Array<{ id: string; name: string; phone: string; provider: string; status: string; amountCents: number; createdAt: string }>;
};
function ownerRequest<T>(path: string, options: RequestInit = {}) {
  return request<T>(path, { ...options, headers: { ...options.headers, authorization: `Bearer ${localStorage.getItem("conexao_owner_token") ?? ""}` } });
}
export const ownerApi = {
  login: (body: { name: string; identifier: string; groupCode: "#"; secret: string }) => request<{ token: string; role: "owner" }>("/admin/login", { method: "POST", body: JSON.stringify(body) }),
  overview: (month: string) => ownerRequest<OwnerOverview>(`/admin/overview?month=${month}`),
  group: (code: string, enabled: boolean) => ownerRequest("/admin/groups", { method: "POST", body: JSON.stringify({ code, enabled }) }),
  approveMember: (phone: string, groupCode: string) => ownerRequest("/admin/members", { method: "POST", body: JSON.stringify({ phone, groupCode }) }),
  retryWhatsApp: () => ownerRequest("/admin/whatsapp/retry", { method: "POST" }),
  syncWhatsAppGroups: () => ownerRequest<{ discovered: number; linked: number; memberships: number }>("/admin/whatsapp/groups/sync", { method: "POST" }),
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
  groups: () => request<{ groups: string[]; ownerContactAvailable: boolean; membershipRequired: boolean; whatsappJoinUrl?: string }>("/public/groups"),
  join: (body: { name: string; phone: string; groupCode?: string; consent: boolean }) => request<{ message: string; whatsappUrl?: string; alreadyApproved?: boolean }>("/participation/request", { method: "POST", body: JSON.stringify(body) })
};
