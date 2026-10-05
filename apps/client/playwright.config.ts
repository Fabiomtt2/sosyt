import { defineConfig } from "@playwright/test";
import { resolve } from "node:path";
import { existsSync, mkdirSync, rmSync } from "node:fs";
const root = resolve("../.."), scratch = resolve(root, ".local-tmp");
mkdirSync(scratch, { recursive: true });
const database = resolve(scratch, "browser-test.db");
for (const suffix of ["", "-wal", "-shm"]) rmSync(database + suffix, { force: true });
const browser = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
export default defineConfig({
  testDir: "./e2e", workers: 1, timeout: 90_000, retries: 0,
  outputDir: resolve(scratch, "browser-results"),
  use: { baseURL: "http://127.0.0.1:17517", headless: true, launchOptions: { ...(browser && existsSync(browser) ? { executablePath: browser } : {}), args: ["--no-sandbox", "--disable-dev-shm-usage"] } },
  webServer: [
    { command: "node --import tsx apps/api/src/server.ts", cwd: root, url: "http://127.0.0.1:17333/health", timeout: 120_000, reuseExistingServer: false,
      env: { NODE_ENV: "test", PORT: "17333", DATABASE_PATH: database, WEB_APP_URL: "http://127.0.0.1:17517", API_PUBLIC_URL: "http://127.0.0.1:17333",
        AUTH_DEV_MODE: "true", PAYMENTS_DEV_MODE: "true", REQUIRE_GROUP_MEMBERSHIP: "true", ALLOWED_GROUP_CODES: "1,2",
        OWNER_FABIO_NAME: "Fabio0", OWNER_FABIO_ID: "+55 71 [9]9999-0001", OWNER_FABIO_SECRET: "e2e-owner-secret-32-characters-long", OWNER_WHATSAPP: "",
        YOUTUBE_API_KEY: "", MERCADO_PAGO_ACCESS_TOKEN: "", GOOGLE_CLIENT_ID: "", GOOGLE_CLIENT_SECRET: "", TMPDIR: scratch } },
    { command: "npm run dev -- --host 127.0.0.1 --port 17517 --strictPort", url: "http://127.0.0.1:17517", timeout: 120_000, reuseExistingServer: false,
      env: { VITE_API_URL: "http://127.0.0.1:17333", TMPDIR: scratch } }
  ]
});
