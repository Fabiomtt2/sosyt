import { humanSupportNumber, setHumanSupportNumber } from "./bot-human-handoff.js";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { z } from "zod";
import { normalizePhone } from "./phone.js";
import type { Config } from "./config.js";
import type { AppDatabase } from "./db.js";
import { assertDistinctFromOfficial } from "./bot-evolution.js";

export const whatsappModeSchema = z.enum(["OFFICIAL", "META_GROUPS", "HYBRID_PLUS", "EVOLUTION", "DISABLED"]);
export type WhatsAppMode = z.infer<typeof whatsappModeSchema>;

export function persistedWhatsAppMode(db:AppDatabase):WhatsAppMode|undefined {
  const rows=db.prepare("SELECT key,value FROM integration_settings WHERE key IN ('whatsapp.mode','bot.mode') ORDER BY updated_at DESC, CASE key WHEN 'whatsapp.mode' THEN 0 ELSE 1 END").all() as Array<{key:string;value:string}>;
  for(const row of rows){
    const value=row.value==="HYBRID" ? (row.key==="bot.mode"?"HYBRID_PLUS":"META_GROUPS") : row.value;
    const parsed=whatsappModeSchema.safeParse(value);
    if(parsed.success)return parsed.data;
  }
  return undefined;
}

const metaSettingsSchema = z.object({
  mode: whatsappModeSchema.optional(),
  humanSupportPhone: z.string().trim().max(30).transform(normalizePhone).pipe(z.string().regex(/^[1-9]\d{7,14}$/)).optional(),
  businessAccountId: z.string().trim().regex(/^\d{5,40}$/).optional(),
  phoneNumberId: z.string().trim().regex(/^\d{5,40}$/).optional(),
  businessPhone: z.string().trim().max(30).transform(normalizePhone).pipe(z.string().regex(/^[1-9]\d{7,14}$/, "Informe o número Business com DDI, DDD e telefone.")).optional(),
  graphVersion: z.string().trim().regex(/^v\d{2,3}\.\d$/).default("v23.0"),
  accessToken: z.string().trim().min(20).max(4096).optional(),
  appSecret: z.string().trim().min(8).max(512).optional(),
  verifyToken: z.string().trim().min(12).max(256).optional(),
  otpTemplate: z.string().trim().regex(/^[a-z0-9_]+$/).optional(),
  ownerAlertTemplate: z.string().trim().regex(/^[a-z0-9_]+$/).optional(),
  decisionTemplate: z.string().trim().regex(/^[a-z0-9_]+$/).optional(),
  templateLanguage: z.string().trim().regex(/^[A-Za-z]{2}(?:_[A-Za-z]{2})?$/).default("pt_BR"),
  wppUrl: z.string().url().optional(),
  wppSession: z.string().trim().regex(/^[A-Za-z0-9_-]{2,64}$/).optional(),
  wppToken: z.string().trim().min(8).max(4096).optional(),
  evolutionUrl: z.string().url().optional(),
  evolutionInstance: z.string().trim().regex(/^[A-Za-z0-9_-]{2,80}$/).optional(),
  evolutionApiKey: z.string().trim().min(8).max(4096).optional(),
  evolutionPhone: z.string().trim().max(30).transform(normalizePhone).pipe(z.string().regex(/^[1-9]\d{7,14}$/)).optional(),
  evolutionWebhookSecret: z.string().trim().min(24).max(256).optional()
});
export type MetaSettingsInput = z.infer<typeof metaSettingsSchema>;

const keyNames = {
  mode: "whatsapp.mode",
  businessAccountId: "whatsapp.meta.waba_id",
  phoneNumberId: "whatsapp.meta.phone_number_id",
  businessPhone: "whatsapp.meta.business_phone",
  graphVersion: "whatsapp.meta.graph_version",
  accessToken: "whatsapp.meta.access_token",
  appSecret: "whatsapp.meta.app_secret",
  verifyToken: "whatsapp.meta.verify_token",
  otpTemplate: "whatsapp.meta.otp_template",
  ownerAlertTemplate: "whatsapp.meta.owner_alert_template",
  decisionTemplate: "whatsapp.meta.decision_template",
  templateLanguage: "whatsapp.meta.template_language",
  tokenValidatedAt: "whatsapp.meta.token_validated_at",
  validatedDisplayPhone: "whatsapp.meta.validated_display_phone",
  senderValidationRequired: "whatsapp.meta.sender_validation_required",
  wppUrl: "whatsapp.wpp.url",
  wppSession: "whatsapp.wpp.session",
  wppToken: "whatsapp.wpp.token",
  evolutionUrl: "whatsapp.evolution.url",
  evolutionInstance: "whatsapp.evolution.instance",
  evolutionApiKey: "whatsapp.evolution.api_key",
  evolutionPhone: "whatsapp.evolution.phone",
  evolutionWebhookSecret: "whatsapp.evolution.webhook_secret"
} as const;

