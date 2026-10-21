import type { GamificationData, BoosterClaimResult } from "./GamificationPanel";
const configuredApiUrl = (import.meta.env.VITE_API_URL as string | undefined)?.trim();
const isBrowser = typeof window !== "undefined";
const isLocalHost = !isBrowser || ["localhost", "127.0.0.1"].includes(window.location.hostname);
const API_URL = configuredApiUrl || (isLocalHost ? "http://localhost:3333" : "");

export type LevelEmblem = {tier:number;slug:string;label:string;fromLevel:number;url:string};
export const publicApiAssetUrl=(path:string)=>API_URL+path;

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

export type GoogleIdentityClaim={status:"PENDING"|"APPROVED"|"DECLINED";requestToken:string;name:string;message:string};
export type GoogleIdentityRequest={id:string;name:string;phone:string;email:string;createdAt:string;groupCode?:string};
export type CompanionDevice={id:string;label:string;createdAt:string;lastSeenAt?:string;signal?:string;playerMatches:number;authorized:number};
export const api = {
  levelEmblems:()=>request<{emblems:LevelEmblem[]}>("/level-emblems"),
  preparePlaylist:(id:string,acceptPartial:boolean,videoCount?:number)=>request<{count:number;rewardEligible:boolean}>("/rounds/"+encodeURIComponent(id)+"/prepare-playlist",{method:"POST",body:JSON.stringify({acceptPartial,videoCount})}),
  passwordLogin:(phone:string,password:string)=>request<{token:string;mustChangePassword:boolean}>("/auth/password/login",{method:"POST",body:JSON.stringify({phone,password})}),
  setPassword:(newPassword:string,currentPassword?:string)=>request("/auth/password/set",{method:"POST",body:JSON.stringify({newPassword,currentPassword})}),
  gamification:()=>request<GamificationData & {enabled:boolean}>("/gamification/me"),
  claimBooster:()=>request<BoosterClaimResult>("/gamification/booster",{method:"POST"}),
  redeemReward:(itemCode:"SKIP"|"PASS",referenceId:string)=>request<{itemCode:string;price:number;replayed:boolean}>("/gamification/redeem",{method:"POST",body:JSON.stringify({itemCode,referenceId})}),
  giftRewardCoins:(toUserId:string,coins:number,referenceId:string)=>request("/gamification/gift-coins",{method:"POST",body:JSON.stringify({toUserId,coins,referenceId})}),

  socialUnread:()=>request<{unread:number}>("/social/unread"),
  socialOverview:()=>request<SocialOverview>("/social"),
  socialFind:(phone:string)=>request<SocialProfile>("/social/find",{method:"POST",body:JSON.stringify({phone})}),
  socialProfile:(userId:string)=>request<SocialProfile>("/social/profile/"+encodeURIComponent(userId)),
  socialRequest:(targetUserId:string,referenceId:string)=>request("/social/requests",{method:"POST",body:JSON.stringify({targetUserId,referenceId})}),
  socialRespond:(id:string,action:"ACCEPT"|"DECLINE"|"CANCEL"|"REMOVE")=>request("/social/requests/"+encodeURIComponent(id),{method:"POST",body:JSON.stringify({action})}),
  socialBlock:(userId:string,blocked:boolean)=>request("/social/blocks/"+encodeURIComponent(userId),{method:"PUT",body:JSON.stringify({blocked})}),
  socialPreferences:(acceptFriendRequests:boolean)=>request("/social/preferences",{method:"PUT",body:JSON.stringify({acceptFriendRequests})}),
  socialNotifications:()=>request<{unread:number;notifications:SocialNotification[]}>("/social/notifications"),
  socialRead:(ids:string[])=>request("/social/notifications/read",{method:"POST",body:JSON.stringify({ids})}),
  giftCoins:(toUserId:string,coins:number,referenceId:string)=>request("/gamification/gift-coins",{method:"POST",body:JSON.stringify({toUserId,coins,referenceId})}),
  socialMessageRequests:()=>request<{requests:SocialMessageRequest[]}>("/social/message-requests"),
  socialMessageRequest:(targetUserId:string)=>request("/social/message-requests",{method:"POST",body:JSON.stringify({targetUserId})}),
  socialMessageRespond:(id:string,accept:boolean)=>request("/social/message-requests/"+encodeURIComponent(id),{method:"POST",body:JSON.stringify({accept})}),
  companionPairing:()=>request<{pairingCode:string;apiUrl:string;expiresInSeconds:number}>("/companion/pairings",{method:"POST",body:JSON.stringify({consent:true})}),
  companionDevices:()=>request<{devices:CompanionDevice[]}>("/companion/devices"),
  companionRevoke:(id:string)=>request<{ok:true}>(`/companion/devices/${id}`,{method:"DELETE"}),
  googleStart:(body:{name:string;phone:string;browserVerifier:string})=>request<{url:string}>("/auth/google/start",{method:"POST",body:JSON.stringify(body)}),
  googleComplete:(body:{ticket:string;browserVerifier:string})=>request<{token?:string;claim?:GoogleIdentityClaim}>("/auth/google/complete",{method:"POST",body:JSON.stringify(body)}),
  googleStatus:(token:string)=>request<GoogleIdentityClaim>("/auth/google/status",{method:"POST",body:JSON.stringify({token})}),
  authOptions: () => request<{proofRequired:boolean;googleRequired:false;googleConfigured:boolean;whatsappConfigured:boolean;whatsappMode?:"OFFICIAL"|"META_GROUPS"|"HYBRID_PLUS"|"EVOLUTION"|"DISABLED";botRegistrationUrl?:string}>("/auth/options"),
  resolveRole: (body: { name: string; phone: string }) => request<{ role: "user" | "owner" }>("/auth/role", { method: "POST", body: JSON.stringify(body) }),
  login: (body: { name: string; phone: string }) => request<{ token: string }>("/auth/login", { method: "POST", body: JSON.stringify(body) }),
  requestCode: (body: { name: string; phone: string; registration?:boolean; consent?:true }) => request<{ devCode?: string; expiresInSeconds:number }>("/auth/request-code", { method: "POST", body: JSON.stringify(body) }),
  verifyCode: (body: { phone: string; code: string }) => request<{ token?: string; participation?:ParticipationStatus }>("/auth/verify", { method: "POST", body: JSON.stringify(body) }),
  dashboard: (roundId?: string) => request<Dashboard>("/dashboard" + (roundId ? ("?roundId=" + encodeURIComponent(roundId)) : "")),
  queuesMine: () => request<{ queues: MyQueue[]; canSkip: boolean; skipsAvailable: number; canUsePass: boolean; passesAvailable: number; cooldownUntil?: string; inventory:Array<{itemCode:string;quantity:number}> }>("/queues/mine"),
  superMe: () => request<SuperState>("/super/me"),
  superPins: () => request<{ pins: SuperPin[]; slotsFree: number; slots: number }>("/super/pins"),
  createSuperPin: (body: string) => request<{ id: string; expiresInSeconds: number }>("/super/pins", { method: "POST", body: JSON.stringify({ body }) }),
  queueSkip: (referenceId?:string,targetRoundId?:string) => request<{ queue: MyQueue; skipsAvailable: number }>("/queues/skip", { method: "POST",body:JSON.stringify({referenceId,targetRoundId}) }),
  queuePass: (referenceId:string,targetRoundId?:string) => request<{queue:MyQueue;passesAvailable:number;replayed:boolean}>("/queues/pass", {method:"POST",body:JSON.stringify({referenceId,targetRoundId})}),
  queuePreview:(id:string)=>request<{round:Round;joined:boolean}>(`/queues/${encodeURIComponent(id)}/preview`),
  queueResume:(roundId:string)=>request<{ok:true;replayed:boolean}>(`/queues/${encodeURIComponent(roundId)}/resume`,{method:"POST"}),
  queueLeave: (roundId:string) => request<{ok:true}>(`/queues/${encodeURIComponent(roundId)}/leave`, {method:"POST"}),
  giftItem: (toUserId: string, itemCode: string, quantity = 1,referenceId?:string) =>
    request<{ reference: string }>("/inventory/gift", { method: "POST", body: JSON.stringify({ toUserId, itemCode, quantity, referenceId }) }),
  submit: (url: string, expectedRoundId?:string) => request("/rounds/current/submissions", { method: "POST", body: JSON.stringify({ url, expectedRoundId }) }),
  createPix: (email: string, cpf: string, product: string) => request<Pix>("/payments/pix", { method: "POST", body: JSON.stringify({ email, cpf, product }) }),
  mailUnread:()=>request<{unread:number}>("/mail/unread-count"),
  mailInbox:()=>request<{threads:MailThread[];unread:number}>("/mail/inbox"),
  mailThread:(id:string)=>request<{messages:MailMessage[]}>("/mail/thread/"+encodeURIComponent(id)),
  mailSend:(toUserId:string,body:string)=>request<{id:string}>("/mail/dm",{method:"POST",body:JSON.stringify({toUserId,body})}),
  chatList: (afterId?: string) => request<ChatState>("/chat/global" + (afterId ? ("?afterId=" + encodeURIComponent(afterId)) : "")),
  chatSend: (body: string) => request<{ id: string; createdAt: string; role: ChatRole }>("/chat/global", { method: "POST", body: JSON.stringify({ body }) }),
  chatDelete: (id: string) => chatAdminRequest<{ ok: true }>("/admin/chat/global/" + encodeURIComponent(id), { method: "DELETE" }),
  chatPin: (id: string, pinned: boolean) => chatAdminRequest<{ ok: true }>("/admin/chat/global/" + encodeURIComponent(id) + "/pin", { method: "POST", body: JSON.stringify({ pinned }) }),
  chatClear: () => chatAdminRequest<{ ok: true; cleared: number }>("/admin/chat/global/clear", { method: "POST" }),
  chatModerate: (userId: string, action: ChatModerateAction, opts: { minutes?: number; seconds?: number } = {}) =>
    chatAdminRequest<Record<string, unknown>>("/admin/chat/global/moderate", { method: "POST", body: JSON.stringify({ userId, action, ...opts }) }),
  saveAvatar: (avatar: UserAvatar) => request<{ avatar: UserAvatar }>("/profile/avatar", { method:"PUT", body:JSON.stringify(avatar.kind==="CUSTOM" ? {kind:"CUSTOM",dataUrl:avatar.dataUrl} : {kind:"PRESET",presetId:avatar.kind==="CATALOG"?avatar.slug:avatar.presetId}) }),
  clearAvatar: () => request<{ok:true}>("/profile/avatar", { method:"DELETE" }),
  avatarCatalog: () => request<{ avatars: CatalogAvatarItem[] }>("/avatars"),
  elevateAdmin: (secret?:string) => request<{token:string;role:"owner";ownerRole:"ROOT_OWNER"|"ADMIN_OWNER"}>("/admin/elevate",{method:"POST",...(secret?{body:JSON.stringify({secret})}:{})}),
  deleteAccount: () => request<{ok:true;userId:string;deletedAt:string}>("/profile/account", { method:"DELETE", body:JSON.stringify({confirmation:"DELETE_MY_ACCOUNT"}) }),
  paymentStatus: (id: string) => request<PaymentState>(`/payments/${id}`),
  approveDemoPix: (id: string) => request(`/payments/${id}/demo-approve`, { method: "POST" }),
  youtubeConnect: (returnTo: "web" | "app", roundId?: string) => request<{ url: string }>(`/youtube/connect?returnTo=${returnTo}${roundId ? `&roundId=${encodeURIComponent(roundId)}` : ""}`),
  exportRound: (id: string) => request<{ playlistId: string }>(`/rounds/${id}/export`, { method: "POST" }),
  saveWatchProgress: (id: string, progress: Pick<WatchProgressState, "watchedSeconds" | "durations">) =>
    request<WatchProgressState>(`/rounds/${id}/watch-progress`, { method: "PUT", body: JSON.stringify(progress) }),
  observeWatchProgress: (id:string, observation:WatchObservation) =>
    request<WatchObservationResult>(`/rounds/${id}/watch-observation`, { method:"POST", body:JSON.stringify(observation) }),
  confirmWatchPresence:(id:string,challengeId:string)=>request<{ok:true}>(`/rounds/${id}/watch-presence/confirm`,{method:"POST",body:JSON.stringify({challengeId})}),
  finalizeWatchProgress: (id: string) =>
    request<{ finalizedAt: string; percent: number; cooldownUntil: string; secondsRemaining: number }>(`/rounds/${id}/watch-progress/finalize`, { method: "POST" }),
  abandonWatchProgress: (id: string) =>
    request<{ finalizedAt:string;percent:number;abandoned:true;nextOpenRound?:{id:string;sequence:number} }>(`/rounds/${id}/watch-progress/abandon`, { method:"POST" })
};

