const configuredApiUrl = (import.meta.env.VITE_API_URL as string | undefined)?.trim();
const isBrowser = typeof window !== "undefined";
const isLocalHost = !isBrowser || ["localhost", "127.0.0.1"].includes(window.location.hostname);
const API_URL = configuredApiUrl || (isLocalHost ? "http://localhost:3333" : "");

export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly data: Record<string, unknown> = {}) { super(message); }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  if (!API_URL) throw new ApiError("A versão pública do SOS YouTube está disponível, mas o servidor ainda não foi publicado. O Owner pode continuar configurando e testando localmente enquanto conectamos um backend HTTPS.", 0, { code: "PUBLIC_BACKEND_NOT_CONFIGURED" });
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
  if (!response.ok) throw new ApiError(payload.message ?? "Não foi possível concluir a operação.", response.status, payload as Record<string, unknown>);
  return payload as T;
}

export const api = {
  resolveRole: (body: { name: string; phone: string }) => request<{ role: "user" | "owner" }>("/auth/role", { method: "POST", body: JSON.stringify(body) }),
  login: (body: { name: string; phone: string; groupCode: string }) => request<{ token: string }>("/auth/login", { method: "POST", body: JSON.stringify(body) }),
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
    request<WatchProgressState>(`/rounds/${id}/watch-progress`, { method: "PUT", body: JSON.stringify(progress) }),
  finalizeWatchProgress: (id: string) =>
    request<{ finalizedAt: string; percent: number; cooldownUntil: string; secondsRemaining: number }>(`/rounds/${id}/watch-progress/finalize`, { method: "POST" })
};

export type Slot = { userId?: string; slot: number; youtubeUrl?: string; videoId?: string; userName?: string; groupCode?: string; createdAt?: string };
export type WatchProgressState = { watchedSeconds: number[]; durations: number[]; percent: number; rewardCoins?: number; rewardDeltaCoins?: number; walletTotal?: number; finalizedAt?: string; finalizeReason?: string; cooldownUntil?: string; secondsRemaining?: number; updatedAt?: string };
export type Round = { id: string; sequence: number; status: "OPEN" | "READY"; slots: Slot[]; completedAt?: string; export?: { status: string; playlistId?: string; addedCount?: number; watchProgress?: WatchProgressState } };
export type Dashboard = {
  user: { id: string; name: string; phone: string; groupCode: string };
  wallet: { promo: number; purchased: number; reward: number; total: number; extraPasses: number; paymentHold: boolean };
  openRound: Round;
  readyRounds: Round[];
  viewer: { contributionsInOpenRound: number; youtubeConnected: boolean };
};
export type Pix = { id: string; providerPaymentId: string; status: string; qrCode?: string; qrCodeBase64?: string; ticketUrl?: string };


