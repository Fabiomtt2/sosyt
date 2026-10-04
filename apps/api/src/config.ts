import { resolve } from "node:path";
import { z } from "zod";

const booleanString = z
  .enum(["true", "false"])
  .default("false")
  .transform((value) => value === "true");

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3333),
  DATABASE_PATH: z.string().default("./apps/api/data/conexao-youtube.db"),
  JWT_SECRET: z.string().min(16).default("dev-secret-change-before-production"),
  AUTH_CODE_PEPPER: z.string().min(8).default("dev-auth-pepper"),
  AUTH_DEV_MODE: booleanString.default("true"),
  PAYMENTS_DEV_MODE: booleanString.default("true"),
  WEB_APP_URL: z.string().url().default("http://localhost:5173"),
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
  const parsed = schema.parse({ ...process.env, ...overrides });
  return { ...parsed, DATABASE_PATH: parsed.DATABASE_PATH === ":memory:" ? ":memory:" : resolve(parsed.DATABASE_PATH) };
}

