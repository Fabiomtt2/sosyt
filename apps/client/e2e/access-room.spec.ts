import { test, expect } from "@playwright/test";
import { resolve } from "node:path";
import { ownerSession } from "./helpers/owner-session";

test("Acesso e sala comunitária preservam identidade e controles administrativos", async ({ page, request }) => {
  test.setTimeout(150000);
  const api = "http://127.0.0.1:17333";
  const evidence = resolve("../../docs/evidencias");
  const phase = process.env.SOS_VISUAL_PHASE ?? "after";
  const errors: string[] = [];
  page.on("pageerror", e => errors.push(e.message));
  await page.goto("/?audit=access-room-" + phase);
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.getByRole("heading", { name: "Entre na sua conexão" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ animations: "disabled", path: resolve(evidence, "access-" + phase + "-" + width + ".png"), fullPage: true });
  }
  const owner = await ownerSession(request);
  const headers = { authorization: "Bearer " + owner };
  const session = await request.post(api + "/admin/participant-session", { headers });
  expect(session.ok()).toBe(true);
  const token = (await session.json()).token;
  const message = await request.post(api + "/chat/global", { headers: { authorization: "Bearer " + token }, data: { body: "Bem-vindos à nossa sala. Cada voz faz parte desta comunidade." } });
  expect(message.ok()).toBe(true);
  await page.evaluate(token => {
    localStorage.setItem("conexao_token", token);

    localStorage.setItem("conexao_active_role", "user");
  }, token);
  await page.evaluate(owner => localStorage.setItem("conexao_owner_token", owner), owner);
  await page.reload();
  const room = page.getByRole("complementary", { name: "Chat global da comunidade" });
  await expect(room.getByText("Bem-vindos à nossa sala. Cada voz faz parte desta comunidade.", { exact: true })).toBeVisible();
  await room.getByLabel("Mensagem para o chat global").fill("Uma segunda mensagem da administração.");
  await room.getByRole("button", { name: "Enviar mensagem à comunidade" }).click();
  await expect(room.getByText("Uma segunda mensagem da administração.", { exact: true })).toBeVisible();
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(room.getByLabel("Mensagem para o chat global")).toBeVisible();
    await page.screenshot({ animations: "disabled", path: resolve(evidence, "room-admin-" + phase + "-" + width + ".png"), fullPage: false });
  }
  // Isolated users exercise the real server rule and moderation of SUPER.
  async function member(phone: string, name: string) {
    expect((await request.post(api + "/admin/members", { headers, data: { phone, name, groupCode: "1" } })).ok()).toBe(true);
    const issued = await request.post(api + "/auth/request-code", { data: { phone, name } });
    const verified = await request.post(api + "/auth/verify", { data: { phone, code: (await issued.json()).devCode } });
    expect(verified.ok()).toBe(true);
    return verified.json();
  }
  const memberData = await member("5571999990321", "Voz da comunidade");
  const memberHeaders = { authorization: "Bearer " + memberData.token };
  expect((await request.get(api + "/chat/global", { headers: memberHeaders })).ok()).toBe(true);
  expect((await (await request.get(api + "/chat/global", { headers: memberHeaders })).json()).cooldownSeconds).toBe(30);
  const sup = await member("5571999990322", "Criadora SUPER");
  const supHeaders = { authorization: "Bearer " + sup.token };
  const purchase = await request.post(api + "/payments/pix", { headers: supHeaders, data: { product: "SUPER_30", email: "creator@example.test", cpf: "52998224725" } });
  expect(purchase.ok()).toBe(true);
  expect((await request.post(api + "/payments/" + (await purchase.json()).id + "/demo-approve", { headers: supHeaders })).ok()).toBe(true);
  expect((await request.post(api + "/chat/global", { headers: supHeaders, data: { body: "Um olá de quem cria junto com vocês." } })).ok()).toBe(true);
  await page.setViewportSize({ width: 1440, height: 900 });
  // Another session posts through the API; allow one 5s polling cycle plus transport.
  await expect(room.getByText("Um olá de quem cria junto com vocês.", { exact: true })).toBeVisible({timeout:12_000});
  await room.getByRole("button", { name: "Administrar sala" }).click();
  const superMessage = room.locator(".gc-msg-super").filter({ hasText: "Um olá de quem cria junto com vocês." });
  await superMessage.getByLabel("Ações da mensagem de Criadora SUPER").click();
  await superMessage.getByRole("button", { name: "Fixar aviso", exact: true }).click();
  await expect(room.getByLabel("Avisos fixados")).toContainText("Um olá de quem cria junto com vocês.");
  await superMessage.getByRole("button", { name: "Silenciar por 10 min", exact: true }).click();
  const muted = await request.post(api + "/chat/global", { headers: supHeaders, data: { body: "Não deverá ser enviada enquanto silenciada." } });
  expect((await muted.json()).code).toBe("CHAT_MUTED");
  await request.post(api + "/admin/chat/global/moderate", { headers, data: { userId: sup.user.id, action: "UNMUTE" } });
  await room.getByRole("button", { name: "Limpar mensagens da sala" }).click();
  await room.getByRole("button", { name: "Cancelar", exact: true }).click();
  expect((await (await request.get(api + "/chat/global", { headers: supHeaders })).json()).messages.length).toBeGreaterThan(0);
  await page.screenshot({ animations: "disabled", path: resolve(evidence, "room-moderation-1440.png"), fullPage: false });
  await room.getByRole("button", { name: "Administrar sala" }).click();
  await page.evaluate(token => {localStorage.setItem("conexao_token",token);localStorage.removeItem("conexao_owner_token");}, memberData.token);
  await page.reload();
  await expect(room.locator(".gc-note").filter({hasText:"Uma mensagem a cada 30 segundos"})).toBeVisible();
  await room.getByLabel("Mensagem para o chat global").fill("Olá, aqui estou com a comunidade.");
  await room.getByRole("button", { name: "Enviar mensagem à comunidade" }).click();
  await expect(room.getByText(/Você pode enviar novamente em/)).toBeVisible();
  await room.getByLabel("Mensagem para o chat global").fill("Posso preparar a próxima mensagem sem perder o rascunho.");
  await expect(room.getByRole("button", { name: "Enviar mensagem à comunidade" })).toBeDisabled();
  await expect(room.getByRole("button", { name: "Administrar sala" })).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 900 });
  await page.screenshot({ animations: "disabled", path: resolve(evidence, "room-member-cooldown-390.png"), fullPage: false });
  expect(errors).toEqual([]);
});