export type AvatarTier = "COMMON" | "SUPER" | "OWNER";
export type UserPresentation={administrative?:boolean;unlimitedXp?:boolean;badge:"ADMIN"|"SUPER"|null;superActive:boolean;superExpiresAt?:string;progress?:{level:number;xp:number;nextLevelXp:number;levelStartXp:number}};
export type PurchaseReceipt={userId:string;paymentId:string;productCode:string;amountCents:number;approvedAt:string;credits:number;extraPasses:number;items:Array<{itemCode:string;quantity:number}>;subscriptionDays:number};
export type PaymentState={id:string;status:string;receipt?:PurchaseReceipt};
export type UserAvatar =
  | { kind:"PRESET"; presetId:string }
  | { kind:"CUSTOM"; dataUrl:string }
  | { kind:"CATALOG"; slug:string; tier?:AvatarTier };
export type CatalogAvatarItem = { slug:string; tier:AvatarTier; category:string; label:string; locked:boolean };
export type AdminAvatarItem = { slug:string; tier:AvatarTier; category:string; label:string; active:number; sortOrder:number; createdAt:string };
/** URL absoluta da imagem de um avatar do catálogo (servida pela API). */
export const catalogAvatarUrl = (slug:string) => `${API_URL}/avatars/${slug}`;
export type PaymentProductCode = string; // AUDITORIA: catálogo configurável no painel
export type MyQueue = { id: string; number: number; status: string; vacancies: number };
export type QueuesState = { available?: Array<MyQueue & {joined:boolean;canResume?:boolean;expiresAt?:string}>; current: { id: string; number: number; status: string } | null; mine: MyQueue[]; skipsAvailable: number; passesAvailable: number; cooldownUntil?: string };
export type ChatRole = "USER" | "SUPER" | "ADMIN" | "OWNER";
export type SuperState = {
  active:boolean; expiresAt?:string; secondsRemaining:number; autoRenew:boolean; source?:string;
  uploadsPerRound:number; chatCooldownSeconds:number; canPin:boolean;
  pinMinutes:number; pinSlotsFree:number; myPins:Array<{id:string;body:string;createdAt:string}>;
};
export type SuperPin = {
  id:string; body:string; createdAt:string; expiresInSeconds:number;
  author:{ id:string; name:string; presentation?:UserPresentation; avatar?:UserAvatar; channel?:{title?:string;thumbnailUrl?:string}|null } | null;
};
export type ChatSender = { id: string; name: string; groupCode: string; presentation?:UserPresentation; avatar: UserAvatar | null };
export type MailThread={key:string;withId:string|null;lastBody:string;lastAt:string;unread:number;with:ChatSender|null};
export type MailMessage={sender?:ChatSender;id:string;mine:boolean;role:string;body:string;createdAt:string;readAt:string|null};
export type ChatMessage = { id: string; role: ChatRole; body: string; createdAt: string; pinned: boolean; sender: ChatSender };
export type ChatState = { removed: boolean; messages: ChatMessage[]; pinned: ChatMessage[]; cooldownSeconds: number; viewerRole: ChatRole };
export type ChatModerateAction = "MUTE" | "UNMUTE" | "COOLDOWN" | "REMOVE" | "RESTORE";
export type CommerceProduct={code:string;title:string;amountCents:number;credits:number;extraPasses:number;description:string;imageDataUrl?:string;grantsItem?:string;grantsItemQty?:number;subscriptionDays?:number};
export type Slot = {
  userId?: string; slot: number; youtubeUrl?: string; videoId?: string; userName?: string; groupCode?: string; createdAt?: string;
  videoTitle?: string; videoChannelTitle?: string; videoThumbnailUrl?: string;
  userChannelTitle?: string; userChannelThumbnailUrl?: string; presentation?:UserPresentation; avatar?: UserAvatar; adminRole?:"ROOT_OWNER"|"ADMIN_OWNER"; participantPhone?:string;
};
export type WatchProgressState = { watchedSeconds: number[]; durations: number[]; percent: number; rewardCoins?: number; rewardDeltaCoins?: number; walletTotal?: number; finalizedAt?: string; finalizeReason?: string; cooldownUntil?: string; secondsRemaining?: number; updatedAt?: string };
export type WatchObservation = {
  sessionId:string;videoIndex:number;playerSeconds:number;duration:number;playbackRate:number;playing:boolean;visible:boolean;
};
export type WatchRewards = {verifiedSeconds:number;coins:number;secondsToNextReward:number};
export type WatchPresenceChallenge={required:true;challengeId:string;expiresAt:string};
export type WatchObservationResult = WatchProgressState & WatchRewards & {
  acceptedSeconds:number;presence?:WatchPresenceChallenge|{required:false;confirmedUntil:string};sessionConflict?:boolean;xpDelta?:number;levelRewards?:Array<{level:number;coins:number;trialDays:number}>;
};
export type Round = { id:string;sequence:number;/** AUDITORIA: rotulo exibido ao usuario (display_number) */number:number;status:"OPEN"|"READY";expiresAt?:string;slots:Slot[];availableSlots?:Slot[];completedAt?:string;viewerContributed?:boolean;viewerCanParticipate?:boolean;export?:{status:string;playlistId?:string;addedCount?:number;watchProgress?:WatchProgressState} };
export type UserProfileSummary = {
  activity:{ submissions:number; rounds:number; playlists:number; completedTasks:number };
  adminAccess?:{role:"ROOT_OWNER"|"ADMIN_OWNER"};
  access:{
    groupCode:string; enabled:boolean; approvedAt?:string; source?:string; revoked:boolean; membershipMode?:string; lastSyncedAt?:string;
    verification?: GroupVerificationState;
  };
  purchases:{
    coinsPurchased:number; passesPurchased:number; bonusPasses:number; approvedSpendCents:number;
    history:Array<{id:string;productCode:PaymentProductCode|"LEGACY";provider:string;status:string;amountCents:number;creditsMillis:number;extraPasses:number;createdAt:string;approvedAt?:string}>;
  };
};
export type Dashboard = {
  groupAccess?:{ready:boolean;state:"MEMBER"|"JOINING"|"INVITED"|"NEEDS_SUPPORT";groupCode?:string};
  user: { id: string; name: string; phone: string; groupCode: string; groupCodes?:string[]; presentation?:UserPresentation; avatar?: UserAvatar; youtubeChannel?: { id?:string; title:string; thumbnailUrl?:string } };
  wallet: { promo: number; purchased: number; reward: number; total: number; extraPasses: number; paymentHold: boolean };
  subscription:SuperState;
  gamification?:GamificationData & {enabled:boolean;redemptionEnabled:boolean;milestones:{every:number;coins:number;trialEvery:number;trialDays:number}};
  openRound: Round;
  readyRounds: Round[];
  viewer: { contributionBlockedByPendingTask?:boolean; contributionAllowance?:number; contributionsInOpenRound: number; youtubeConnected: boolean; adminRole?:"ROOT_OWNER"|"ADMIN_OWNER" };
  profile?: UserProfileSummary;
  watchRewards:WatchRewards;
  queues:QueuesState;
  commerce:{pixAvailable:boolean;provider:"MERCADO_PAGO"|"ASAAS"|"PAGBANK"|"DISABLED"|"DEMO";products:CommerceProduct[]};
};
export type Pix = {
  id: string; userId?:string; providerPaymentId: string; status: string; qrCode?: string; qrCodeBase64?: string; ticketUrl?: string;
  receipt?:PurchaseReceipt; provider?: string; product?: PaymentProductCode; credits?: number; extraPasses?: number;
};