export type WhatsAppIntegrationState = {
  mode: "OFFICIAL" | "META_GROUPS" | "EVOLUTION" | "DISABLED";
  businessAccountId: string;
  phoneNumberId: string;
  businessPhone: string;
  graphVersion: string;
  accessTokenConfigured: boolean;
  appSecretConfigured: boolean;
  verifyTokenConfigured: boolean;
  tokenValidatedAt?: string;
  validatedDisplayPhone?: string;
  wppUrl: string;
  wppSession: string;
  wppTokenConfigured: boolean;
  evolutionUrl: string;
  evolutionInstance: string;
  evolutionApiKeyConfigured: boolean;
  officialReady: boolean;
  webhookUrl: string;
};
export type OwnerVersion = { appVersion: string; gitSha: string; dirty: boolean };
export type GroupVerificationState = { required: boolean; accessReady: boolean; memberVerified: boolean; ownerAdminVerified: boolean; provider?: string };
export type OwnerParticipant = {
  id: string; userId?: string; name: string; phone: string; groupCode: string; createdAt?: string; lastSeenAt?: string;
  cooldownUntil?: string; cooldownReason?: string; balanceMillis: number; promoMillis: number; purchasedMillis: number; rewardMillis: number;
  extraPasses: number; paymentHold: number; approvedAt?: string; approvedByOwnerId?: string; approvedByOwnerName?: string;
  revokedAt?: string; source?: string; requestStatus?: string; requestSource?: string;
};
export type ParticipantAdminDetail = {
  profile: { name: string; phone: string; groupCode?: string; userId?: string; createdAt?: string; lastSeenAt?: string; cooldownUntil?: string; cooldownReason?: string };
  membership?: { phone: string; groupCode: string; approvedAt?: string; revokedAt?: string; source?: string; approvedByOwnerId?: string; approvedByOwnerName?: string };
  request?: { id: string; name: string; phone: string; preferredGroup?: string; status: string; source?: string; whatsappVerifiedAt?: string; retryBlockUntil?: string; approvedAt?: string; approvedByOwnerId?: string; approvedByOwnerName?: string; createdAt?: string; updatedAt?: string };
  wallet?: { promoMillis: number; purchasedMillis: number; rewardMillis: number; extraPasses: number; paymentHold: number; updatedAt?: string };
  purchases: Array<{ id: string; provider: string; status: string; amountCents: number; creditsMillis: number; extraPasses: number; createdAt: string; approvedAt?: string; providerPaymentId?: string }>;
  ledger: Array<{ id: string; kind: string; amountMillis: number; referenceId?: string; note?: string; actorOwnerName?: string; createdAt: string }>;
  activity: { submissions: number; playlists: number };
  verification?: GroupVerificationState;
};
export type OwnerOverview = {
  whatsapp: { configured: boolean; otpConfigured: boolean; ownerAlertsConfigured: boolean; decisionTemplateConfigured: boolean; groupsSyncEnabled: boolean; groupsLinked: number; automaticMemberships: number; queued: number; failed: number; sent: number; membershipMode: string; integration: WhatsAppIntegrationState };
  version: OwnerVersion;
  month: string; owner: { name: string; canonicalName?: string; groupCode: string };
  metrics: { registeredUsers: number; activeUsers30d: number; approvedMembers: number; requestsTotal: number; pendingRequests: number; requestsMonth: number; completedCyclesMonth: number; playlistsCreatedMonth: number; approvedPurchasesMonth: number; demoPurchasesMonth: number; revenueCentsMonth: number };
  groups: Array<{ code: string; enabled: number; whatsappGroupId?: string; membershipMode?: string; lastSyncedAt?: string }>;
  requests: Array<{ id: string; name: string; phone: string; preferredGroup?: string; status: string; source?: string; whatsappVerifiedAt?: string; approvedAt?: string; approvedByOwnerId?: string; approvedByOwnerName?: string; createdAt: string; updatedAt?: string }>;
  users: OwnerParticipant[];
  members: Array<{ phone: string; groupCode: string; approvedAt?: string; approvedByOwnerId?: string; approvedByOwnerName?: string; revokedAt?: string; source?: string }>;
  purchases: Array<{ id: string; name: string; phone: string; provider: string; status: string; amountCents: number; createdAt: string }>;
};
function ownerRequest<T>(path: string, options: RequestInit = {}) {
  return request<T>(path, { ...options, headers: { ...options.headers, authorization: `Bearer ${localStorage.getItem("conexao_owner_token") ?? ""}` } });
}
export const ownerApi = {
  login: (body: { name: string; identifier: string; groupCode: "#"; secret: string }) => request<{ token: string; role: "owner" }>("/admin/login", { method: "POST", body: JSON.stringify(body) }),
  overview: (month: string) => ownerRequest<OwnerOverview>(`/admin/overview?month=${month}`),
  group: (code: string, enabled: boolean) => ownerRequest("/admin/groups", { method: "POST", body: JSON.stringify({ code, enabled }) }),
  approveMember: (phone: string, groupCode: string, name?: string) => ownerRequest("/admin/members", { method: "POST", body: JSON.stringify({ phone, groupCode, name }) }),
  retryWhatsApp: () => ownerRequest("/admin/whatsapp/retry", { method: "POST" }),
  syncWhatsAppGroups: () => ownerRequest<{ discovered: number; linked: number; memberships: number }>("/admin/whatsapp/groups/sync", { method: "POST" }),
  whatsappIntegration: () => ownerRequest<WhatsAppIntegrationState>("/admin/integrations/whatsapp"),
  saveWhatsAppIntegration: (body: Partial<{
    mode: "OFFICIAL" | "META_GROUPS" | "EVOLUTION" | "DISABLED"; businessAccountId: string; phoneNumberId: string; businessPhone: string; graphVersion: string;
    accessToken: string; appSecret: string; verifyToken: string; wppUrl: string; wppSession: string; wppToken: string; evolutionUrl: string; evolutionInstance: string; evolutionApiKey: string;
  }>) => ownerRequest<WhatsAppIntegrationState>("/admin/integrations/whatsapp", { method: "POST", body: JSON.stringify(body) }),
  generateWhatsAppVerifyToken: () => ownerRequest<{ ok: true; verifyToken: string; state: WhatsAppIntegrationState }>("/admin/integrations/whatsapp/verify-token", { method: "POST" }),
  validateWhatsApp: () => ownerRequest<{ ok: true; validatedAt: string; phone: { id?: string; display_phone_number?: string; verified_name?: string; quality_rating?: string } }>("/admin/integrations/whatsapp/validate", { method: "POST" }),
  version: () => ownerRequest<OwnerVersion>("/admin/version"),
  participant: (phone: string) => ownerRequest<ParticipantAdminDetail>(`/admin/participants/${phone}`),
  updateParticipant: (currentPhone: string, body: { name: string; phone: string; groupCode: string }) => ownerRequest<{ ok: true; phone: string }>(`/admin/participants/${currentPhone}`, { method: "PATCH", body: JSON.stringify(body) }),
  participantAction: (phone: string, action: "REVOKE" | "RESTORE" | "CLEAR_COOLDOWN" | "REVIEW_ON" | "REVIEW_OFF") => ownerRequest(`/admin/participants/${phone}/action`, { method: "POST", body: JSON.stringify({ action }) }),
  walletAdjustment: (phone: string, amountCoins: number, reason: string) => ownerRequest(`/admin/participants/${phone}/wallet-adjustment`, { method: "POST", body: JSON.stringify({ amountCoins, reason }) }),
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
export type ParticipationStatus = {
  id?: string; name?: string; phone?: string; preferredGroup?: string; approvedGroup?: string;
  status: "PENDING" | "APPROVED" | "DECLINED"; blockedUntil?: string; requestToken: string; message: string;
};
export const participationApi = {
  groups: () => request<{ groups: string[]; ownerContactAvailable: boolean; membershipRequired: boolean; whatsappJoinUrl?: string }>("/public/groups"),
  join: (body: { name: string; phone: string; groupCode?: string; consent: boolean }) => request<ParticipationStatus & { ok: true }>("/participation/request", { method: "POST", body: JSON.stringify(body) }),
  status: (token: string) => request<ParticipationStatus>("/participation/status", { method: "POST", body: JSON.stringify({ token }) })
};
