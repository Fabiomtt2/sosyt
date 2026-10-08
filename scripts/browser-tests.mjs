import { spawn } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
const root = fileURLToPath(new URL("../", import.meta.url));
mkdirSync(join(root, ".local-tmp"), { recursive: true });
for (const suffix of ["", "-wal", "-shm"]) rmSync(join(root,".local-tmp","browser-test.db")+suffix,{force:true});
// Relative path stays inside this project and avoids Chromium's long Unix socket path.
const child = spawn(process.execPath, [join(root, "node_modules/@playwright/test/cli.js"), "test", ...process.argv.slice(2)], {
  cwd: join(root, "apps/client"), stdio: "inherit",
  env: { ...process.env, TMPDIR: "../../.local-tmp", PLAYWRIGHT_BROWSERS_PATH: join(root, ".playwright-browsers") }
});
child.on("error", (error) => { console.error(error.message); process.exitCode = 1; });
child.on("exit", (code) => { process.exitCode = code ?? 1; });
