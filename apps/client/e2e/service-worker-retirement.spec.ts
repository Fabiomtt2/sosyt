import { test, expect } from "@playwright/test";

test("retired service worker does not register again on page load", async ({ page, request }) => {
  const html = await (await request.get("/")).text();
  expect(html).not.toContain("registerSW.js");
  const worker = await request.get("/sw.js");
  expect(worker.ok()).toBe(true);
  expect(await worker.text()).toContain("unregister");
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Continuar", exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("button", { name: "Continuar", exact: true })).toBeVisible();
  expect(await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length)).toBe(0);
});
