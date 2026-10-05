import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
const envPath = fileURLToPath(new URL("../.env", import.meta.url));
if (existsSync(envPath)) {
  console.log("A configuração .env já existe e foi preservada.");
} else {
  const template = readFileSync(new URL("../.env.example", import.meta.url), "utf8");
  const values = { JWT_SECRET: randomBytes(32).toString("hex"), AUTH_CODE_PEPPER: randomBytes(32).toString("hex"), OWNER_ADMIN_SECRET: randomBytes(32).toString("hex"), YOUTUBE_TOKEN_ENCRYPTION_KEY: randomBytes(32).toString("base64") };
  const content = template.replace(/^(JWT_SECRET|AUTH_CODE_PEPPER|OWNER_ADMIN_SECRET|YOUTUBE_TOKEN_ENCRYPTION_KEY)=.*$/gm, (_, key) => `${key}=${values[key]}`);
  writeFileSync(envPath, content, { flag: "wx", mode: 0o600 });
  console.log("Configuração local criada. Nome: Owner; ID: owner; grupo: 0. Consulte OWNER_ADMIN_SECRET no .env para entrar. Ajuste nome, ID e WhatsApp antes do uso real.");
}