export type WhatsAppIntegrationState = {
  senderValidationRequired:boolean;
  mode: "OFFICIAL" | "META_GROUPS" | "HYBRID_PLUS" | "EVOLUTION" | "DISABLED";
  businessAccountId: string;
  phoneNumberId: string;
  businessPhone: string;
  graphVersion: string;
  otpTemplate: string;
  ownerAlertTemplate: string;
  decisionTemplate: string;
  templateLanguage: string;
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
  evolutionPhone?: string;
  humanSupportPhone?: string;
  evolutionWebhookSecretConfigured?: boolean;
  evolutionWebhookUrl?: string;
  evolutionApiKeyConfigured: boolean;
  officialReady: boolean;
  webhookUrl: string;
};
export type WhatsAppRuntimeState = {
  mode: WhatsAppIntegrationState["mode"];
  configured: boolean;
  otpConfigured: boolean;
  otpBlockedReason: string | null;
  connected: boolean | null;
  checkedAt: string;
  evolution: { configured: boolean; connected: boolean; state: string; number?: string; instance: string; phone: string };
  official: { configured: boolean; connected: null };
};
export type PaymentIntegrationState = {
  provider: "MERCADO_PAGO" | "ASAAS" | "PAGBANK" | "DISABLED";
  environment: "SANDBOX" | "PRODUCTION";
  ready: boolean;
  mercadoPagoAccessTokenConfigured: boolean;
  mercadoPagoWebhookSecretConfigured: boolean;
  asaasApiKeyConfigured: boolean;
  asaasWebhookTokenConfigured: boolean;
  pagBankTokenConfigured: boolean;
  webhookUrls: { mercadoPago: string; asaas: string; pagBank: string };
  providerSetup?: { ok: boolean; message: string };
};
export type OwnerVersion = { appVersion: string; gitSha: string; dirty: boolean };
export type GroupVerificationState = { required: boolean; accessReady: boolean; memberVerified: boolean; ownerAdminVerified: boolean; provider?: string };
export type OwnerParticipant = {
  id: string; userId?: string; name: string; phone: string; groupCode: string; groupCodes?:string[]; createdAt?: string; lastSeenAt?: string; deletedAt?: string;
  cooldownUntil?: string; cooldownReason?: string; balanceMillis: number; promoMillis: number; purchasedMillis: number; rewardMillis: number;
  extraPasses: number; paymentHold: number; approvedAt?: string; approvedByOwnerId?: string; approvedByOwnerName?: string;
  revokedAt?: string; source?: string; requestStatus?: string; requestSource?: string;
  youtubeChannelId?:string;youtubeChannelTitle?:string;youtubeChannelThumbnailUrl?:string;
};
export type ParticipantAdminDetail = {
  inventory?:Array<{itemCode:string;quantity:number}>;
  subscription?:SuperState;
  gamification?:GamificationData;
  watchRewards:WatchRewards;
  profile: { name: string; phone: string; groupCode?: string; userId?: string; createdAt?: string; lastSeenAt?: string; cooldownUntil?: string; cooldownReason?: string; avatar?:UserAvatar; youtubeChannel?:{id?:string;title:string;thumbnailUrl?:string} };
  membership?: { phone: string; groupCode: string; approvedAt?: string; revokedAt?: string; source?: string; approvedByOwnerId?: string; approvedByOwnerName?: string };
  request?: { id: string; name: string; phone: string; preferredGroup?: string; status: string; source?: string; whatsappVerifiedAt?: string; retryBlockUntil?: string; approvedAt?: string; approvedByOwnerId?: string; approvedByOwnerName?: string; createdAt?: string; updatedAt?: string };
  wallet?: { promoMillis: number; purchasedMillis: number; rewardMillis: number; extraPasses: number; paymentHold: number; updatedAt?: string };
  purchases: Array<{ id: string; productCode:PaymentProductCode|"LEGACY"; provider: string; status: string; amountCents: number; creditsMillis: number; extraPasses: number; createdAt: string; approvedAt?: string; providerPaymentId?: string }>;
  purchaseTotals?:{coinsPurchasedMillis:number;passesPurchased:number;bonusPasses:number;approvedSpendCents:number};
  ledger: Array<{ id: string; kind: string; amountMillis: number; referenceId?: string; note?: string; actorOwnerName?: string; createdAt: string }>;
  activity: { submissions: number; rounds:number; playlists: number; completedTasks:number };
  verification?: GroupVerificationState;
  permissions?:{canViewSensitive:boolean;canAdjustWallet:boolean;canReviewWallet:boolean};
};
export type OwnerTeamEntry={
  id:string;userId?:string;name:string;phone:string;role:"ROOT_OWNER"|"ADMIN_OWNER";active:boolean;static?:boolean;
  createdByOwnerId?:string;createdAt?:string;updatedAt?:string;
};
export type OwnerTeamCandidate={id:string;name:string;phone:string;groupCode:string};