function get(db: AppDatabase, key: string) {
  return (db.prepare("SELECT value FROM integration_settings WHERE key=?").get(key) as { value: string } | undefined)?.value;
}
function set(db: AppDatabase, key: string, value: string) {
  db.prepare(`INSERT INTO integration_settings (key,value,updated_at) VALUES (?,?,?)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at`)
    .run(key,value,new Date().toISOString());
}
function secretKey(config: Config) {
  return createHash("sha256").update(`${config.JWT_SECRET}:integration-secrets:v1`).digest();
}
function seal(config: Config, value: string) {
  const iv=randomBytes(12), cipher=createCipheriv("aes-256-gcm",secretKey(config),iv);
  const encrypted=Buffer.concat([cipher.update(value,"utf8"),cipher.final()]);
  return ["v1",iv.toString("base64url"),cipher.getAuthTag().toString("base64url"),encrypted.toString("base64url")].join(".");
}
function unseal(config: Config, value?: string) {
  if (!value) return undefined;
  try {
    const [version,iv,tag,data]=value.split(".");
    if (version!=="v1" || !iv || !tag || !data) return undefined;
    const decipher=createDecipheriv("aes-256-gcm",secretKey(config),Buffer.from(iv,"base64url"));
    decipher.setAuthTag(Buffer.from(tag,"base64url"));
    return Buffer.concat([decipher.update(Buffer.from(data,"base64url")),decipher.final()]).toString("utf8");
  } catch { return undefined; }
}
function configuredSecret(db: AppDatabase, config: Config, key: string, envValue?: string) {
  return Boolean(unseal(config,get(db,key)) || envValue);
}

export function initializeWhatsAppIntegration(db:AppDatabase,config:Config) {
  const current=get(db,keyNames.businessPhone);
  if(!current) set(db,keyNames.businessPhone,config.WHATSAPP_BUSINESS_PHONE);
}

