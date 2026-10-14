import { expect, type APIRequestContext } from "@playwright/test";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

// The runner clears this fixture session with its isolated database. Reuse
// authenticated setup without weakening or exhausting the real login limiter.
export async function ownerSession(request: APIRequestContext): Promise<string> {
  const path = resolve("../../.local-tmp/browser-owner-session.json");
  const api = "http://127.0.0.1:17333";
  if (existsSync(path)) {
    const { token } = JSON.parse(readFileSync(path, "utf8"));
    const check = await request.get(api + "/admin/overview", {
      headers: { authorization: "Bearer " + token },
    });
    if (check.ok()) return token;
    expect([401, 403]).toContain(check.status());
  }
  const login = await request.post(api + "/admin/login", {
    data: { name: "Fabio0", identifier: "5571999990001", groupCode: "#",
      secret: "e2e-owner-secret-32-characters-long" },
  });
  expect(login.ok(), await login.text()).toBe(true);
  const { token } = await login.json();
  expect(typeof token).toBe("string");
  writeFileSync(path, JSON.stringify({ token }), { mode: 0o600 });
  return token;
}
