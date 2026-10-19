import { config as loadEnv } from "dotenv";
import { fileURLToPath } from "node:url";
import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { backupBeforePaymentBenefitsMigration,backupBeforeGamificationMigration,backupBeforeBotRuntimeMigration,backupBeforeQueuePassMigration } from "./db.js";

loadEnv({ path: fileURLToPath(new URL("../../../.env", import.meta.url)), quiet: true });
const config = loadConfig();
if (config.NODE_ENV === "production") {
  const backup = await backupBeforePaymentBenefitsMigration(config.DATABASE_PATH) ?? await backupBeforeGamificationMigration(config.DATABASE_PATH) ?? await backupBeforeBotRuntimeMigration(config.DATABASE_PATH) ?? await backupBeforeQueuePassMigration(config.DATABASE_PATH);
  if (backup) console.info("SQLite backup preserved before additive migrations:", backup);
}
const app = await buildApp(config);

await app.listen({ port: config.PORT, host: "0.0.0.0" });


// deploy: motor server-time (auditoria) 2026-10-09T21:55Z