export function readWhatsAppIntegration(db: AppDatabase, config: Config) {
  // preserva instalações Meta legadas de verdade: se o modo nunca foi salvo MAS já
  // existem credenciais Meta persistidas no DB (painel antigo), assume OFFICIAL em vez
  // do default EVOLUTION — senão o token seria descartado e OTP/alertas parariam calados.
  const legacyMeta = Boolean(get(db,keyNames.phoneNumberId) || get(db,keyNames.accessToken));
  const mode = persistedWhatsAppMode(db) ?? (legacyMeta ? "OFFICIAL" : config.WHATSAPP_MODE);
  const businessAccountId = get(db,keyNames.businessAccountId) ?? config.WHATSAPP_BUSINESS_ACCOUNT_ID;
  const phoneNumberId = get(db,keyNames.phoneNumberId) ?? config.WHATSAPP_PHONE_NUMBER_ID;
  const businessPhone = get(db,keyNames.businessPhone) || config.WHATSAPP_BUSINESS_PHONE;
  const senderValidationRequired=get(db,keyNames.senderValidationRequired)==="1";
  const graphVersion = get(db,keyNames.graphVersion) ?? config.WHATSAPP_GRAPH_VERSION;
  const otpTemplate = get(db,keyNames.otpTemplate) ?? config.WHATSAPP_OTP_TEMPLATE ?? "";
  const ownerAlertTemplate = get(db,keyNames.ownerAlertTemplate) ?? config.WHATSAPP_OWNER_ALERT_TEMPLATE ?? "";
  const decisionTemplate = get(db,keyNames.decisionTemplate) ?? config.WHATSAPP_DECISION_TEMPLATE ?? "";
  const templateLanguage = get(db,keyNames.templateLanguage) ?? config.WHATSAPP_TEMPLATE_LANGUAGE;
  const wppUrl = get(db,keyNames.wppUrl) ?? config.WPP_CONNECT_URL;
  const wppSession = get(db,keyNames.wppSession) ?? config.WPP_CONNECT_SESSION;
  const evolutionUrl = get(db,keyNames.evolutionUrl) ?? config.EVOLUTION_URL ?? "";
  const evolutionInstance = get(db,keyNames.evolutionInstance) ?? config.EVOLUTION_INSTANCE ?? "";
  const evolutionPhone = get(db,keyNames.evolutionPhone) ?? config.EVOLUTION_PHONE ?? "";
  const evolutionApiKeyConfigured = configuredSecret(db,config,keyNames.evolutionApiKey,config.EVOLUTION_API_KEY);
  const evolutionWebhookSecretConfigured = configuredSecret(db,config,keyNames.evolutionWebhookSecret,config.EVOLUTION_WEBHOOK_SECRET);
  return {
    mode,
    businessAccountId: businessAccountId ?? "",
    phoneNumberId: phoneNumberId ?? "",
    businessPhone,
    humanSupportPhone:humanSupportNumber(db,config),
    senderValidationRequired,
    graphVersion,
    otpTemplate,
    ownerAlertTemplate,
    decisionTemplate,
    templateLanguage,
    accessTokenConfigured: configuredSecret(db,config,keyNames.accessToken,config.WHATSAPP_ACCESS_TOKEN),
    appSecretConfigured: configuredSecret(db,config,keyNames.appSecret,config.WHATSAPP_APP_SECRET),
    verifyTokenConfigured: configuredSecret(db,config,keyNames.verifyToken,config.WHATSAPP_VERIFY_TOKEN),
    tokenValidatedAt: get(db,keyNames.tokenValidatedAt),
    validatedDisplayPhone: get(db,keyNames.validatedDisplayPhone),
    wppUrl,
    wppSession,
    wppTokenConfigured: configuredSecret(db,config,keyNames.wppToken,config.WPP_CONNECT_TOKEN),
    evolutionUrl,
    evolutionInstance,
    evolutionPhone,
    evolutionApiKeyConfigured,
    evolutionWebhookSecretConfigured,
    evolutionConfigured: Boolean(evolutionUrl && evolutionInstance && evolutionPhone && evolutionApiKeyConfigured && evolutionWebhookSecretConfigured),
    evolutionWebhookUrl: new URL("/webhooks/whatsapp/evolution",config.API_PUBLIC_URL).toString(),
    officialReady: !senderValidationRequired && Boolean(businessAccountId && phoneNumberId && configuredSecret(db,config,keyNames.accessToken,config.WHATSAPP_ACCESS_TOKEN) && configuredSecret(db,config,keyNames.appSecret,config.WHATSAPP_APP_SECRET) && configuredSecret(db,config,keyNames.verifyToken,config.WHATSAPP_VERIFY_TOKEN)),
    webhookUrl: new URL("/webhooks/whatsapp",config.API_PUBLIC_URL).toString()
  };
}