export type OwnerOverview = {
  payments: PaymentIntegrationState;
  whatsapp: { configured: boolean; otpConfigured: boolean; ownerAlertsConfigured: boolean; decisionTemplateConfigured: boolean; groupsSyncEnabled: boolean; groupsLinked: number; automaticMemberships: number; queued: number; failed: number; sent: number; membershipMode: string; integration: WhatsAppIntegrationState };
  version: OwnerVersion;
  month:string;
  owner:{
    name:string;canonicalName?:string;groupCode:string;avatar?:UserAvatar;role:"ROOT_OWNER"|"ADMIN_OWNER";linkedUserId?:string;
    permissions:{
      canConfigure:boolean;canManageOwners:boolean;canOperate:boolean;canParticipate:boolean;
      canViewSensitive:boolean;canAdjustWallet:boolean;canExport:boolean;
    };
  };
  metrics: {
    registeredUsers:number; deletedUsers:number; activeUsers30d:number; approvedMembers:number; requestsTotal:number; pendingRequests:number; requestsMonth:number;
    completedCyclesMonth:number; playlistsCreatedMonth:number; approvedPurchasesMonth:number; demoPurchasesMonth:number; revenueCentsMonth:number;
    coinsPackagePurchasesMonth:number; passPurchasesMonth:number; coinsPackageRevenueCentsMonth:number; passRevenueCentsMonth:number; legacyRevenueCentsMonth:number;
  };
  groups: Array<{ code: string; enabled: number; whatsappGroupId?: string; membershipMode?: string; lastSyncedAt?: string; joinUrl?: string; verificationProvider?: string; ownerAdminCount?: number; verifiedAt?: string }>;
  requests: Array<{ id: string; name: string; phone: string; preferredGroup?: string; status: string; source?: string; whatsappVerifiedAt?: string; approvedAt?: string; approvedByOwnerId?: string; approvedByOwnerName?: string; createdAt: string; updatedAt?: string }>;
  users: OwnerParticipant[];
  members: Array<{ phone: string; groupCode: string; approvedAt?: string; approvedByOwnerId?: string; approvedByOwnerName?: string; revokedAt?: string; source?: string }>;
  purchases: Array<{ id:string;userId:string;name:string;phone:string;userDeletedAt?:string;productCode:PaymentProductCode|"LEGACY";provider:string;status:string;amountCents:number;creditsMillis:number;extraPasses:number;createdAt:string;approvedAt?:string }>;
  deletedAccounts:Array<{userId:string;groupCode?:string;deletedAt:string;source:string;submissionsCount:number;roundsCount:number;approvedPaymentCents:number;coinsPurchasedMillis:number;passesPurchased:number}>;
  activeRounds:Array<{id:string;sequence:number;status:"OPEN"|"READY";submissions:number;createdAt:string;completedAt?:string}>;
};
function ownerRequest<T>(path: string, options: RequestInit = {}) {
  return request<T>(path, { ...options, headers: { ...options.headers, authorization: `Bearer ${localStorage.getItem("conexao_owner_token") ?? ""}` } });
}
async function chatAdminRequest<T>(path: string, options: RequestInit = {}) {
  // A participant role alone never authorizes moderation. Obtain/retain a
  // server-validated administrative session before calling privileged routes.
  if (!localStorage.getItem("conexao_owner_token")) {
    const elevated = await api.elevateAdmin();
    localStorage.setItem("conexao_owner_token", elevated.token);
  }
  return ownerRequest<T>(path, options);
}
export type OwnerAccessEntry={id:string;name:string;phone?:string;role:"ROOT_OWNER"|"ADMIN_OWNER";active:boolean;static?:boolean;userId?:string;createdByOwnerId?:string;createdAt?:string;updatedAt?:string};
export type OwnerAccessCandidate={id:string;name:string;phone:string;groupCode:string};
export type OwnerParticipantSession={
  token:string;adminRole:"ROOT_OWNER"|"ADMIN_OWNER";
  user:{id:string;name:string;phone:string;groupCode:string};
  rounds:Array<{id:string;sequence:number;status:"OPEN"|"READY";submissions:number}>;
};

