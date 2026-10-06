import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const booleanString = z
  .enum(["true", "false"])
  .transform((value) => value === "true");

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3333),
  DATABASE_PATH: z.string().default("./apps/api/data/conexao-youtube.db"),
  JWT_SECRET: z.string().min(16).default("dev-secret-change-before-production"),
  AUTH_CODE_PEPPER: z.string().min(8).default("dev-auth-pepper"),
  AUTH_DEV_MODE: booleanString.default(true),
  PAYMENTS_DEV_MODE: booleanString.default(true),
  REQUIRE_GROUP_MEMBERSHIP: booleanString.default(true),
  ALLOWED_GROUP_CODES: z.string().regex(/^[1-9]\d{0,2}(,[1-9]\d{0,2})*$/).default("1,2"),
  OWNER_NAME: z.string().trim().min(2).max(80).default("Owner"),
  OWNER_LOGIN_ID: z.string().trim().min(3).max(80).default("owner"),
  OWNER_ADMIN_SECRET: z.string().min(32).optional(),
  OWNER_WHATSAPP: z.string().regex(/^[1-9]\d{7,14}$/).optional(),
  OWNER_ALERT_WHATSAPP: z.string().regex(/^[1-9]\d{7,14}$/).optional(),
  OWNER_FABIO_NAME: z.string().trim().min(2).max(80).default("Fabio0"),
  OWNER_FABIO_ID: z.string().trim().min(3).max(80).default("fabio0"),
  OWNER_FABIO_SECRET: z.string().min(1).optional(),
  OWNER_FABIO_WHATSAPP: z.string().regex(/^[1-9]\d{7,14}$/).optional(),
  OWNER_RAFAEL_NAME: z.string().trim().min(2).max(80).default("Rafael0"),
  OWNER_RAFAEL_ID: z.string().trim().min(3).max(80).default("rafael0"),
  OWNER_RAFAEL_SECRET: z.string().min(1).optional(),
  OWNER_RAFAEL_WHATSAPP: z.string().regex(/^[1-9]\d{7,14}$/).optional(),
  WHATSAPP_PHONE_NUMBER_ID: z.string().regex(/^\d+$/).optional(),
  WHATSAPP_BUSINESS_ACCOUNT_ID: z.string().regex(/^\d+$/).optional(),
  WHATSAPP_ACCESS_TOKEN: z.string().optional(),
  WHATSAPP_APP_SECRET: z.string().min(16).optional(),
  WHATSAPP_VERIFY_TOKEN: z.string().min(16).optional(),
  WHATSAPP_GRAPH_VERSION: z.string().regex(/^v\d+\.\d+$/).default("v24.0"),
  WHATSAPP_OTP_TEMPLATE: z.string().regex(/^[a-z0-9_]+$/).optional(),
  WHATSAPP_OWNER_ALERT_TEMPLATE: z.string().regex(/^[a-z0-9_]+$/).optional(),
  WHATSAPP_DECISION_TEMPLATE: z.string().regex(/^[a-z0-9_]+$/).optional(),
  WHATSAPP_TEMPLATE_LANGUAGE: z.string().default("pt_BR"),
  WHATSAPP_GROUPS_SYNC_ENABLED: booleanString.default(true),
  WHATSAPP_GROUPS_SYNC_MINUTES: z.coerce.number().int().min(1).max(1440).default(5),
  WPP_CONNECT_URL: z.string().url().default("http://127.0.0.1:21465"),
  WPP_CONNECT_SESSION: z.string().trim().regex(/^[A-Za-z0-9_-]{2,64}$/).default("sos-youtube"),
  WPP_CONNECT_TOKEN: z.string().optional(),

  WEB_APP_URL: z.string().url().default("http://localhost:5173"),
  ANDROID_APP_ORIGIN: z.string().url().default("https://localhost"),
  API_PUBLIC_URL: z.string().url().default("http://localhost:3333"),
  YOUTUBE_API_KEY: z.string().optional(),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GOOGLE_REDIRECT_URI: z.string().url().default("http://localhost:3333/youtube/callback"),
  YOUTUBE_TOKEN_ENCRYPTION_KEY: z.string().optional(),
  MERCADO_PAGO_ACCESS_TOKEN: z.string().optional(),
  MERCADO_PAGO_WEBHOOK_SECRET: z.string().optional()
});

