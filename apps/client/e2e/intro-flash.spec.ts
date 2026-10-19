import { test, expect, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

const evidence = resolve("../../.local-tmp/intro-flash-evidence");
const heading = (page: Page) => page.getByRole("heading", { name: "Entre na sua conexão" });

async function freezeTimersBeforeNavigation(page: Page) {
  // Installed before navigation so slow hardware cannot consume the 1.9s intro.
  await page.clock.install({ time: new Date("2026-10-18T15:00:00.000Z") });
  await page.clock.pauseAt(new Date("2026-10-18T15:00:01.000Z"));
}

async function captureFrame(page: Page, width: number, milliseconds: number) {
  const flash = page.locator(".launch-flash");
  const animationCount = await flash.evaluate((element, time) => {
    const animations = element.getAnimations({ subtree: true });
    for (const animation of animations) {
      animation.pause();
      animation.currentTime = time;
    }
    return animations.length;
  }, milliseconds);
  expect(animationCount).toBeGreaterThanOrEqual(3);
  await page.screenshot({
    path: resolve(evidence, `intro-${width}-${milliseconds}ms.png`),
    animations: "allow",
    fullPage: false
  });
}

for (const width of [1440, 390]) {
  test(`pré-intro revela a Index e aparece uma vez por aba em ${width}px`, async ({ page }) => {
    test.setTimeout(90_000);
    mkdirSync(evidence, { recursive: true });
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await freezeTimersBeforeNavigation(page);
    await page.goto("/?audit=intro-flash-" + width);
    await expect(heading(page)).toBeVisible();
    const flash = page.locator(".launch-flash");
    await expect(flash).toHaveCount(1);
    await expect(flash).toHaveAttribute("aria-hidden", "true");
    await expect(flash).toHaveCSS("pointer-events", "none");
    // The actual form is mounted throughout; this is an overlay, never a loading gate.
    await expect(page.getByRole("button", { name: "Continuar", exact: true })).toBeVisible();
    for (const milliseconds of [250, 900, 1550]) {
      await captureFrame(page, width, milliseconds);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.clock.fastForward(2100);
    await expect(flash).toHaveCount(0);
    await expect(heading(page)).toBeVisible();
    await page.screenshot({ path: resolve(evidence, `intro-${width}-2100ms.png`), animations: "allow", fullPage: false });
    await page.reload();
    await expect(heading(page)).toBeVisible();
    await expect(flash).toHaveCount(0);
    expect(errors).toEqual([]);
  });
}

test("movimento reduzido abre a Index imediatamente", async ({ page }) => {
  test.setTimeout(30_000);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await freezeTimersBeforeNavigation(page);
  await page.goto("/?audit=intro-reduced-motion");
  await expect(heading(page)).toBeVisible();
  await expect(page.locator(".launch-flash")).toHaveCount(0);
});

test("ativar movimento reduzido durante a intro encerra a animação", async ({ page }) => {
  test.setTimeout(30_000);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await freezeTimersBeforeNavigation(page);
  await page.goto("/?audit=intro-motion-change");
  await expect(page.locator(".launch-flash")).toHaveCount(1);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(page.locator(".launch-flash")).toHaveCount(0);
  await expect(heading(page)).toBeVisible();
});
