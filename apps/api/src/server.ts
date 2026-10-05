import { config as loadEnv } from "dotenv";
import { fileURLToPath } from "node:url";
import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";

loadEnv({ path: fileURLToPath(new URL("../../../.env", import.meta.url)), quiet: true });
const config = loadConfig();
const app = await buildApp(config);

await app.listen({ port: config.PORT, host: "0.0.0.0" });