export type Config = z.infer<typeof schema>;

export function loadConfig(overrides: Partial<Record<keyof Config, unknown>> = {}): Config {
  const values: Record<string, unknown> = { ...process.env, ...overrides };
  for (const key of ["YOUTUBE_API_KEY", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "YOUTUBE_TOKEN_ENCRYPTION_KEY", "MERCADO_PAGO_ACCESS_TOKEN", "MERCADO_PAGO_WEBHOOK_SECRET", "OWNER_ADMIN_SECRET", "OWNER_WHATSAPP", "OWNER_ALERT_WHATSAPP", "OWNER_FABIO_SECRET", "OWNER_RAFAEL_SECRET", "OWNER_FABIO_WHATSAPP", "OWNER_RAFAEL_WHATSAPP", "WHATSAPP_PHONE_NUMBER_ID", "WHATSAPP_BUSINESS_ACCOUNT_ID", "WHATSAPP_ACCESS_TOKEN", "WHATSAPP_APP_SECRET", "WHATSAPP_VERIFY_TOKEN", "WHATSAPP_OTP_TEMPLATE", "WHATSAPP_OWNER_ALERT_TEMPLATE", "WHATSAPP_DECISION_TEMPLATE", "WPP_CONNECT_TOKEN"]) {
    if (values[key] === "") delete values[key];
  }
  const parsed = schema.parse(values);
  if (parsed.NODE_ENV === "production") {
    if (parsed.AUTH_DEV_MODE || parsed.PAYMENTS_DEV_MODE) throw new Error("Modos de demonstração devem estar desativados em produção.");
    if (parsed.JWT_SECRET.length < 32 || /dev-secret|troque-/i.test(parsed.JWT_SECRET)) throw new Error("Configure um JWT_SECRET exclusivo com pelo menos 32 caracteres.");
    if (parsed.AUTH_CODE_PEPPER.length < 32 || /dev-auth|troque-/i.test(parsed.AUTH_CODE_PEPPER)) throw new Error("Configure um AUTH_CODE_PEPPER exclusivo com pelo menos 32 caracteres.");
    for (const url of [parsed.WEB_APP_URL, parsed.API_PUBLIC_URL, parsed.GOOGLE_REDIRECT_URI]) {
      if (!url.startsWith("https://")) throw new Error("URLs públicas devem usar HTTPS em produção.");
    }
    if (!parsed.YOUTUBE_TOKEN_ENCRYPTION_KEY || Buffer.from(parsed.YOUTUBE_TOKEN_ENCRYPTION_KEY, "base64").length !== 32) throw new Error("Configure uma chave de cifra de 32 bytes em produção.");
    if (parsed.MERCADO_PAGO_ACCESS_TOKEN && !parsed.MERCADO_PAGO_WEBHOOK_SECRET) throw new Error("Configure a assinatura dos webhooks de pagamento.");
    for (const [label, secret] of [["OWNER_FABIO_SECRET", parsed.OWNER_FABIO_SECRET], ["OWNER_RAFAEL_SECRET", parsed.OWNER_RAFAEL_SECRET]] as const) {
      if (secret && secret.length < 32) throw new Error(`${label} deve ter pelo menos 32 caracteres em produção.`);
    }
  }
  return { ...parsed, DATABASE_PATH: parsed.DATABASE_PATH === ":memory:" ? ":memory:" : resolve(fileURLToPath(new URL("../../../", import.meta.url)), parsed.DATABASE_PATH) };
}
