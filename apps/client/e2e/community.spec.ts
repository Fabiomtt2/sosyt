import { test, expect } from "@playwright/test";
import { resolve } from "node:path";

async function fillBrazilPhone(page: any, subscriber: string) {
  await page.getByRole("button", { name: "Selecionar país e DDI" }).click();
  await page.getByPlaceholder("Buscar país ou DDI").fill("Brasil");
  await page.getByRole("button", { name: "Brasil +55" }).click();
  await page.getByRole("button", { name: "Selecionar DDD do Brasil" }).click();
  const dddRail = page.locator(".ddd-rail");
  const before = await dddRail.evaluate((el: HTMLElement) => el.scrollLeft);
  await page.getByRole("button", { name: "Próximos DDDs" }).click();
  await page.waitForTimeout(250);
  expect(await dddRail.evaluate((el: HTMLElement) => el.scrollLeft)).toBeGreaterThan(before);
  await page.getByRole("button", { name: "DDD 71 BA" }).click();
  await page.getByLabel("WhatsApp").fill(subscriber);
}

test("login único, solicitação, aprovação Owner, participante e compra demo", async ({ page, request }) => {
  test.setTimeout(120_000);
  const evidence = resolve("../../docs/evidencias"), errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 1000 }); await page.goto("/");
  await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
  await page.reload();
  await page.evaluate(() => document.fonts.ready);
  await expect(page.getByRole("heading", { name: "Entre na sua conexão" })).toBeVisible();
  await expect(page.getByText("Quero participar", { exact: true })).toHaveCount(1);
  await expect(page.getByText("Sempre por escolha sua.", { exact: true })).toBeVisible();
  await expect(page.getByText("Sem views automáticas.", { exact: true })).toBeVisible();
  await expect(page.getByText("Sem reprodução oculta.", { exact: true })).toBeVisible();
  await expect(page.getByText("Você mantém o controle.", { exact: true })).toBeVisible();
  await expect(page.getByText("WhatsApp do Owner", { exact: true })).toHaveCount(0);

  const pageHeightBeforeCountry = await page.evaluate(() => document.documentElement.scrollHeight);
  await page.getByRole("button", { name: "Selecionar país e DDI" }).click();
  const countryPopover = page.getByRole("dialog", { name: "País e DDI" });
  await expect(countryPopover).toBeVisible();
  const countryBox = await countryPopover.boundingBox();
  expect(countryBox).not.toBeNull();
  expect(countryBox!.height).toBeLessThanOrEqual(360);
  expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBe(pageHeightBeforeCountry);
  const countryList = page.locator(".phone-option-list");
  const countryScrollBefore = await countryList.evaluate((el: HTMLElement) => el.scrollTop);
  await page.getByRole("button", { name: "Próximos países" }).click();
  await page.waitForTimeout(250);
  expect(await countryList.evaluate((el: HTMLElement) => el.scrollTop)).toBeGreaterThan(countryScrollBefore);
  await page.keyboard.press("Escape");
  await expect(countryPopover).toHaveCount(0);

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
      fontWeight: style.fontWeight,
      backgroundImage: style.backgroundImage,
      boxShadow: style.boxShadow,
      borderTopColor: style.borderTopColor
    };
  })));
  expect(Math.abs(joinMetrics.height - continueMetrics.height)).toBeLessThanOrEqual(1);
  const [joinBox, continueBox] = await Promise.all([joinButton.boundingBox(), continueButton.boundingBox()]);
  expect(joinBox).not.toBeNull(); expect(continueBox).not.toBeNull();
  expect(Math.abs((joinBox!.y + joinBox!.height / 2) - (continueBox!.y + continueBox!.height / 2))).toBeLessThanOrEqual(1);
  expect(joinMetrics.paddingTop).toBe(continueMetrics.paddingTop);
  expect(joinMetrics.paddingBottom).toBe(continueMetrics.paddingBottom);
  expect(joinMetrics.borderRadius).toBe(continueMetrics.borderRadius);
  expect(joinMetrics.fontWeight).toBe(continueMetrics.fontWeight);
  expect(joinMetrics.backgroundImage).toBe(continueMetrics.backgroundImage);
  expect(joinMetrics.backgroundImage).toBe("none");
  expect(joinMetrics.boxShadow).toBe(continueMetrics.boxShadow);
  expect(joinMetrics.borderTopColor).toBe(continueMetrics.borderTopColor);

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
  await expect(page.locator(".security-emblem")).toHaveCount(0);

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
  const countryTrigger = page.getByRole("button", { name: "Selecionar país e DDI" });
  await expect(countryTrigger).toContainText("DDI");
  await countryTrigger.click();
  const countryDialog = page.getByRole("dialog", { name: "País e DDI" });
  await expect(countryDialog).toBeVisible();
  const countryBounds = await countryDialog.boundingBox();
  expect(countryBounds).not.toBeNull();
  expect(countryBounds!.y + countryBounds!.height).toBeLessThanOrEqual(844);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  expect(await countryDialog.evaluate((el:HTMLElement)=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
  await expect(page.getByRole("button", { name: "Países anteriores" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Próximos países" })).toBeVisible();
  await page.getByRole("button", { name: "Próximos países" }).click();
  await expect.poll(async () => page.locator(".phone-option-list").evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
  await page.keyboard.press("Escape");
  await expect(countryDialog).toHaveCount(0);
  await fillBrazilPhone(page, "900000001");
  await page.getByRole("button", { name: "Selecionar DDD do Brasil" }).click();
  await page.keyboard.type("7");
  await expect(page.getByRole("button", { name: "DDD 71 BA" })).toBeVisible();
  await expect(page.getByRole("button", { name: "DDD 55 RS" })).toHaveCount(0);
  await page.keyboard.type("1");
  await expect(page.getByRole("button", { name: "DDD 71 BA" })).toBeVisible();
  await expect(page.getByRole("button", { name: "DDD 73 BA" })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Selecionar DDD do Brasil" }).click();
  await expect(page.getByRole("button", { name: "DDDs anteriores" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Próximos DDDs" })).toBeVisible();
  const dddCardsContained = await page.locator(".ddd-rail").evaluate((rail) => {
    const r=rail.getBoundingClientRect();
    return Array.from(rail.children).every((child) => {
      const c=(child as HTMLElement).getBoundingClientRect();
      const intersects=c.right>r.left && c.left<r.right;
      return !intersects || (c.left>=r.left-1 && c.right<=r.right+1);
    });
  });
  expect(dddCardsContained).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  await page.getByRole("button", { name: "Próximos DDDs" }).click();
  await expect.poll(async () => page.locator(".ddd-rail").evaluate((el) => el.scrollLeft)).toBeGreaterThan(0);
  await page.keyboard.press("Escape");
  const groupField = page.getByLabel("Digite o número correspondente ao seu grupo");
  await groupField.fill("123");
  await expect(groupField).toHaveValue("123");
  await groupField.fill("1");
  await page.getByRole("checkbox").check(); await page.getByRole("button", { name: "Enviar dados e continuar" }).click();
  await expect(page.getByRole("heading", { name: "Solicitação em análise" })).toBeVisible();
  await expect(page.getByText("Sua solicitação de cadastro foi registrada e será validada em breve.", { exact: true })).toBeVisible();
  await expect(page.getByText("Proteção contra cadastro repetido", { exact: true })).toBeVisible();
  await expect(page.getByText(/nunca é acionado por senha ou credencial incorreta/i)).toBeVisible();
  await expect(page.getByRole("button", { name: "Verificar situação" })).toBeVisible();
  await expect(page.getByText("Pode fechar esta página.", { exact: false })).toBeVisible();
  await page.screenshot({ path: resolve(evidence, "solicitacao-mobile.png"), fullPage: true });

  await page.reload();
  await expect(page.getByRole("heading", { name: "Solicitação em análise" })).toBeVisible();
  await expect(page.getByText("Sua solicitação continua aguardando análise dos Owners.", { exact: true })).toBeVisible();

  const ownerApproval = await request.post("http://127.0.0.1:17333/admin/login", { data: { name: "Fabio0", identifier: "+55 71 [9]9999-0001", groupCode: "#", secret: "sosyout" } });
  expect(ownerApproval.ok()).toBeTruthy();
  const approvalToken = (await ownerApproval.json()).token;
  const requestsOverview = await request.get("http://127.0.0.1:17333/admin/overview", { headers: { authorization: `Bearer ${approvalToken}` } });
  const requestData = (await requestsOverview.json()).requests.find((item: { name: string }) => item.name === "Pessoa E2E");
  expect(requestData).toBeTruthy();
  const approved = await request.post(`http://127.0.0.1:17333/admin/requests/${requestData.id}/decision`, { headers: { authorization: `Bearer ${approvalToken}` }, data: { status: "APPROVED", groupCode: "1" } });
  expect(approved.ok()).toBeTruthy();
  const pendingSeed = await request.post("http://127.0.0.1:17333/participation/request", {
    data: { name: "Pessoa Pendente", phone: "5571900000099", groupCode: "2", consent: true }
  });
  expect(pendingSeed.ok()).toBeTruthy();
  const pendingSeedState = await pendingSeed.json();

  await page.getByRole("button", { name: "Verificar situação" }).click();
  await expect(page.getByRole("heading", { name: "Cadastro aprovado" })).toBeVisible();
  await expect(page.getByText("seu acesso foi liberado no SOS YOUTUBER 1", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Voltar ao acesso" }).click();

  await page.evaluate(({ token, phone }) => localStorage.setItem("conexao_participation_request", JSON.stringify({ token, phone })), {
    token: pendingSeedState.requestToken,
    phone: "5571900000099"
  });
  await page.reload();
  await expect(page.getByRole("heading", { name: "Solicitação em análise" })).toBeVisible();
  await expect(page.getByText("Pessoa Pendente", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Acessar com outro número" }).click();

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByLabel("Seu nome ou como prefere ser chamado").fill("Fábio");
  await fillBrazilPhone(page, "999990001");
  await page.getByRole("button", { name: "Continuar", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Credencial", exact: true })).toBeVisible();
  await expect(page.getByLabel("Credencial administrativa")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Voltar para tela de login" })).toBeVisible();
  const ownerEnter = page.getByRole("button", { name: "Entrar", exact: true });
  const [ownerJoinBox, ownerEnterBox] = await Promise.all([joinButton.boundingBox(), ownerEnter.boundingBox()]);
  expect(ownerJoinBox).not.toBeNull(); expect(ownerEnterBox).not.toBeNull();
  expect(Math.abs((ownerJoinBox!.y + ownerJoinBox!.height / 2) - (ownerEnterBox!.y + ownerEnterBox!.height / 2))).toBeLessThanOrEqual(1);
  await page.getByLabel("Credencial", { exact: true }).fill("credencial-errada");
  await ownerEnter.click();
  await expect(page.getByRole("heading", { name: "Credencial", exact: true })).toBeVisible();
  await expect(page.getByText("Credencial incorreta. Confira e tente novamente.", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Solicitação em análise" })).toHaveCount(0);
  const pendingAfterOwnerError = await request.post("http://127.0.0.1:17333/participation/status", { data: { token: pendingSeedState.requestToken } });
  expect(pendingAfterOwnerError.ok()).toBeTruthy();
  expect((await pendingAfterOwnerError.json()).blockedUntil).toBe(pendingSeedState.blockedUntil);
  await page.getByLabel("Credencial", { exact: true }).fill("sosyout");
  await ownerEnter.click();
  await expect(page.getByRole("heading", { name: "Sua conexão, em números." })).toBeVisible();
  await expect(page.getByText("🟢 Usuário aprovado!", { exact: true })).toBeVisible();
  await expect(page.getByText("Pessoa E2E", { exact: true })).toBeVisible();
  await expect(page.getByText(/Aprovado em .* por Fabio0/)).toBeVisible();
  await expect(page.getByText("Novo Usuário!", { exact: true })).toBeVisible();
  await expect(page.getByText("🔴 Registro pendente", { exact: true })).toBeVisible();
  await expect(page.getByText("Pessoa Pendente", { exact: true })).toBeVisible();
  const pendingBadgeStyle = await page.locator(".new-user-badge").evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(pendingBadgeStyle).toBe("rgb(231, 247, 237)");
  await page.screenshot({ path: resolve(evidence, "owner-solicitacoes-desktop.png"), fullPage: true });
  await expect(page.getByRole("button", { name: /Fábio/ })).toBeVisible();
  await expect(page.getByText(/Sistema v0\.1\.0/)).toBeVisible();
  const transportCard = page.locator(".transport-status-card");
  await expect(transportCard.getByText("AINDA INATIVO", { exact: true })).toBeVisible();
  const transportBackground = await transportCard.evaluate((el: HTMLElement) => getComputedStyle(el).backgroundColor);
  expect(transportBackground).toBe("rgb(109, 111, 118)");

  await page.getByRole("button", { name: "Participantes", exact: true }).click();
  await expect(page.getByRole("button", { name: "Pessoa E2E", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Pessoa E2E", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Administrar participante" })).toBeVisible();
  await expect(page.getByText("ÁREA RESTRITA · OWNER", { exact: true })).toBeVisible();
  await expect(page.getByRole("dialog", { name: "Administrar participante" }).getByText(/por Fabio0/)).toBeVisible();
  await page.screenshot({ path: resolve(evidence, "owner-participante-desktop.png"), fullPage: true });
  await page.getByRole("button", { name: "Fechar participante" }).click();

  await page.getByRole("button", { name: "Grupos e acesso", exact: true }).click();
  await expect(page.getByRole("button", { name: "Explicar grupos e acesso" })).toBeVisible();
  await expect(page.getByText("Grupos 1–12 de 999", { exact: true })).toBeVisible();
  expect(await page.locator(".group-admin-card").count()).toBe(12);
  await page.getByRole("button", { name: "Próximos grupos", exact: true }).click();
  await expect(page.getByText("Grupos 13–24 de 999", { exact: true })).toBeVisible();
  await page.getByLabel("Ir para o grupo").fill("999");
  await page.getByRole("button", { name: "Localizar no carrossel" }).click();
  await expect(page.getByText("Grupos 997–999 de 999", { exact: true })).toBeVisible();
  const group999 = page.locator(".group-admin-card").filter({ hasText: "SOS YOUTUBER 999" });
  await expect(group999).toBeVisible();
  await group999.getByRole("button", { name: "Ativar grupo" }).click();
  await expect(group999.getByText("Ativo", { exact: true })).toBeVisible();
  await expect(page.locator(".manual-access-section").getByText("Código do país + DDD + Número do WhatsApp.", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Explicar grupos e acesso" }).click();
  await expect(page.getByRole("dialog", { name: "Ajuda sobre grupos e acesso" })).toBeVisible();
  await expect(page.getByText("Eles não são filas de vídeos:", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Fechar ajuda" }).click();
  await page.getByRole("button", { name: "Explicar autorização manual" }).click();
  await expect(page.getByRole("dialog", { name: "Ajuda sobre autorização manual" })).toBeVisible();
  await expect(page.getByText("rota administrativa excepcional", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Fechar ajuda" }).click();

  const integrationConfigButton = page.getByRole("button", { name: "Configurar integração" });
  const integrationButtonStyle = await integrationConfigButton.evaluate((element) => ({ backgroundColor:getComputedStyle(element).backgroundColor, color:getComputedStyle(element).color }));
  expect(integrationButtonStyle.backgroundColor).toBe("rgb(231, 43, 59)");
  expect(integrationButtonStyle.color).toBe("rgb(255, 255, 255)");
  await integrationConfigButton.click();
  const integrationDialog = page.getByRole("dialog", { name: "Configurar integração WhatsApp" });
  await expect(integrationDialog).toBeVisible();
  const integrationOverflowY = await integrationDialog.evaluate((el) => getComputedStyle(el).overflowY);
  expect(["auto", "scroll"]).toContain(integrationOverflowY);
  await expect(page.getByRole("radio", { name: /Meta Oficial/ })).toBeVisible();
  await expect(page.getByRole("radio", { name: /Híbrido/ })).toBeVisible();
  await page.getByRole("radio", { name: /Híbrido/ }).click();
  await page.getByRole("button", { name: "Explicar o modo selecionado" }).click();
  await expect(page.getByRole("dialog", { name: "O que muda no modo híbrido?" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "O que muda no modo híbrido?" })).toHaveCount(0);
  await expect(integrationDialog).toBeVisible();
  await expect(page.getByText("PENDENTE", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Credencial de acesso da Meta", { exact: true })).toBeVisible();
  await expect(page.getByText("Para ativar mensagens reais pela Meta", { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: "Explicar endereço do servidor complementar" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Explicar endereço de retorno da Meta" })).toBeVisible();
  const scrollMetrics = await integrationDialog.evaluate((el: HTMLElement) => ({ clientHeight:el.clientHeight,scrollHeight:el.scrollHeight,scrollTop:el.scrollTop }));
  expect(scrollMetrics.scrollHeight).toBeGreaterThan(scrollMetrics.clientHeight);
  await integrationDialog.evaluate((el: HTMLElement) => el.scrollTo({ top:el.scrollHeight, behavior:"instant" as ScrollBehavior }));
  expect(await integrationDialog.evaluate((el: HTMLElement) => el.scrollTop)).toBeGreaterThan(scrollMetrics.scrollTop);
  const astraStatus = await page.locator(".astra-status-grid article").first().evaluate((element) => {
    const style=getComputedStyle(element);
    return { color:style.color, backgroundColor:style.backgroundColor, borderLeftColor:style.borderLeftColor, borderLeftWidth:style.borderLeftWidth };
  });
  expect(astraStatus.backgroundColor).toBe("rgb(255, 255, 255)");
  expect(astraStatus.borderLeftColor).toBe("rgb(231, 43, 59)");
  expect(astraStatus.borderLeftWidth).toBe("4px");
  const hybridMode = page.getByRole("radio", { name: /Híbrido/ });
  const hybridModeBackground = await hybridMode.evaluate((element) => getComputedStyle(element).backgroundImage);
  expect(hybridModeBackground).toContain("linear-gradient");
  const hybridSplit = await hybridMode.locator(".mode-symbol.hybrid").evaluate((element) => {
    const [meta,youtube]=Array.from(element.children).map((child)=>child.getBoundingClientRect());
    return { metaWidth:meta.width, youtubeWidth:youtube.width, containerWidth:element.getBoundingClientRect().width };
  });
  expect(Math.abs(hybridSplit.metaWidth-hybridSplit.youtubeWidth)).toBeLessThanOrEqual(1);
  expect(Math.abs((hybridSplit.metaWidth+hybridSplit.youtubeWidth)-hybridSplit.containerWidth)).toBeLessThanOrEqual(1);
  await expect(hybridMode.locator(".youtube-half svg")).toBeVisible();
  expect(await integrationDialog.evaluate((el:HTMLElement)=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
  await page.screenshot({ path: resolve(evidence, "owner-whatsapp-config-desktop.png"), fullPage: true });
  await page.keyboard.press("Escape");
  await expect(integrationDialog).toHaveCount(0);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: resolve(evidence, "owner-mobile.png"), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: resolve(evidence, "owner-desktop.png"), fullPage: true });
  await page.getByRole("button", { name: /Fábio/ }).click();

  await page.getByLabel("Seu nome ou como prefere ser chamado").fill("Pessoa E2E"); await fillBrazilPhone(page, "900000001");
  await page.getByLabel("Digite o número correspondente ao seu grupo").fill("1"); await page.getByRole("button", { name: "Continuar", exact: true }).click();
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
    const member = await request.post("http://127.0.0.1:17333/admin/members", { headers: { authorization: `Bearer ${ownerToken}` }, data: { name: `Participante ${n}`, phone, groupCode: n % 2 ? "1" : "2" } }); expect(member.ok()).toBeTruthy();
    const login = await request.post("http://127.0.0.1:17333/auth/login", { data: { name: `Participante ${n}`, phone, groupCode: n % 2 ? "1" : "2" } }); expect(login.ok()).toBeTruthy();
    const token = (await login.json()).token;
    const shared = await request.get("http://127.0.0.1:17333/dashboard", { headers: { authorization: `Bearer ${token}` } });
    expect((await shared.json()).openRound.slots[0].userName).toBe("Pessoa E2E");
    const saved = await request.post("http://127.0.0.1:17333/rounds/current/submissions", { headers: { authorization: `Bearer ${token}` }, data: { url: `https://youtu.be/E2Evideo${String(n).padStart(3,"0")}` } }); expect(saved.status()).toBe(201);
  }
  await page.reload(); await expect(page.getByRole("heading", { name: "10 vídeos prontos para sua playlist" })).toBeVisible();
  await page.getByText("Ver os 10 vídeos, autores e horários", { exact: true }).click();
  await expect(page.locator(".cycle-details .slot.filled")).toHaveCount(10);
  await expect(page.locator(".cycle-details").getByRole("button", { name: "Criar playlist" })).toHaveCount(0);
  await expect(page.getByText("0 de 10 vídeos", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Esta fila já foi preenchida." })).toBeVisible();
  await expect(page.getByText("A próxima fila já pode estar sendo montada por outros participantes.", { exact: true })).toBeVisible();
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
  await expect(page.locator(".cycle-details").getByRole("button", { name: "Criar playlist" })).toHaveCount(0);
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