export function saveWhatsAppIntegration(db: AppDatabase, config: Config, raw: unknown) {
  const input=metaSettingsSchema.parse(raw);
  const previous=readWhatsAppIntegration(db,config);
  const body={...input, mode: input.mode ?? previous.mode};
  if(body.mode==="HYBRID_PLUS") assertDistinctFromOfficial(body.evolutionPhone ?? previous.evolutionPhone, body.businessPhone ?? previous.businessPhone);
  const identityChanged=(body.businessPhone!==undefined&&body.businessPhone!==previous.businessPhone)
    ||(body.phoneNumberId!==undefined&&body.phoneNumberId!==previous.phoneNumberId)
    ||(body.businessAccountId!==undefined&&body.businessAccountId!==previous.businessAccountId)
    ||Boolean(body.accessToken);
  db.transaction(()=>{
  if(identityChanged) {
    db.prepare("DELETE FROM integration_settings WHERE key IN (?,?)").run(keyNames.tokenValidatedAt,keyNames.validatedDisplayPhone);
    if(previous.phoneNumberId||body.phoneNumberId||previous.accessTokenConfigured||body.accessToken) set(db,keyNames.senderValidationRequired,"1");
  }
  set(db,keyNames.mode,body.mode);
  set(db,"bot.mode",body.mode);
  if (body.businessAccountId!==undefined) set(db,keyNames.businessAccountId,body.businessAccountId);
  if (body.phoneNumberId!==undefined) set(db,keyNames.phoneNumberId,body.phoneNumberId);
  if (body.businessPhone!==undefined) set(db,keyNames.businessPhone,body.businessPhone);
  set(db,keyNames.graphVersion,body.graphVersion);
  if (body.humanSupportPhone!==undefined) setHumanSupportNumber(db,body.humanSupportPhone);
  if (body.otpTemplate!==undefined) set(db,keyNames.otpTemplate,body.otpTemplate);
  if (body.ownerAlertTemplate!==undefined) set(db,keyNames.ownerAlertTemplate,body.ownerAlertTemplate);
  if (body.decisionTemplate!==undefined) set(db,keyNames.decisionTemplate,body.decisionTemplate);
  set(db,keyNames.templateLanguage,body.templateLanguage);
  if (body.wppUrl!==undefined) set(db,keyNames.wppUrl,body.wppUrl);
  if (body.wppSession!==undefined) set(db,keyNames.wppSession,body.wppSession);
  if (body.evolutionUrl!==undefined) set(db,keyNames.evolutionUrl,body.evolutionUrl);
  if (body.evolutionInstance!==undefined) set(db,keyNames.evolutionInstance,body.evolutionInstance);
  if (body.evolutionPhone!==undefined) set(db,keyNames.evolutionPhone,body.evolutionPhone);
  if (body.accessToken) set(db,keyNames.accessToken,seal(config,body.accessToken));
  if (body.appSecret) set(db,keyNames.appSecret,seal(config,body.appSecret));
  if (body.verifyToken) set(db,keyNames.verifyToken,seal(config,body.verifyToken));
  if (body.wppToken) set(db,keyNames.wppToken,seal(config,body.wppToken));
  if (body.evolutionApiKey) set(db,keyNames.evolutionApiKey,seal(config,body.evolutionApiKey));
  if (body.evolutionWebhookSecret) set(db,keyNames.evolutionWebhookSecret,seal(config,body.evolutionWebhookSecret));
  })();
  return readWhatsAppIntegration(db,config);
}

export function generateAndSaveVerifyToken(db: AppDatabase, config: Config) {
  const token=randomBytes(32).toString("base64url");
  set(db,keyNames.verifyToken,seal(config,token));
  return token;
}

function effectiveSecret(db: AppDatabase, config: Config, key: string, envValue?: string) {
  return unseal(config,get(db,key)) ?? envValue;
}

export async function validateMetaWhatsApp(db: AppDatabase, config: Config) {
  const state=readWhatsAppIntegration(db,config);
  const accessToken=effectiveSecret(db,config,keyNames.accessToken,config.WHATSAPP_ACCESS_TOKEN);
  if (!accessToken) throw Object.assign(new Error("Ainda precisamos do System User Access Token para validar a integração oficial."),{statusCode:409});
  if (!state.businessAccountId) throw Object.assign(new Error("Informe o WABA ID antes de validar."),{statusCode:409});
  const url=`https://graph.facebook.com/${encodeURIComponent(state.graphVersion)}/${encodeURIComponent(state.businessAccountId)}/phone_numbers?fields=id,display_phone_number,verified_name,quality_rating`;
  const response=await fetch(url,{headers:{authorization:`Bearer ${accessToken}`},signal:AbortSignal.timeout(15_000)});
  const payload=await response.json().catch(()=>({})) as { data?: Array<{ id?: string; display_phone_number?: string; verified_name?: string; quality_rating?: string }>; error?: { message?: string } };
  if (!response.ok) throw Object.assign(new Error(payload.error?.message ? `A Meta recusou o token/API: ${payload.error.message}` : "A Meta recusou o token/API informado."),{statusCode:400});
  const phones=payload.data ?? [];
  const selected=state.phoneNumberId ? phones.find((item)=>item.id===state.phoneNumberId) : phones.find((item)=>normalizePhone(item.display_phone_number??"")===state.businessPhone);
  if (!selected) throw Object.assign(new Error("Token válido, mas o Phone Number ID informado não apareceu neste WABA."),{statusCode:409});
  if(!selected.id || normalizePhone(selected.display_phone_number??"")!==state.businessPhone) throw Object.assign(new Error("O número confirmado pela Meta é diferente do número Business salvo. Confira o telefone e o ID do número antes de ativar os envios."),{statusCode:409});
  // The network request may overlap a second Owner edit. Never validate stale settings.
  const current=readWhatsAppIntegration(db,config);
  if(current.businessPhone!==state.businessPhone||current.phoneNumberId!==state.phoneNumberId||current.businessAccountId!==state.businessAccountId||effectiveSecret(db,config,keyNames.accessToken,config.WHATSAPP_ACCESS_TOKEN)!==accessToken) throw Object.assign(new Error("A configuração mudou durante a conferência. Valide novamente os dados atuais."),{statusCode:409});
  const stamp=new Date().toISOString();
  db.transaction(()=>{
  set(db,keyNames.phoneNumberId,selected.id!);
  set(db,keyNames.senderValidationRequired,"0");
  set(db,keyNames.tokenValidatedAt,stamp);
  if (selected.display_phone_number) set(db,keyNames.validatedDisplayPhone,selected.display_phone_number);
  })();
  return { ok:true, validatedAt:stamp, phone:selected };
}