// AUDITORIA / painel: loja configuravel, cerebro do bot, saude do numero e correio.
export type StoreProduct = { code:string;title:string;description:string;amountCents:number;creditsMillis:number;extraPasses:number;active:boolean;sortOrder:number;itemReference:string;grantsItem?:string;grantsItemQty:number;imageDataUrl?:string;subscriptionDays:number };
export type BotFeature = { code:string;label:string;engine:"messaging"|"group";enabled:boolean;active:boolean;blockedReason:string|null;riskNote:string|null };
export type BotStatus = {
  mode:"DISABLED"|"OFFICIAL"|"EVOLUTION"|"HYBRID"|"HYBRID_PLUS"|"META_GROUPS";
  engines:{ messaging:{ready:boolean;official:boolean;evolution:boolean}; group:{ready:boolean} };
  dependencies:{ whatsappOfficialReady:boolean;youtubeReady:boolean;paymentReady:boolean;webhookUrl:string };
  features:BotFeature[]; missing:string[]; fullyActive:boolean;
};
export type NumberHealth = { status:"HEALTHY"|"DEGRADED"|"UNUSABLE"|"UNKNOWN";checkedAt:string;phone?:string;phoneNumberId?:string;qualityRating?:string;platformStatus?:string;detail:string;recommendation:string;shouldReplaceNumber:boolean };
export type YouTubeIntegrationState = { apiKeyConfigured:boolean;source:"PANEL"|"ENVIRONMENT"|"NONE";verification:"VERIFIED"|"STRUCTURAL_ONLY";ready:boolean };
export type CredentialEntry = { ownerId:string; configured:boolean; mustChange:boolean; lockedUntil?:string; updatedAt?:string; phone?:string; name?:string };
export type CredentialsState = { mine:CredentialEntry; admins:CredentialEntry[]; owners?:Array<{id:string;name:string;phone:string}> };
export type SuperSubscriber = { userId:string; name:string; phone:string; expiresAt:string; autoRenew:number; source:string; revokedAt?:string };
export type SuperAdminState = { subscribers:SuperSubscriber[]; pins:Array<{id:string;userId:string;body:string;createdAt:string}>; defaultDays:number };
export type AdminMailMessage = { id:string;threadKey:string;senderId:string|null;senderRole:string;recipientId:string;body:string;createdAt:string;deletedAt:string|null };

// AUDITORIA / HYBRID+ — atitudes do bot editaveis pelo Owner.
export type AutomationChannel = "OFFICIAL"|"EVOLUTION";
export type AutomationTarget = "MEMBER"|"OWNERS"|"GROUP"|"ALL_GROUPS";
export type AutomationCategory = "ONBOARDING"|"QUEUES"|"REWARDS"|"RETENTION"|"SUPPORT"|"BROADCAST";
export type AutomationMeta = {
  event:string; category:AutomationCategory; label:string; description:string;
  defaultChannel:AutomationChannel; defaultTarget:AutomationTarget; periodic:boolean;
  defaultIntervalMinutes?:number; canPin:boolean; placeholders:string[];
  defaultEnabled:boolean; defaultText:string; requires?:string[];
};
export type AutomationSettings = {
  event:string; enabled:boolean; text:string; channel:AutomationChannel; target:AutomationTarget;
  intervalMinutes?:number; customized:boolean; updatedAt?:string; updatedByName?:string;
};
export type AutomationsState = {
  automations:AutomationSettings[]; catalog:AutomationMeta[];
  groups:Array<{category:AutomationCategory;events:string[]}>;
};
export type AutomationAuditEntry = {
  event:string; field:string; before:string|null; after:string|null;
  actorName:string|null; createdAt:string;
};

export type SupportAvailability = {enabled:boolean;days:number[];startHour:number;endHour:number};
export type SupportAvailabilityState = SupportAvailability & {timeZone:"America/Bahia";availableNow:boolean};

