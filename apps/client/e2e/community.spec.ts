import { test, expect } from "@playwright/test";
import { resolve } from "node:path";

test("login único, solicitação, aprovação Owner, participante e compra demo", async ({ page, request }) => {
  const evidence = resolve("../../docs/evidencias"), errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 1000 }); await page.goto("/");
  await page.evaluate(() => document.fonts.ready);
  await expect(page.getByRole("heading", { name: "Entre na sua conexão" })).toBeVisible();
  await expect(page.getByText("Quero participar", { exact: true })).toHaveCount(1);
  await expect(page.getByText("Sempre por escolha sua.", { exact: true })).toBeVisible();
  await expect(page.getByText("Sem views automáticas.", { exact: true })).toBeVisible();
  await expect(page.getByText("Sem reprodução oculta.", { exact: true })).toBeVisible();
  await expect(page.getByText("Você mantém o controle.", { exact: true })).toBeVisible();
  await expect(page.getByText("WhatsApp do Owner", { exact: true })).toHaveCount(0);

  const helperIsSingleLine = await page.locator(".login-helper").evaluate((element) => {
    const style = getComputedStyle(element);
    const lineHeight = Number.parseFloat(style.lineHeight);
    return element.getBoundingClientRect().height <= lineHeight * 1.25;
  });
  expect(helperIsSingleLine).toBe(true);

  const lockupAligned = await page.locator(".brand-lockup").evaluate((element) => {
    const mark = element.querySelector(".brand-mark")!.getBoundingClientRect();
    const label = element.querySelector(".eyebrow")!.getBoundingClientRect();
    return Math.abs((mark.top + mark.height / 2) - (label.top + label.height / 2)) < 4;
  });
  expect(lockupAligned).toBe(true);

  const joinButton = page.getByRole("button", { name: "Quero participar", exact: true });
  const continueButton = page.getByRole("button", { name: "Continuar", exact: true });
  const [joinMetrics, continueMetrics] = await Promise.all([joinButton, continueButton].map((locator) => locator.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      height: element.getBoundingClientRect().height,
      paddingTop: style.paddingTop,
      paddingBottom: style.paddingBottom,
      borderRadius: style.borderRadius,
      fontWeight: style.fontWeight
    };
  })));
  expect(Math.abs(joinMetrics.height - continueMetrics.height)).toBeLessThanOrEqual(1);
  const [joinBox, continueBox] = await Promise.all([joinButton.boundingBox(), continueButton.boundingBox()]);
  expect(joinBox).not.toBeNull(); expect(continueBox).not.toBeNull();
  expect(Math.abs(joinBox!.y - continueBox!.y)).toBeLessThanOrEqual(3);
  expect(joinMetrics.paddingTop).toBe(continueMetrics.paddingTop);
  expect(joinMetrics.paddingBottom).toBe(continueMetrics.paddingBottom);
  expect(joinMetrics.borderRadius).toBe(continueMetrics.borderRadius);
  expect(joinMetrics.fontWeight).toBe(continueMetrics.fontWeight);

  const clusterIsIsolated = await page.locator(".participation-cluster").evaluate((element) => {
    const style = getComputedStyle(element);
    return style.backgroundColor === "rgba(0, 0, 0, 0)" && style.borderTopWidth === "0px" && style.boxShadow === "none";
  });
  expect(clusterIsIsolated).toBe(true);

  const securityWeights = await page.locator(".trust-copy").evaluate((element) => {
    const [first, second, last] = Array.from(element.children) as HTMLElement[];
    return [getComputedStyle(first).fontWeight, getComputedStyle(second).fontWeight, getComputedStyle(last).fontWeight].map(Number);
  });
  expect(securityWeights[0]).toBeLessThan(700);
  expect(securityWeights[1]).toBeLessThan(700);
  expect(securityWeights[2]).toBeGreaterThanOrEqual(700);
  const securityAligned = await page.locator(".trust-note").evaluate((element) => {
    const icon = element.querySelector(".security-emblem")!.getBoundingClientRect();
    const copy = element.querySelector(".trust-copy")!.getBoundingClientRect();
    return Math.abs((icon.top + icon.height / 2) - (copy.top + copy.height / 2)) <= 2;
  });
  expect(securityAligned).toBe(true);

  await page.screenshot({ path: resolve(evidence, "login-desktop.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: resolve(evidence, "login-mobile.png"), fullPage: true });
  await continueButton.click();
  await expect(page.getByText("Informe seu nome ou como prefere ser chamado.", { exact: true })).toBeVisible();
  await expect(page.getByText("Please fill out this field", { exact: false })).toHaveCount(0);
  await joinButton.click();
  await expect(page.getByRole("heading", { name: "Participar do SOS YouTube" })).toBeVisible();
  await expect(page.getByText(/continuaremos pelo WhatsApp/)).toBeVisible();
  await page.getByLabel("Seu nome ou como prefere ser chamado").fill("Pessoa E2E");
  const joinPhone = page.getByLabel("WhatsApp");
  await joinPhone.fill("5");
  await expect(joinPhone).toHaveValue("5");
  await joinPhone.fill("5571900000001");
  await page.getByLabel("SOS YOUTUBER — Digite a qual grupo você pertence").fill("1");
  await page.getByRole("checkbox").check(); await page.getByRole("button", { name: "Enviar dados e continuar" }).click();
  await expect(page.getByText("Sua solicitação de cadastro foi registrada e será validada em breve.", { exact: true })).toBeVisible();
  await expect(page.getByText("Pessoa E2E, agora só falta uma etapa para você participar do nosso sistema!", { exact: true })).toBeVisible();
  await expect(page.getByText("Nós entraremos em contato com seu número WhatsApp informado em breve para seguirmos com o registro.", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Continuar no WhatsApp" })).toHaveCount(0);
  await page.screenshot({ path: resolve(evidence, "solicitacao-mobile.png"), fullPage: true });
  await page.getByRole("button", { name: "Voltar para tela de login" }).click();

  await page.getByLabel("Seu nome ou como prefere ser chamado").fill("Pessoa Direta");
  await page.getByLabel("WhatsApp").fill("5571900000002");
  await page.getByLabel("SOS YOUTUBER — Digite a qual grupo você pertence").fill("1");
  await page.getByRole("button", { name: "Continuar", exact: true }).click();
  await expect(page.getByText("Sua solicitação de cadastro foi registrada e será validada em breve.", { exact: true })).toBeVisible();
  await expect(page.getByText("Pessoa Direta, agora só falta uma etapa para você participar do nosso sistema!", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Voltar para tela de login" }).click();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByLabel("Seu nome ou como prefere ser chamado").fill("Fábio");
  await page.getByLabel("WhatsApp").fill("+55 71 99999-0001");
  await page.getByRole("button", { name: "Continuar", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Credencial", exact: true })).toBeVisible();
  await expect(page.getByLabel("Credencial administrativa")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Voltar para tela de login" })).toBeVisible();
  const ownerEnter = page.getByRole("button", { name: "Entrar", exact: true });
  const [ownerJoinBox, ownerEnterBox] = await Promise.all([joinButton.boundingBox(), ownerEnter.boundingBox()]);
  expect(ownerJoinBox).not.toBeNull(); expect(ownerEnterBox).not.toBeNull();
  expect(Math.abs(ownerJoinBox!.y - ownerEnterBox!.y)).toBeLessThanOrEqual(3);
  await page.getByLabel("Credencial", { exact: true }).fill("sosyout");
  await ownerEnter.click();
  await expect(page.getByRole("heading", { name: "Sua conexão, em números." })).toBeVisible();
  await expect(page.getByText("Pessoa E2E", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /Fábio/ })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: resolve(evidence, "owner-mobile.png"), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
  const pessoaRequest = page.locator(".request-card").filter({ hasText: "Pessoa E2E" });
  await pessoaRequest.getByRole("button", { name: "Aprovar", exact: true }).click();
  await expect(page.getByText("Solicitação aprovada.", { exact: false })).toBeVisible();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: resolve(evidence, "owner-desktop.png"), fullPage: true });
  await page.getByRole("button", { name: /Fábio/ }).click();
  await page.getByLabel("Seu nome ou como prefere ser chamado").fill("Pessoa E2E"); await page.getByLabel("WhatsApp").fill("5571900000001");
  await page.getByLabel("SOS YOUTUBER — Digite a qual grupo você pertence").fill("1"); await page.getByRole("button", { name: "Continuar", exact: true }).click();
  await expect(page.getByLabel("Credencial", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Vamos montar a próxima seleção?" })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByPlaceholder("Cole a URL do seu vídeo no YouTube").fill("https://youtu.be/dQw4w9WgXcQ");
  await page.getByRole("button", { name: "Salvar no espaço 1" }).click();
  await expect(page.getByText("Você já participou desta fila.", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Comprar moedas" }).click();
  await page.getByLabel("E-mail do pagador").fill("e2e@example.com"); await page.getByLabel("CPF do pagador").fill("12345678901");
  await page.getByRole("button", { name: "Gerar Pix" }).click(); await page.getByRole("button", { name: "Simular aprovação" }).click();
  await expect(page.getByText("Pagamento confirmado:", { exact: false })).toBeVisible();
  await page.getByPlaceholder("Cole a URL do seu vídeo no YouTube").fill("https://youtu.be/9bZkp7q19f0");
  await page.getByRole("button", { name: "Salvar no espaço 2" }).click();
  await expect(page.getByText("2 de 10 vídeos", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
  await page.screenshot({ path: resolve(evidence, "participante-mobile.png"), fullPage: true });
  const owner = await request.post("http://127.0.0.1:17333/admin/login", { data: { name: "Fabio0", identifier: "+55 71 [9]9999-0001", groupCode: "#", secret: "sosyout" } });
  expect(owner.ok()).toBeTruthy(); const ownerToken = (await owner.json()).token;
  for (let n = 3; n <= 10; n++) {
    const phone = `55719000000${String(n).padStart(2, "0")}`;
    const member = await request.post("http://127.0.0.1:17333/admin/members", { headers: { authorization: `Bearer ${ownerToken}` }, data: { phone, groupCode: n % 2 ? "1" : "2" } }); expect(member.ok()).toBeTruthy();
    const login = await request.post("http://127.0.0.1:17333/auth/login", { data: { name: `Participante ${n}`, phone, groupCode: n % 2 ? "1" : "2" } }); expect(login.ok()).toBeTruthy();
    const token = (await login.json()).token;
    const shared = await request.get("http://127.0.0.1:17333/dashboard", { headers: { authorization: `Bearer ${token}` } });
    expect((await shared.json()).openRound.slots[0].userName).toBe("Pessoa E2E");
    const saved = await request.post("http://127.0.0.1:17333/rounds/current/submissions", { headers: { authorization: `Bearer ${token}` }, data: { url: `https://youtu.be/E2Evideo${String(n).padStart(3,"0")}` } }); expect(saved.status()).toBe(201);
  }
  await page.reload(); await expect(page.getByRole("heading", { name: "10 vídeos prontos para sua playlist" })).toBeVisible();
  await page.getByText("Ver os 10 vídeos, autores e horários", { exact: true }).click();
  await expect(page.locator(".cycle-details .slot.filled")).toHaveCount(10);
  await expect(page.locator(".cycle-details").getByRole("button", { name: "Criar playlist" })).toHaveCount(2);
  await expect(page.getByText("0 de 10 vídeos", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Finalize esta fila antes da próxima." })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
  await page.screenshot({ path: resolve(evidence, "ciclo-completo-mobile.png"), fullPage: true });
  await page.locator(".ready-card > button").click();
  await expect(page.getByRole("button",{name:"Continuar para Google/YouTube"})).toBeVisible();
  await page.screenshot({path:resolve(evidence,"consentimento-youtube-mobile.png"),fullPage:true});
  await page.getByRole("button",{name:"Cancelar criação"}).click();
  // External credentials are intentionally replaced only for this UI export contract.
  let exported = false;
  await page.route("**/dashboard", async (route) => {
    const response = await route.fetch(); const data = await response.json(); data.viewer.youtubeConnected = true;
    if (exported) data.readyRounds[0].export = { status: "SUCCESS", playlistId: "e2e-private-playlist" };
    await route.fulfill({ response, json: data });
  });
  await page.route("**/rounds/*/export", async (route) => { expect(route.request().method()).toBe("POST"); exported = true; await route.fulfill({ json: { playlistId: "e2e-private-playlist" } }); });
  await page.reload(); await expect(page.locator(".ready-card > button")).toHaveText("Criar playlist");
  await page.getByText("Ver os 10 vídeos, autores e horários", { exact: true }).click();
  await expect(page.locator(".cycle-details").getByRole("button", { name: "Criar playlist" })).toHaveCount(2);
  await page.screenshot({ path: resolve(evidence, "compartilhar-playlist-mobile.png"), fullPage: true });
  await page.locator(".ready-card > button").click();
  await expect(page.getByRole("dialog", {name:"Criação de playlist"})).toBeVisible();
  await page.getByRole("button",{name:"Confirmar criação"}).click();
  await expect(page.getByRole("link", { name: "Abrir no YouTube" })).toHaveAttribute("href", "https://www.youtube.com/playlist?list=e2e-private-playlist");
  await expect(page.getByRole("button", { name: "Acompanhar reprodução" })).toBeVisible();
  await page.getByRole("button", { name: "Acompanhar reprodução" }).click();
  await expect(page.getByRole("dialog", { name: "Acompanhar reprodução" })).toBeVisible();
  await expect(page.getByText("0% concluído")).toBeVisible();
  await page.getByRole("button", { name: "Fechar acompanhamento" }).click();
  expect(exported).toBe(true);
  // Simulate the Google round-trip, keeping the real local consent intent and automatic return flow.
  exported = false;
  let oauthConnected = false, authRound = "";
  await page.unroute("**/dashboard");
  await page.route("**/dashboard", async (route) => { const response=await route.fetch(); const data=await response.json(); data.viewer.youtubeConnected=oauthConnected; if(exported) data.readyRounds[0].export={status:"SUCCESS",playlistId:"e2e-private-playlist"}; await route.fulfill({response,json:data}); });
  await page.route("**/youtube/connect?**",async (route) => { authRound=new URL(route.request().url()).searchParams.get("roundId")!; expect(authRound).toBeTruthy(); oauthConnected=true; await route.fulfill({json:{url:`http://127.0.0.1:17517/?youtube=connected&round=${authRound}`}}); });
  await page.reload(); await page.locator(".ready-card > button").click();
  await page.getByRole("button",{name:"Continuar para Google/YouTube"}).click();
  await expect(page.getByRole("link",{name:"Abrir no YouTube"})).toBeVisible();
  expect(exported).toBe(true);
  expect(await page.evaluate(() => sessionStorage.getItem("conexao_creation_intent"))).toBeNull();
  expect(page.url()).not.toContain("youtube=connected");

  expect(errors).toEqual([]);
});