export function effectiveWhatsAppConfig(db: AppDatabase, config: Config): Config {
  const state=readWhatsAppIntegration(db,config);
  return {
    ...config,
    WHATSAPP_MODE: state.mode,
    EVOLUTION_URL: state.evolutionUrl || undefined,
    EVOLUTION_INSTANCE: state.evolutionInstance || undefined,
    EVOLUTION_PHONE: state.evolutionPhone || undefined,
    EVOLUTION_API_KEY: effectiveSecret(db,config,keyNames.evolutionApiKey,config.EVOLUTION_API_KEY),
    EVOLUTION_WEBHOOK_SECRET: effectiveSecret(db,config,keyNames.evolutionWebhookSecret,config.EVOLUTION_WEBHOOK_SECRET),
    WHATSAPP_BUSINESS_PHONE: state.mode==="EVOLUTION" ? (state.evolutionPhone || state.businessPhone) : state.businessPhone,
    WHATSAPP_SENDER_VALIDATION_REQUIRED:state.senderValidationRequired,
    WHATSAPP_BUSINESS_ACCOUNT_ID: state.businessAccountId || config.WHATSAPP_BUSINESS_ACCOUNT_ID,
    WHATSAPP_PHONE_NUMBER_ID: state.phoneNumberId || config.WHATSAPP_PHONE_NUMBER_ID,
    WHATSAPP_GRAPH_VERSION: state.graphVersion || config.WHATSAPP_GRAPH_VERSION,
    WHATSAPP_OTP_TEMPLATE: state.otpTemplate || config.WHATSAPP_OTP_TEMPLATE,
    WHATSAPP_OWNER_ALERT_TEMPLATE: state.ownerAlertTemplate || config.WHATSAPP_OWNER_ALERT_TEMPLATE,
    WHATSAPP_DECISION_TEMPLATE: state.decisionTemplate || config.WHATSAPP_DECISION_TEMPLATE,
    WHATSAPP_TEMPLATE_LANGUAGE: state.templateLanguage || config.WHATSAPP_TEMPLATE_LANGUAGE,
    WHATSAPP_ACCESS_TOKEN: state.mode==="DISABLED" || state.mode==="EVOLUTION" ? undefined : effectiveSecret(db,config,keyNames.accessToken,config.WHATSAPP_ACCESS_TOKEN),
    WHATSAPP_APP_SECRET: effectiveSecret(db,config,keyNames.appSecret,config.WHATSAPP_APP_SECRET),
    WHATSAPP_VERIFY_TOKEN: effectiveSecret(db,config,keyNames.verifyToken,config.WHATSAPP_VERIFY_TOKEN),
    WPP_CONNECT_URL: state.mode==="META_GROUPS" ? (state.wppUrl || config.WPP_CONNECT_URL) : "",
    WPP_CONNECT_SESSION: state.wppSession || config.WPP_CONNECT_SESSION,
    WPP_CONNECT_TOKEN: effectiveSecret(db,config,keyNames.wppToken,config.WPP_CONNECT_TOKEN)
  };
}

export const paymentProviderSchema = z.enum(["MERCADO_PAGO","ASAAS","PAGBANK","DISABLED"]);
export const paymentEnvironmentSchema = z.enum(["SANDBOX","PRODUCTION"]);
export type PaymentProvider = z.infer<typeof paymentProviderSchema>;
export type PaymentEnvironment = z.infer<typeof paymentEnvironmentSchema>;

