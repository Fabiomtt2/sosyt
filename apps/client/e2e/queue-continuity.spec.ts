import { expect, test } from "@playwright/test";
import Database from "better-sqlite3";
import { resolve } from "node:path";
import { ownerSession } from "./helpers/owner-session";

test("Passe abre outra fila, retry não duplica e sair conserva o link original", async ({ page, request }) => {
  test.setTimeout(150_000);
  const api = "http://127.0.0.1:17333";
  const owner = await ownerSession(request);
  const phone = "5571999990841", name = "Nina Continuidade";
  expect((await request.post(api + "/admin/members", {
    headers: { authorization: "Bearer " + owner }, data: { phone, name, groupCode: "1" }
  })).ok()).toBe(true);
  const requested = await request.post(api + "/auth/request-code", { data: { phone, name } });
  expect(requested.ok()).toBe(true);
  const verified = await request.post(api + "/auth/verify", { data: { phone, code: (await requested.json()).devCode } });
  expect(verified.ok()).toBe(true);
  const member = await verified.json(), headers = { authorization: "Bearer " + member.token };
  const db = new Database(resolve("../../.local-tmp/browser-test.db"));
  try {
    // An inventory fixture only. Entry, consumption and leave use the real HTTP routes.
    db.prepare("UPDATE wallets SET extra_slot_passes=1 WHERE user_id=?").run(member.user.id);
    await page.setViewportSize({ width: 1440, height: 960 });
    await page.goto("/?audit=queue-continuity");
    await page.evaluate(token => {
      localStorage.setItem("conexao_token", token);
      localStorage.setItem("conexao_active_role", "user");
    }, member.token);
    await page.reload();
    const originalUrl = "https://youtu.be/E2ECON00001";
    await page.getByPlaceholder("Cole a URL do seu vídeo no YouTube").fill(originalUrl);
    const submitted = page.waitForResponse(response => response.url() === api + "/rounds/current/submissions" && response.request().method() === "POST");
    await page.getByRole("button", { name: /^Salvar no espaço / }).first().click();
    const saved = await submitted;
    expect(saved.ok(), await saved.text()).toBe(true);
    const original = db.prepare("SELECT id,round_id,youtube_url FROM submissions WHERE user_id=? AND video_id='E2ECON00001'").get(member.user.id) as { id: string; round_id: string; youtube_url: string };
    expect(original).toBeTruthy();
    expect(db.prepare("SELECT source FROM round_participants WHERE round_id=? AND user_id=?").get(original.round_id, member.user.id)).toEqual({ source: "FREE" });

    const switcher = page.getByRole("region", { name: "Minhas filas" });
    const entered = page.waitForResponse(response => response.url() === api + "/queues/pass" && response.request().method() === "POST");
    await switcher.getByRole("button", { name: /Usar 1 Passe/ }).click();
    const passResponse = await entered;
    expect(passResponse.status()).toBe(200);
    const referenceId = passResponse.request().postDataJSON().referenceId as string;
    expect(referenceId).toMatch(/^[0-9a-f-]{36}$/i);
    const paid = (await passResponse.json()).queue as { id: string; number: number };
    expect(paid.id).not.toBe(original.round_id);
    await expect(switcher.getByRole("tab")).toHaveCount(2);
    await expect(switcher.getByRole("tab", { selected: true })).toContainText("Fila " + paid.number);

    const queues = await (await request.get(api + "/queues/mine", { headers })).json();
    expect(queues.queues.map((queue: { id: string }) => queue.id).sort()).toEqual([original.round_id, paid.id].sort());
    expect(queues.passesAvailable).toBe(0);
    expect(db.prepare("SELECT source FROM round_participants WHERE round_id=? AND user_id=?").get(paid.id, member.user.id)).toEqual({ source: "PASS" });
    const ledgerSnapshot = () => db.prepare("SELECT id,kind,amount_millis,reference_id FROM wallet_ledger WHERE user_id=? ORDER BY id").all(member.user.id);
    const beforeRetry = ledgerSnapshot();
    const retried = await request.post(api + "/queues/pass", { headers, data: { referenceId } });
    expect(retried.status()).toBe(200);
    expect((await retried.json()).queue.id).toBe(paid.id);
    expect((await (await request.get(api + "/queues/mine", { headers })).json()).passesAvailable).toBe(0);
    expect(ledgerSnapshot()).toEqual(beforeRetry);
    expect(db.prepare("SELECT COUNT(*) AS n FROM round_participants WHERE user_id=? AND left_at IS NULL").get(member.user.id)).toEqual({ n: 2 });

    const originalNumber = (queues.queues as Array<{ id: string; number: number }>).find(queue => queue.id === original.round_id)!.number;
    await switcher.getByRole("tab").filter({ has: page.locator("b", { hasText: new RegExp("^Fila " + originalNumber + "$") }) }).click();
    await switcher.getByRole("button", { name: "Sair da Fila " + originalNumber, exact: true }).click();
    const confirmation = switcher.getByRole("alertdialog");
    await expect(confirmation).toContainText("Seus links, histórico e progresso serão preservados.");
    const leaving = page.waitForResponse(response => response.url() === api + "/queues/" + original.round_id + "/leave" && response.request().method() === "POST");
    await confirmation.getByRole("button", { name: "Confirmar saída", exact: true }).click();
    expect((await leaving).status()).toBe(200);
    await expect(switcher.getByRole("tab")).toHaveCount(1);
    expect(db.prepare("SELECT id,round_id,youtube_url FROM submissions WHERE id=?").get(original.id)).toEqual(original);
    expect(db.prepare("SELECT left_at FROM round_participants WHERE round_id=? AND user_id=?").get(original.round_id, member.user.id)).toMatchObject({ left_at: expect.any(String) });
    expect(ledgerSnapshot()).toEqual(beforeRetry);
    expect((await (await request.get(api + "/queues/mine", { headers })).json()).queues.map((queue: { id: string }) => queue.id)).toEqual([paid.id]);
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 960 });
      await expect(switcher.getByRole("tab")).toHaveCount(1);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: resolve("../../docs/evidencias/queue-continuity-" + width + ".png"), animations: "disabled" });
    }
  } finally {
    db.close();
  }
});