export type BotAutomationRuntime = {
 wired:boolean;
 capabilities:Array<{event:string;status:string}>;
 deliveries:Array<{event:string;sourceId:string;target:string;status:string;reason?:string|null;outboxId?:string|null;createdAt:string}>;
 events:Array<{event:string;status:string;reason?:string|null;total:number}>;
};

export const ownerApi = {
  community:()=>ownerRequest<OwnerCommunityData>("/admin/community"),
  saveCommunity:(body:OwnerCommunityConfig)=>ownerRequest<{config:OwnerCommunityConfig}>("/admin/community",{method:"PUT",body:JSON.stringify(body)}),
  revokeCommunityRelationship:(id:string,reason:string)=>ownerRequest<{ok:true;replayed:boolean}>(`/admin/community/relationships/${encodeURIComponent(id)}/revoke`,{method:"POST",body:JSON.stringify({reason})}),
  sendBotTestMessage:(referenceId:string)=>ownerRequest<{queued:true;outboxId:string}>("/admin/bot/test-message",{method:"POST",body:JSON.stringify({referenceId})}),
  botTestMessageStatus:(outboxId:string)=>ownerRequest<{status:string;reason?:string|null;providerConfirmed:boolean}>(`/admin/bot/test-message/${encodeURIComponent(outboxId)}`),
  supportAvailability:()=>ownerRequest<SupportAvailabilityState>("/admin/bot/support-availability"),
  saveSupportAvailability:(settings:SupportAvailability)=>ownerRequest<SupportAvailabilityState>("/admin/bot/support-availability",{method:"POST",body:JSON.stringify(settings)}),
  botAutomations:()=>ownerRequest<AutomationsState>("/admin/bot/automations"),
  botAutomationsRuntime:()=>ownerRequest<BotAutomationRuntime>("/admin/bot/automations/runtime"),
  dispatchGlobalBroadcast:(message:string,referenceId:string)=>ownerRequest<{eventId:string;queued?:number;waiting?:number}>("/admin/bot/automations/BROADCAST_GLOBAL/dispatch",{method:"POST",body:JSON.stringify({message,referenceId})}),
  saveBotAutomation:(event:string,patch:Partial<Pick<AutomationSettings,"enabled"|"text"|"channel"|"target"|"intervalMinutes">>)=>
    ownerRequest<{ok:true;automation:AutomationSettings}>(`/admin/bot/automations/${event}`,{method:"PATCH",body:JSON.stringify(patch)}),
  resetBotAutomation:(event:string)=>
    ownerRequest<{ok:true;automation:AutomationSettings}>(`/admin/bot/automations/${event}/reset`,{method:"POST"}),
  botAutomationAudit:(event?:string)=>
    ownerRequest<{entries:AutomationAuditEntry[]}>(`/admin/bot/automations/audit${event?`?event=${event}`:""}`),
  removeSuperPin:(id:string)=>ownerRequest<{ok:true}>(`/admin/super/pins/${id}`,{method:"DELETE"}),
  botPassword:()=>ownerRequest<BotPasswordState>("/admin/auth/bot-password"),
  saveBotPassword:(body:{enabled:boolean;templateName:string;templateLanguage:string})=>ownerRequest<BotPasswordState>("/admin/auth/bot-password",{method:"POST",body:JSON.stringify(body)}),
  gamificationBot:()=>ownerRequest<GamificationBotData>("/admin/gamification/bot"),
  saveGamificationBot:(body:GamificationBotSettings)=>ownerRequest<GamificationBotData>("/admin/gamification/bot",{method:"POST",body:JSON.stringify(body)}),
  gamification:()=>ownerRequest<OwnerGamificationData>("/admin/gamification"),
  saveGamification:(body:GamificationSettings)=>ownerRequest<{config:GamificationSettings}>("/admin/gamification",{method:"POST",body:JSON.stringify(body)}),
  settleGamification:()=>ownerRequest("/admin/gamification/settle",{method:"POST"}),

  googleIdentities:()=>ownerRequest<{claims:GoogleIdentityRequest[]}>("/admin/google-identities"),
  decideGoogleIdentity:(id:string,approve:boolean,groupCode?:string)=>ownerRequest<{ok:true}>(`/admin/google-identities/${id}/decision`,{method:"POST",body:JSON.stringify({approve,groupCode})}),
  login: (body: { name: string; identifier: string; groupCode: "#"; secret: string }) => request<{ token: string; role: "owner" }>("/admin/login", { method: "POST", body: JSON.stringify(body) }),
  overview: (month: string) => ownerRequest<OwnerOverview>(`/admin/overview?month=${month}`),
  group: (code: string, enabled: boolean) => ownerRequest("/admin/groups", { method: "POST", body: JSON.stringify({ code, enabled }) }),
  groupSettings: (code: string, joinUrl: string) => ownerRequest<{ ok: true; group: OwnerOverview["groups"][number] }>("/admin/groups", { method: "POST", body: JSON.stringify({ code, joinUrl }) }),
  approveMember: (phone: string, groupCode: string, name?: string) => ownerRequest("/admin/members", { method: "POST", body: JSON.stringify({ phone, groupCode, name }) }),
  retryWhatsApp: () => ownerRequest("/admin/whatsapp/retry", { method: "POST" }),
  syncWhatsAppGroups: () => ownerRequest<{ discovered: number; linked: number; memberships: number }>("/admin/whatsapp/groups/sync", { method: "POST" }),
  whatsappIntegration: () => ownerRequest<WhatsAppIntegrationState>("/admin/integrations/whatsapp"),
  whatsappRuntime: () => ownerRequest<WhatsAppRuntimeState>("/admin/integrations/whatsapp/runtime"),
  paymentIntegration: () => ownerRequest<PaymentIntegrationState>("/admin/integrations/payments"),
  savePaymentIntegration: (body: {
    provider: PaymentIntegrationState["provider"]; environment: PaymentIntegrationState["environment"];
    mercadoPagoAccessToken?: string; mercadoPagoWebhookSecret?: string;
    asaasApiKey?: string; asaasWebhookToken?: string; pagBankToken?: string;
  }) => ownerRequest<PaymentIntegrationState>("/admin/integrations/payments", { method:"POST", body:JSON.stringify(body) }),
  saveWhatsAppIntegration: (body: Partial<{
    mode: "OFFICIAL" | "META_GROUPS" | "HYBRID_PLUS" | "EVOLUTION" | "DISABLED"; businessAccountId: string; phoneNumberId: string; businessPhone: string; humanSupportPhone: string; graphVersion: string;
    otpTemplate: string; ownerAlertTemplate: string; decisionTemplate: string; templateLanguage: string;
    accessToken: string; appSecret: string; verifyToken: string; wppUrl: string; wppSession: string; wppToken: string; evolutionUrl: string; evolutionInstance: string; evolutionPhone: string; evolutionWebhookSecret: string; evolutionApiKey: string;
  }>) => ownerRequest<WhatsAppIntegrationState>("/admin/integrations/whatsapp", { method: "POST", body: JSON.stringify(body) }),
  generateWhatsAppVerifyToken: () => ownerRequest<{ ok: true; verifyToken: string; state: WhatsAppIntegrationState }>("/admin/integrations/whatsapp/verify-token", { method: "POST" }),
  validateWhatsApp: () => ownerRequest<{ ok: true; validatedAt: string; phone: { id?: string; display_phone_number?: string; verified_name?: string; quality_rating?: string } }>("/admin/integrations/whatsapp/validate", { method: "POST" }),
  // loja configuravel
  storeProducts: () => ownerRequest<{ products: StoreProduct[] }>("/admin/store/products"),
  saveStoreProduct: (body: Partial<StoreProduct> & { code: string; title: string; amountCents: number; credits?: number }) =>
    ownerRequest<{ product: StoreProduct }>("/admin/store/products", { method: "POST", body: JSON.stringify(body) }),
  setStoreProductActive: (code: string, active: boolean) =>
    ownerRequest<{ ok: true; products: StoreProduct[] }>(`/admin/store/products/${encodeURIComponent(code)}/active`, { method: "POST", body: JSON.stringify({ active }) }),
  // cerebro do bot
  bot: () => ownerRequest<{ status: BotStatus; catalog: unknown }>("/admin/bot"),
  saveBot: (body: { mode?: BotStatus["mode"]; features?: Record<string, boolean> }) =>
    ownerRequest<{ ok: true; status: BotStatus }>("/admin/bot", { method: "POST", body: JSON.stringify(body) }),
  // saude do numero Business
  numberHealth: () => ownerRequest<{ health: NumberHealth | null; replacementSteps: string[] }>("/admin/integrations/whatsapp/health"),
  checkNumberHealth: () => ownerRequest<{ health: NumberHealth; replacementSteps: string[] }>("/admin/integrations/whatsapp/health", { method: "POST" }),
  // YouTube no painel
  youtubeIntegration: () => ownerRequest<YouTubeIntegrationState>("/admin/integrations/youtube"),
  saveYouTubeIntegration: (body: { apiKey?: string; clear?: boolean }) =>
    ownerRequest<YouTubeIntegrationState>("/admin/integrations/youtube", { method: "POST", body: JSON.stringify(body) }),
  // correio interno
  // acesso: credenciais, telefone dos owners e SUPER
  credentials: () => ownerRequest<CredentialsState>("/admin/credentials"),
  ownCredential:()=>ownerRequest<{ownerId:string;name:string;role:"ROOT_OWNER"|"ADMIN_OWNER";configured:boolean;mustChange:boolean}>("/admin/credentials/self"),
  saveOwnCredential:(body:{currentPassword:string;password:string})=>ownerRequest<{ok:true;message:string}>("/admin/credentials/self",{method:"POST",body:JSON.stringify(body)}),
  // AUDITORIA / avatares gerenciáveis: o Owner sobe a ilustração (já normalizada).
  avatarCatalog:()=>ownerRequest<{avatars:CatalogAvatarItem[]}>("/admin/profile/avatar-catalog"),
  avatarsAdmin: () => ownerRequest<{ avatars: AdminAvatarItem[] }>("/admin/avatars"),
  avatarUpload: (body: { tier: AvatarTier; category: string; label: string; dataUrl: string; slug?: string; sortOrder?: number }) =>
    ownerRequest<{ ok: true; slug: string }>("/admin/avatars", { method: "POST", body: JSON.stringify(body) }),
  avatarDelete: (slug: string) => ownerRequest<{ ok: true }>(`/admin/avatars/${encodeURIComponent(slug)}`, { method: "DELETE" }),
  saveCredential: (body: { ownerId?: string; password: string; mustChange?: boolean; reason?:string }) =>
    ownerRequest<{ ok: true }>("/admin/credentials", { method: "POST", body: JSON.stringify(body) }),
  generateCredential: (ownerId: string) =>
    ownerRequest<{ ok: true; password: string }>("/admin/credentials/generate", { method: "POST", body: JSON.stringify({ ownerId }) }),
  clearCredential: (ownerId: string) =>
    ownerRequest<{ ok: true }>(`/admin/credentials/${encodeURIComponent(ownerId)}`, { method: "DELETE" }),
  saveOwnerPhone: (ownerId: string, phone: string) =>
    ownerRequest<{ ok: true }>("/admin/owner-phone", { method: "POST", body: JSON.stringify({ ownerId, phone }) }),
  superAdmin: () => ownerRequest<SuperAdminState>("/admin/super"),
  grantSuper: (userId: string, days?: number) =>
    ownerRequest<{ ok: true }>("/admin/super/grant", { method: "POST", body: JSON.stringify({ userId, days }) }),
  revokeSuper: (userId: string) =>
    ownerRequest<{ ok: true }>("/admin/super/revoke", { method: "POST", body: JSON.stringify({ userId }) }),
  superAutoRenew: (userId: string, autoRenew: boolean) =>
    ownerRequest<{ ok: true }>("/admin/super/auto-renew", { method: "POST", body: JSON.stringify({ userId, autoRenew }) }),
  mailBroadcast: (body: string) => ownerRequest<{ delivered: number; createdAt: string }>("/admin/mail/broadcast", { method: "POST", body: JSON.stringify({ body }) }),
  mailRecent: (limit = 100) => ownerRequest<{ messages: AdminMailMessage[] }>(`/admin/mail?limit=${limit}`),
  mailDelete: (id: string) => ownerRequest<{ ok: true }>(`/admin/mail/${encodeURIComponent(id)}`, { method: "DELETE" }),
  saveAvatar: (avatar:UserAvatar) => ownerRequest<{avatar:UserAvatar}>("/admin/profile/avatar",{method:"PUT",body:JSON.stringify(avatar.kind==="CUSTOM"?{kind:"CUSTOM",dataUrl:avatar.dataUrl}:{kind:"PRESET",presetId:avatar.kind==="CATALOG"?avatar.slug:avatar.presetId})}),
  clearAvatar: () => ownerRequest<{ok:true}>("/admin/profile/avatar",{method:"DELETE"}),
  participantSession: () => ownerRequest<{token:string;user:{id:string;name:string;phone:string;groupCode:string};adminRole:"ROOT_OWNER"|"ADMIN_OWNER";rounds:Array<{id:string;sequence:number;status:"OPEN"|"READY";submissions:number}>}>("/admin/participant-session",{method:"POST"}),
  team: () => ownerRequest<{owners:OwnerTeamEntry[];candidates:OwnerTeamCandidate[]}>("/admin/owners"),
  promoteOwner: (userId:string) => ownerRequest<{ok:true;id:string;userId:string;name:string;phone:string;role:"ADMIN_OWNER"}>("/admin/owners",{method:"POST",body:JSON.stringify({userId})}),
  revokeOwner: (id:string) => ownerRequest<{ok:true}>("/admin/owners/"+id,{method:"DELETE"}),
  version: () => ownerRequest<OwnerVersion>("/admin/version"),
  participant: (phone: string) => ownerRequest<ParticipantAdminDetail>(`/admin/participants/${phone}`),
  updateParticipant: (currentPhone: string, body: { name: string; phone: string; groupCode: string }) => ownerRequest<{ ok: true; phone: string }>(`/admin/participants/${currentPhone}`, { method: "PATCH", body: JSON.stringify(body) }),
  participantAction: (phone: string, action: "REVOKE" | "RESTORE" | "CLEAR_COOLDOWN" | "REVIEW_ON" | "REVIEW_OFF") => ownerRequest(`/admin/participants/${phone}/action`, { method: "POST", body: JSON.stringify({ action }) }),
  setParticipantPassword:(phone:string,body:{password:string;reason:string})=>ownerRequest<{ok:true;mustChange:true;message:string}>(`/admin/participants/${encodeURIComponent(phone)}/password`,{method:'POST',body:JSON.stringify(body)}),
  grantBenefit: (phone:string,body:{benefit:"COINS"|"PASS"|"SKIP"|"SUPER";quantity:number;referenceId:string;reason:string}) => ownerRequest<{ok:true;replayed:boolean;benefit:string;quantity:number}>(`/admin/participants/${phone}/benefits`,{method:"POST",body:JSON.stringify(body)}),
  walletAdjustment: (phone: string, amountCoins: number, reason: string) => ownerRequest(`/admin/participants/${phone}/wallet-adjustment`, { method: "POST", body: JSON.stringify({ amountCoins, reason }) }),
  revoke: (phone: string) => ownerRequest(`/admin/members/${phone}`, { method: "DELETE" }),
  decide: (id: string, status: "APPROVED" | "DECLINED") => ownerRequest(`/admin/requests/${id}/decision`, { method: "POST", body: JSON.stringify({ status }) }),
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
  groups: () => request<{ groups: string[]; groupLinks: Record<string,string>; ownerContactAvailable: boolean; membershipRequired: boolean; whatsappJoinUrl?: string }>("/public/groups"),
  join: (body: { name: string; phone: string; consent: boolean }) => request<ParticipationStatus & { ok: true; detectedGroup?: string; groupDetectionSource?: string }>("/participation/request", { method: "POST", body: JSON.stringify(body) }),
  status: (token: string) => request<ParticipationStatus>("/participation/status", { method: "POST", body: JSON.stringify({ token }) })
};