const paymentSettingsSchema = z.object({
  provider: paymentProviderSchema,
  environment: paymentEnvironmentSchema,
  mercadoPagoAccessToken: z.string().trim().min(8).max(4096).optional(),
  mercadoPagoWebhookSecret: z.string().trim().min(8).max(4096).optional(),
  asaasApiKey: z.string().trim().min(8).max(4096).optional(),
  asaasWebhookToken: z.string().trim().min(32).max(255).optional(),
  pagBankToken: z.string().trim().min(8).max(4096).optional()
});

const paymentKeys = {
  provider:"payments.provider",
  environment:"payments.environment",
  mercadoPagoAccessToken:"payments.mercado_pago.access_token",
  mercadoPagoWebhookSecret:"payments.mercado_pago.webhook_secret",
  asaasApiKey:"payments.asaas.api_key",
  asaasWebhookToken:"payments.asaas.webhook_token",
  pagBankToken:"payments.pagbank.token"
} as const;

export type PaymentRuntimeConfig = {
  provider: PaymentProvider;
  environment: PaymentEnvironment;
  mercadoPagoAccessToken?: string;
  mercadoPagoWebhookSecret?: string;
  asaasApiKey?: string;
  asaasWebhookToken?: string;
  pagBankToken?: string;
  apiBaseUrl: string;
  apiPublicUrl: string;
};

export function readPaymentIntegration(db: AppDatabase, config: Config) {
  const fallbackProvider: PaymentProvider = config.MERCADO_PAGO_ACCESS_TOKEN ? "MERCADO_PAGO" : "DISABLED";
  const provider=paymentProviderSchema.catch(fallbackProvider).parse(get(db,paymentKeys.provider) ?? fallbackProvider);
  const environment=paymentEnvironmentSchema.catch(config.NODE_ENV==="production" ? "PRODUCTION" : "SANDBOX")
    .parse(get(db,paymentKeys.environment) ?? (config.NODE_ENV==="production" ? "PRODUCTION" : "SANDBOX"));
  const mercadoPagoAccessTokenConfigured=configuredSecret(db,config,paymentKeys.mercadoPagoAccessToken,config.MERCADO_PAGO_ACCESS_TOKEN);
  const mercadoPagoWebhookSecretConfigured=configuredSecret(db,config,paymentKeys.mercadoPagoWebhookSecret,config.MERCADO_PAGO_WEBHOOK_SECRET);
  const asaasApiKeyConfigured=configuredSecret(db,config,paymentKeys.asaasApiKey,config.ASAAS_API_KEY);
  const asaasWebhookTokenConfigured=configuredSecret(db,config,paymentKeys.asaasWebhookToken,config.ASAAS_WEBHOOK_TOKEN);
  const pagBankTokenConfigured=configuredSecret(db,config,paymentKeys.pagBankToken,config.PAGBANK_TOKEN);
  const ready = provider==="MERCADO_PAGO"
    ? mercadoPagoAccessTokenConfigured && mercadoPagoWebhookSecretConfigured
    : provider==="ASAAS"
      ? asaasApiKeyConfigured && asaasWebhookTokenConfigured
      : provider==="PAGBANK"
        ? pagBankTokenConfigured
        : false;
  return {
    provider,environment,ready,
    mercadoPagoAccessTokenConfigured,mercadoPagoWebhookSecretConfigured,
    asaasApiKeyConfigured,asaasWebhookTokenConfigured,pagBankTokenConfigured,
    webhookUrls:{
      mercadoPago:new URL("/payments/webhooks/mercado-pago",config.API_PUBLIC_URL).toString(),
      asaas:new URL("/payments/webhooks/asaas",config.API_PUBLIC_URL).toString(),
      pagBank:new URL("/payments/webhooks/pagbank",config.API_PUBLIC_URL).toString()
    }
  };
}

export function savePaymentIntegration(db: AppDatabase, config: Config, raw: unknown) {
  const body=paymentSettingsSchema.parse(raw);
  set(db,paymentKeys.provider,body.provider);
  set(db,paymentKeys.environment,body.environment);
  if (body.mercadoPagoAccessToken) set(db,paymentKeys.mercadoPagoAccessToken,seal(config,body.mercadoPagoAccessToken));
  if (body.mercadoPagoWebhookSecret) set(db,paymentKeys.mercadoPagoWebhookSecret,seal(config,body.mercadoPagoWebhookSecret));
  if (body.asaasApiKey) set(db,paymentKeys.asaasApiKey,seal(config,body.asaasApiKey));
  if (body.asaasWebhookToken) set(db,paymentKeys.asaasWebhookToken,seal(config,body.asaasWebhookToken));
  if (body.pagBankToken) set(db,paymentKeys.pagBankToken,seal(config,body.pagBankToken));
  return readPaymentIntegration(db,config);
}

