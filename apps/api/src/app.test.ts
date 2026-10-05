import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createDatabase, type AppDatabase } from "./db.js";
import { parseYouTubeVideoId } from "./youtube.js";

describe("URLs do YouTube", () => {
  it.each([
    ["https://www.youtube.com/watch?v=dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["https://youtu.be/dQw4w9WgXcQ?t=4", "dQw4w9WgXcQ"],
    ["https://youtube.com/shorts/dQw4w9WgXcQ", "dQw4w9WgXcQ"]
  ])("extrai %s", (url, expected) => expect(parseYouTubeVideoId(url)).toBe(expected));

  it("rejeita domínios parecidos", () => {
    expect(parseYouTubeVideoId("https://youtube.example/watch?v=dQw4w9WgXcQ")).toBeNull();
  });
  it.each(["dQw4w9WgXcQ","https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ","ftp://youtube.com/watch?v=dQw4w9WgXcQ","https://attacker@youtube.com/watch?v=dQw4w9WgXcQ"])("não aceita %s",(url) => expect(parseYouTubeVideoId(url)).toBeNull());

});

describe("fluxo colaborativo", () => {
  let db: AppDatabase;
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeEach(async () => {
    db = createDatabase(":memory:");
    app = await buildApp(loadConfig({ REQUIRE_GROUP_MEMBERSHIP: "false", NODE_ENV: "test", DATABASE_PATH: ":memory:", JWT_SECRET: "test-secret-with-enough-length", AUTH_CODE_PEPPER: "test-pepper", AUTH_DEV_MODE: "true" }), db);
  });
  afterEach(async () => { await app.close(); db.close(); });

  async function register(name: string, phone: string, groupCode = "123") {
    const request = await app.inject({ method: "POST", url: "/auth/request-code", payload: { name, phone, groupCode } });
    const devCode = request.json().devCode;
    const verification = await app.inject({ method: "POST", url: "/auth/verify", payload: { phone, code: devCode } });
    return verification.json().token as string;
  }

  it("persiste um link e impede uma segunda contribuição sem passe", async () => {
    const token = await register("Ana Teste", "71999990001");
    const first = await app.inject({ method: "POST", url: "/rounds/current/submissions", headers: { authorization: `Bearer ${token}` }, payload: { url: "https://youtu.be/dQw4w9WgXcQ" } });
    expect(first.statusCode).toBe(201);
    const second = await app.inject({ method: "POST", url: "/rounds/current/submissions", headers: { authorization: `Bearer ${token}` }, payload: { url: "https://youtu.be/9bZkp7q19f0" } });
    expect(second.statusCode).toBe(409);
    const dashboard = await app.inject({ method: "GET", url: "/dashboard", headers: { authorization: `Bearer ${token}` } });
    expect(dashboard.json().openRound.slots[0].userName).toBe("Ana Teste");
    expect(dashboard.json().wallet.total).toBe(9);
    expect(dashboard.headers["cache-control"]).toBe("no-store");
    expect(dashboard.headers["x-content-type-options"]).toBe("nosniff");
    db.prepare("UPDATE users SET name='Nome Alterado', group_code='456' WHERE phone=?").run("71999990001");
    const preserved = await app.inject({ method: "GET", url: "/dashboard", headers: { authorization: `Bearer ${token}` } });
    expect(preserved.json().openRound.slots[0]).toMatchObject({ userName: "Ana Teste", groupCode: "123" });

  });
});

