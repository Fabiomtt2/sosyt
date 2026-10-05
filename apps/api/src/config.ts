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
  ALLOWED_GROUP_CODES: z.string().regex(/^[1-9]+(,[1-9]+)*$/).default("1,2"),
  OWNER_NAME: z.string().trim().min(2).max(80).default("Owner"),
  OWNER_LOGIN_ID: z.string().trim().min(3).max(80).default("owner"),
  OWNER_ADMIN_SECRET: z.string().min(32).optional(),
  OWNER_WHATSAPP: z.string().regex(/^\d{10,15}$/).optional(),
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
  for (const key of ["YOUTUBE_API_KEY", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "YOUTUBE_TOKEN_ENCRYPTION_KEY", "MERCADO_PAGO_ACCESS_TOKEN", "MERCADO_PAGO_WEBHOOK_SECRET", "OWNER_ADMIN_SECRET", "OWNER_WHATSAPP"]) {
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
  }
  return { ...parsed, DATABASE_PATH: parsed.DATABASE_PATH === ":memory:" ? ":memory:" : resolve(fileURLToPath(new URL("../../../", import.meta.url)), parsed.DATABASE_PATH) };
}
