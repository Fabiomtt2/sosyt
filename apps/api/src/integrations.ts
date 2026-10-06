import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { z } from "zod";
import type { Config } from "./config.js";
import type { AppDatabase } from "./db.js";

export const whatsappModeSchema = z.enum(["OFFICIAL", "HYBRID", "DISABLED"]);
export type WhatsAppMode = z.infer<typeof whatsappModeSchema>;

const metaSettingsSchema = z.object({
  mode: whatsappModeSchema.default("OFFICIAL"),
  businessAccountId: z.string().trim().regex(/^\d{5,40}$/).optional(),
  phoneNumberId: z.string().trim().regex(/^\d{5,40}$/).optional(),
  businessPhone: z.string().trim().max(30).optional(),
  graphVersion: z.string().trim().regex(/^v\d{2,3}\.\d$/).default("v23.0"),
  accessToken: z.string().trim().min(20).max(4096).optional(),
  appSecret: z.string().trim().min(8).max(512).optional(),
  verifyToken: z.string().trim().min(12).max(256).optional(),
  wppUrl: z.string().url().optional(),
  wppSession: z.string().trim().regex(/^[A-Za-z0-9_-]{2,64}$/).optional(),
  wppToken: z.string().trim().min(8).max(4096).optional()
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
  tokenValidatedAt: "whatsapp.meta.token_validated_at",
  validatedDisplayPhone: "whatsapp.meta.validated_display_phone",
  wppUrl: "whatsapp.wpp.url",
  wppSession: "whatsapp.wpp.session",
  wppToken: "whatsapp.wpp.token"
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

export function readWhatsAppIntegration(db: AppDatabase, config: Config) {
  const mode = whatsappModeSchema.catch("OFFICIAL").parse(get(db,keyNames.mode) ?? "OFFICIAL");
  const businessAccountId = get(db,keyNames.businessAccountId) ?? config.WHATSAPP_BUSINESS_ACCOUNT_ID;
  const phoneNumberId = get(db,keyNames.phoneNumberId) ?? config.WHATSAPP_PHONE_NUMBER_ID;
  const businessPhone = get(db,keyNames.businessPhone);
  const graphVersion = get(db,keyNames.graphVersion) ?? config.WHATSAPP_GRAPH_VERSION;
  const wppUrl = get(db,keyNames.wppUrl) ?? config.WPP_CONNECT_URL;
  const wppSession = get(db,keyNames.wppSession) ?? config.WPP_CONNECT_SESSION;
  return {
    mode,
    businessAccountId: businessAccountId ?? "",
    phoneNumberId: phoneNumberId ?? "",
    businessPhone: businessPhone ?? "",
    graphVersion,
    accessTokenConfigured: configuredSecret(db,config,keyNames.accessToken,config.WHATSAPP_ACCESS_TOKEN),
    appSecretConfigured: configuredSecret(db,config,keyNames.appSecret,config.WHATSAPP_APP_SECRET),
    verifyTokenConfigured: configuredSecret(db,config,keyNames.verifyToken,config.WHATSAPP_VERIFY_TOKEN),
    tokenValidatedAt: get(db,keyNames.tokenValidatedAt),
    validatedDisplayPhone: get(db,keyNames.validatedDisplayPhone),
    wppUrl,
    wppSession,
    wppTokenConfigured: configuredSecret(db,config,keyNames.wppToken,config.WPP_CONNECT_TOKEN),
    officialReady: Boolean(businessAccountId && phoneNumberId && configuredSecret(db,config,keyNames.accessToken,config.WHATSAPP_ACCESS_TOKEN) && configuredSecret(db,config,keyNames.appSecret,config.WHATSAPP_APP_SECRET) && configuredSecret(db,config,keyNames.verifyToken,config.WHATSAPP_VERIFY_TOKEN)),
    webhookUrl: new URL("/webhooks/whatsapp",config.API_PUBLIC_URL).toString()
  };
}

export function saveWhatsAppIntegration(db: AppDatabase, config: Config, raw: unknown) {
  const body=metaSettingsSchema.parse(raw);
  set(db,keyNames.mode,body.mode);
  if (body.businessAccountId!==undefined) set(db,keyNames.businessAccountId,body.businessAccountId);
  if (body.phoneNumberId!==undefined) set(db,keyNames.phoneNumberId,body.phoneNumberId);
  if (body.businessPhone!==undefined) set(db,keyNames.businessPhone,body.businessPhone);
  set(db,keyNames.graphVersion,body.graphVersion);
  if (body.wppUrl!==undefined) set(db,keyNames.wppUrl,body.wppUrl);
  if (body.wppSession!==undefined) set(db,keyNames.wppSession,body.wppSession);
  if (body.accessToken) set(db,keyNames.accessToken,seal(config,body.accessToken));
  if (body.appSecret) set(db,keyNames.appSecret,seal(config,body.appSecret));
  if (body.verifyToken) set(db,keyNames.verifyToken,seal(config,body.verifyToken));
  if (body.wppToken) set(db,keyNames.wppToken,seal(config,body.wppToken));
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
  const response=await fetch(url,{headers:{authorization:`Bearer ${accessToken}`}});
  const payload=await response.json().catch(()=>({})) as { data?: Array<{ id?: string; display_phone_number?: string; verified_name?: string; quality_rating?: string }>; error?: { message?: string } };
  if (!response.ok) throw Object.assign(new Error(payload.error?.message ? `A Meta recusou o token/API: ${payload.error.message}` : "A Meta recusou o token/API informado."),{statusCode:400});
  const phones=payload.data ?? [];
  const selected=state.phoneNumberId ? phones.find((item)=>item.id===state.phoneNumberId) : phones[0];
  if (!selected) throw Object.assign(new Error("Token válido, mas o Phone Number ID informado não apareceu neste WABA."),{statusCode:409});
  const stamp=new Date().toISOString();
  set(db,keyNames.tokenValidatedAt,stamp);
  if (selected.display_phone_number) set(db,keyNames.validatedDisplayPhone,selected.display_phone_number);
  return { ok:true, validatedAt:stamp, phone:selected };
}

export function effectiveWhatsAppConfig(db: AppDatabase, config: Config): Config {
  const state=readWhatsAppIntegration(db,config);
  return {
    ...config,
    WHATSAPP_BUSINESS_ACCOUNT_ID: state.businessAccountId || config.WHATSAPP_BUSINESS_ACCOUNT_ID,
    WHATSAPP_PHONE_NUMBER_ID: state.phoneNumberId || config.WHATSAPP_PHONE_NUMBER_ID,
    WHATSAPP_GRAPH_VERSION: state.graphVersion || config.WHATSAPP_GRAPH_VERSION,
    WHATSAPP_ACCESS_TOKEN: effectiveSecret(db,config,keyNames.accessToken,config.WHATSAPP_ACCESS_TOKEN),
    WHATSAPP_APP_SECRET: effectiveSecret(db,config,keyNames.appSecret,config.WHATSAPP_APP_SECRET),
    WHATSAPP_VERIFY_TOKEN: effectiveSecret(db,config,keyNames.verifyToken,config.WHATSAPP_VERIFY_TOKEN),
    WPP_CONNECT_URL: state.wppUrl || config.WPP_CONNECT_URL,
    WPP_CONNECT_SESSION: state.wppSession || config.WPP_CONNECT_SESSION,
    WPP_CONNECT_TOKEN: effectiveSecret(db,config,keyNames.wppToken,config.WPP_CONNECT_TOKEN)
  };
}

export function gitVersionInfo() {
  let sha="unknown", dirty=false;
  try {
    sha=execFileSync("git",["rev-parse","--short","HEAD"],{encoding:"utf8",timeout:800}).trim();
    dirty=Boolean(execFileSync("git",["status","--porcelain"],{encoding:"utf8",timeout:800}).trim());
  } catch { /* deployment can omit .git */ }
  return { appVersion:"0.1.0", gitSha:sha, dirty };
}
