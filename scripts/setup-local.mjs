import { readFileSync, writeFileSync, existsSync, chmodSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { parse } from "dotenv";
const envPath = fileURLToPath(new URL("../.env", import.meta.url));
const template = readFileSync(new URL("../.env.example", import.meta.url),"utf8");
let content = existsSync(envPath) ? readFileSync(envPath,"utf8") : template;
const values = parse(content);
const defaults = parse(template);
const secrets = { JWT_SECRET: randomBytes(32).toString("hex"), AUTH_CODE_PEPPER: randomBytes(32).toString("hex"), OWNER_FABIO_SECRET: values.OWNER_ADMIN_SECRET || randomBytes(32).toString("hex"), OWNER_RAFAEL_SECRET: randomBytes(32).toString("hex"), YOUTUBE_TOKEN_ENCRYPTION_KEY: randomBytes(32).toString("base64") };
for (const [key, fallback] of Object.entries({...defaults,...secrets})) {
  if (values[key]) continue;
  const value = fallback;
  const pattern = new RegExp(`^${key}=.*$`,"m");
  if (pattern.test(content)) content = content.replace(pattern,`${key}=${value}`);
  else content += `\n${key}=${value}`;
}
writeFileSync(envPath,content,{mode:0o600}); chmodSync(envPath,0o600);
console.log("Configuração preservada e atualizada. Owners configuráveis Fabio0/Rafael0, marcador # e credenciais separadas. Identificadores/telefones reais devem permanecer apenas no .env local. Configure contatos/credenciais Meta para ativar o bot; nenhum segredo foi exibido.");