export type GamificationSettings={
 enabled:boolean;xpEnabled:boolean;boosterEnabled:boolean;redeemEnabled:boolean;monthlyEnabled:boolean;
 xpPerVideo:number;curve:{firstStep:number;stepIncrease:number};levelCoins:number;milestoneEvery:number;milestoneCoins:number;trialEvery:number;trialDays:number;
 monthlyRewards:[number,number,number];redeemPrices:{SKIP:number;PASS:number};boosterDrops:Array<{code:string;weight:number}>;
};
export type OwnerGamificationData={config:GamificationSettings;ranks:GamificationData["ranks"];events:Array<{id:string;kind:string;name:string;xpDelta:number;createdAt:string;payload:string}>;botEvents:Array<{id:string;event:string;status:string;createdAt:string}>;audits:Array<{actorId:string;createdAt:string}>};

export type GamificationBotSettings={enabled:boolean;events:Record<string,{enabled:boolean;internalEnabled:boolean;whatsappEnabled:boolean;text:string;templateName:string;templateLanguage:string}>};
export type GamificationBotData={settings:GamificationBotSettings;catalog:Array<{event:string;label:string;placeholders:string[]}>;runtime:{wired:boolean;transport:string;note:string};deliveries:Array<{eventId:string;event:string;name:string;status:string;reason?:string;createdAt:string}>};