export function effectivePaymentConfig(db: AppDatabase, config: Config): PaymentRuntimeConfig {
  const state=readPaymentIntegration(db,config);
  const apiBaseUrl=state.provider==="ASAAS"
    ? (state.environment==="PRODUCTION" ? "https://api.asaas.com/v3" : "https://api-sandbox.asaas.com/v3")
    : state.provider==="PAGBANK"
      ? (state.environment==="PRODUCTION" ? "https://api.pagseguro.com" : "https://sandbox.api.pagseguro.com")
      : "https://api.mercadopago.com";
  return {
    provider:state.provider,
    environment:state.environment,
    apiBaseUrl,
    apiPublicUrl:config.API_PUBLIC_URL,
    mercadoPagoAccessToken:effectiveSecret(db,config,paymentKeys.mercadoPagoAccessToken,config.MERCADO_PAGO_ACCESS_TOKEN),
    mercadoPagoWebhookSecret:effectiveSecret(db,config,paymentKeys.mercadoPagoWebhookSecret,config.MERCADO_PAGO_WEBHOOK_SECRET),
    asaasApiKey:effectiveSecret(db,config,paymentKeys.asaasApiKey,config.ASAAS_API_KEY),
    asaasWebhookToken:effectiveSecret(db,config,paymentKeys.asaasWebhookToken,config.ASAAS_WEBHOOK_TOKEN),
    pagBankToken:effectiveSecret(db,config,paymentKeys.pagBankToken,config.PAGBANK_TOKEN)
  };
}

// ===================== AUDITORIA I-01: YouTube gerenciavel pelo painel =====================
// O painel ja gerenciava WhatsApp e pagamentos em tempo real pelo banco, mas a
// YOUTUBE_API_KEY so era lida do ambiente (app.ts), exigindo variavel no Railway e
// reinicio. Isso contrariava a expectativa do produto de gerenciar as tres APIs no
// painel. Aqui a chave passa a seguir exatamente o mesmo padrao: valor cifrado em
// integration_settings, com o ambiente como fallback.
const youtubeKeys = { apiKey: "youtube.api_key" } as const;

const youtubeSettingsSchema = z.object({
  apiKey: z.string().trim().min(20).max(255).optional(),
  clear: z.boolean().optional()
});

export function readYouTubeIntegration(db: AppDatabase, config: Config) {
  const apiKeyConfigured = configuredSecret(db, config, youtubeKeys.apiKey, config.YOUTUBE_API_KEY);
  const source = unseal(config, get(db, youtubeKeys.apiKey)) ? "PANEL" : config.YOUTUBE_API_KEY ? "ENVIRONMENT" : "NONE";
  return {
    apiKeyConfigured,
    source,
    // STRUCTURAL_ONLY: sem chave o servidor nao confirma existencia, duracao nem
    // incorporacao do video; a conclusao de tarefa nao pode ser verificada.
    verification: apiKeyConfigured ? "VERIFIED" : "STRUCTURAL_ONLY",
    ready: apiKeyConfigured
  };
}

export function saveYouTubeIntegration(db: AppDatabase, config: Config, raw: unknown) {
  const body = youtubeSettingsSchema.parse(raw);
  if (body.clear) db.prepare("DELETE FROM integration_settings WHERE key=?").run(youtubeKeys.apiKey);
  else if (body.apiKey) set(db, youtubeKeys.apiKey, seal(config, body.apiKey));
  return readYouTubeIntegration(db, config);
}

/** Chave efetiva: painel tem precedencia, ambiente e fallback. */
export function effectiveYouTubeApiKey(db: AppDatabase, config: Config): string | undefined {
  return effectiveSecret(db, config, youtubeKeys.apiKey, config.YOUTUBE_API_KEY);
}

export function gitVersionInfo() {
  let sha="unknown", dirty=false;
  try {
    sha=execFileSync("git",["rev-parse","--short","HEAD"],{encoding:"utf8",timeout:800}).trim();
    dirty=Boolean(execFileSync("git",["status","--porcelain"],{encoding:"utf8",timeout:800}).trim());
  } catch { /* deployment can omit .git */ }
  return { appVersion:"0.1.0", gitSha:sha, dirty };
}