export type BotPasswordState={enabled:boolean;templateName:string;templateLanguage:string;deliveries:Array<{userId:string;name:string;status:string;createdAt:string}>};

export type SocialRelationship={status:"SELF"|"FRIEND"|"REQUEST_SENT"|"REQUEST_RECEIVED"|"NONE"|"DISABLED"|"BLOCKED";invitationId?:string;blockedByMe?:boolean;interactionBlocked?:boolean};
export type SocialProfile={user:ChatSender|null;relationship:SocialRelationship;acceptsRequests?:boolean;enabled?:boolean;interactionBlocked?:boolean;blockedByMe?:boolean};
export type SocialOverview={friendshipRequestCost?:number;blocked?:Array<{userId:string;user:ChatSender|null;createdAt:string}>;enabled:boolean;preferences:{acceptFriendRequests:boolean};friends:Array<{id:string;user:ChatSender|null;since:string}>;incoming:Array<{id:string;user:ChatSender|null;createdAt:string}>;outgoing:Array<{id:string;user:ChatSender|null;createdAt:string}>;unread:number;transferableCoins:number};
export type SocialNotification={id:string;kind:string;referenceId:string;payload:Record<string,unknown>;actor:ChatSender|null;createdAt:string;readAt:string|null};
export type SocialMessageRequest={id:string;senderId:string;recipientId:string;status:"PENDING"|"ACCEPTED"|"DECLINED";createdAt:string;incoming:boolean;user:ChatSender|null};

export type OwnerCommunityConfig = { friendsEnabled:boolean; coinGiftsEnabled:boolean; maxGiftCoins:number; declinedInviteCooldownHours:number };
export type OwnerCommunityRelationship = { id:string; status:"PENDING"|"ACCEPTED"; senderId:string; recipientId:string; sender?:ChatSender|null; recipient?:ChatSender|null; createdAt:string; updatedAt:string };
export type OwnerCommunityData = {
  config:OwnerCommunityConfig;
  stats:{friendships:number;pendingInvitations:number;participantsReceivingInvites:number};
  relationships:OwnerCommunityRelationship[];
  audit:Array<{id:string;actorId:string;action:string;targetId:string|null;payload:string;createdAt:string}>;
  coinTransfers:{
    totals:{count:number;amountMillis:number;rewardMillis:number;purchasedMillis:number;revenueCents:number};
    transfers:Array<{id:string;fromUserId:string;fromName:string;toUserId:string;toName:string;referenceId:string;amountMillis:number;rewardMillis:number;purchasedMillis:number;createdAt:string}>;
  };
};
