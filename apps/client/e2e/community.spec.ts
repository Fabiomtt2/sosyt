import { execFileSync } from "node:child_process";
import { test, expect } from "@playwright/test";
import { resolve } from "node:path";

async function fillBrazilPhone(page: any, subscriber: string) {
  await page.getByRole("button", { name: "Selecionar país e DDI" }).click();
  const countryDialog=page.getByRole("dialog",{name:"País e DDI"});
  await expect(countryDialog).toBeVisible();
  await page.keyboard.type("5");
  await expect(page.locator(".phone-incremental-filter strong")).toHaveText("5");
  const afterFive=await page.locator(".phone-option-list button").evaluateAll((buttons)=>buttons.map((button)=>button.textContent??""));
  expect(afterFive.length).toBeGreaterThan(1);
  expect(afterFive.every((label)=>/\+5\d*/.test(label))).toBe(true);
  await page.keyboard.type("5");
  await expect(page.locator(".phone-incremental-filter strong")).toHaveText("55");
  await expect(page.getByRole("button",{name:"Brasil +55"})).toBeVisible();
  await page.waitForTimeout(1700);
  await expect(page.locator(".phone-incremental-filter strong")).toHaveText("55");
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
  test.setTimeout(240_000);
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

  await page.screenshot({animations:"disabled", path: resolve(evidence, "login-desktop.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({animations:"disabled", path: resolve(evidence, "login-mobile.png"), fullPage: true });
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
  await page.waitForTimeout(1600);
  await expect(page.getByRole("button", { name: "DDD 71 BA" })).toBeVisible();
  await expect(page.getByRole("button", { name: "DDD 73 BA" })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Selecionar DDD do Brasil" }).click();
  await expect(page.getByRole("button", { name: "DDDs anteriores" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Próximos DDDs" })).toBeVisible();
  const dddLayout = await page.locator(".ddd-rail").evaluate((rail) => {
    const r=rail.getBoundingClientRect();
    const cards=Array.from(rail.children).map((child)=>(child as HTMLElement).getBoundingClientRect());
    const visible=cards.filter((c)=>c.right>r.left&&c.left<r.right&&c.bottom>r.top&&c.top<r.bottom);
    const contained=cards.every((c)=>{
      const intersects=c.right>r.left && c.left<r.right;
      return !intersects || (c.left>=r.left-1 && c.right<=r.right+1);
    });
    return {contained,visibleCount:visible.length};
  });
  expect(dddLayout.contained).toBe(true);
  expect(dddLayout.visibleCount).toBe(15);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  await page.getByRole("button", { name: "Próximos DDDs" }).click();
  await expect.poll(async () => page.locator(".ddd-rail").evaluate((el) => el.scrollLeft)).toBeGreaterThan(0);
  await page.keyboard.press("Escape");
  await expect(page.getByLabel("Digite o número correspondente ao seu grupo")).toHaveCount(0);
  await page.getByRole("checkbox").check(); await page.getByRole("button", { name: "Enviar dados e continuar" }).click();
  await expect(page.getByRole("heading", { name: "Solicitação em análise" })).toBeVisible();
  await expect(page.getByText(/Sua solicitação foi registrada\. O grupo será preenchido automaticamente/)).toBeVisible();
  await expect(page.getByText("Proteção contra cadastro repetido", { exact: true })).toBeVisible();
  await expect(page.getByText(/nunca é acionado por senha ou credencial incorreta/i)).toBeVisible();
  await expect(page.getByRole("button", { name: "Verificar situação" })).toBeVisible();
  await expect(page.getByText("Pode fechar esta página.", { exact: false })).toBeVisible();
  await page.screenshot({animations:"disabled", path: resolve(evidence, "solicitacao-mobile.png"), fullPage: true });

  await page.reload();
  await expect(page.getByRole("heading", { name: "Solicitação em análise" })).toBeVisible();
  await expect(page.getByText("Seu pedido continua salvo e pode ser acompanhado neste aparelho.", { exact: true })).toBeVisible();

  const ownerApproval = await request.post("http://127.0.0.1:17333/admin/login", { data: { name: "Fabio0", identifier: "+55 71 [9]9999-0001", groupCode: "#", secret: "sosyout" } });
  expect(ownerApproval.ok()).toBeTruthy();
  const approvalToken = (await ownerApproval.json()).token;
  const requestsOverview = await request.get("http://127.0.0.1:17333/admin/overview", { headers: { authorization: `Bearer ${approvalToken}` } });
  const requestData = (await requestsOverview.json()).requests.find((item: { name: string }) => item.name === "Pessoa E2E");
  expect(requestData).toBeTruthy();
  const approved = await request.post("http://127.0.0.1:17333/admin/members", {
    headers: { authorization: `Bearer ${approvalToken}` },
    data: { phone:"5571900000001",groupCode:"1",name:"Pessoa E2E" }
  });
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
  await page.screenshot({animations:"disabled", path: resolve(evidence, "owner-solicitacoes-desktop.png"), fullPage: true });
  await expect(page.getByRole("button", { name: "Abrir menu do Owner Fábio" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Trocar avatar de Fábio" })).toBeVisible();
  const ownerHeaderBadge=page.locator(".header-admin-badge");
  await expect(ownerHeaderBadge).toHaveText("OWNER");
  const ownerBadgeStyle=await ownerHeaderBadge.evaluate((el)=>({background:getComputedStyle(el).backgroundImage,color:getComputedStyle(el).color,borderRadius:getComputedStyle(el).borderRadius}));
  expect(ownerBadgeStyle.background).toContain("linear-gradient");
  expect(ownerBadgeStyle.borderRadius).not.toBe("0px");
  await expect(page.getByText("Outubro de 2026", { exact:true })).toBeVisible();
  await expect(page.getByText("Painel sincronizado com o servidor", { exact:false })).toBeVisible();
  await page.getByRole("button", { name:"Explicar versão e sincronização do painel" }).click();
  await expect(page.getByRole("dialog", { name:"Ajuda sobre versão e sincronização" })).toBeVisible();
  await expect(page.getByText("não instala uma nova versão", { exact:false })).toBeVisible();
  await page.getByRole("button", { name:"Fechar ajuda" }).click();
  const transportCard = page.locator(".transport-status-card");
  await expect(transportCard.getByText("PARADO", { exact: true })).toBeVisible();
  const transportBackground = await transportCard.evaluate((el: HTMLElement) => getComputedStyle(el).backgroundColor);
  expect(transportBackground).toBe("rgb(109, 111, 118)");

  await page.getByRole("button", { name: "Participantes", exact: true }).click();
  await expect(page.getByRole("button", { name: "Pessoa E2E", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Pessoa E2E", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Administrar participante" })).toBeVisible();
  await expect(page.getByText("ÁREA RESTRITA · OWNER", { exact: true })).toBeVisible();
  await expect(page.getByRole("dialog", { name: "Administrar participante" }).getByText(/por Fabio0/)).toBeVisible();
  await page.screenshot({animations:"disabled", path: resolve(evidence, "owner-participante-desktop.png"), fullPage: true });
  await page.getByRole("button", { name: "Fechar participante" }).click();

  await page.getByRole("button", { name: "Compras", exact: true }).click();
  await page.setViewportSize({ width:1366, height:768 });
  await page.getByRole("button", { name: "Configurar pagamentos" }).click();
  const paymentDialog = page.getByRole("dialog", { name: "Configurar pagamentos" });
  await expect(paymentDialog).toBeVisible();
  const paymentGeometry = await paymentDialog.evaluate((el:HTMLElement)=>({
    top:el.getBoundingClientRect().top,bottom:el.getBoundingClientRect().bottom,width:el.getBoundingClientRect().width,
    clientHeight:el.clientHeight,scrollHeight:el.scrollHeight,overflowY:getComputedStyle(el).overflowY,
    bodyOverflow:getComputedStyle(document.body).overflow,
    backdropFilter:getComputedStyle(el.parentElement!).backdropFilter
  }));
  expect(paymentGeometry.top).toBeGreaterThanOrEqual(0);
  expect(paymentGeometry.bottom).toBeLessThanOrEqual(768);
  expect(paymentGeometry.width).toBeGreaterThan(700);
  expect(["auto","scroll"]).toContain(paymentGeometry.overflowY);
  expect(paymentGeometry.bodyOverflow).toBe("hidden");
  expect(paymentGeometry.backdropFilter).toContain("blur");
  await expect(page.getByRole("button", { name: "Explicar Mercado Pago" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Explicar Asaas" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Explicar PagBank" })).toBeVisible();
  await page.getByRole("button", { name: /Mercado Pago/ }).first().click();
  await expect(page.getByText("Dados da sua aplicação Mercado Pago", { exact:true })).toBeVisible();
  await page.getByRole("button", { name: "Explicar Mercado Pago" }).click();
  await expect(page.getByRole("dialog", { name: "Quando escolher Mercado Pago?" })).toBeVisible();
  await page.getByRole("button", { name: "Fechar explicação" }).click();
  await page.screenshot({animations:"disabled", path: resolve(evidence, "owner-pagamentos-after-audit-desktop.png"), fullPage:false });
  const paymentScroll = await paymentDialog.evaluate((el:HTMLElement)=>({clientHeight:el.clientHeight,scrollHeight:el.scrollHeight,scrollTop:el.scrollTop}));
  expect(paymentScroll.scrollHeight).toBeGreaterThan(paymentScroll.clientHeight);
  await paymentDialog.evaluate((el:HTMLElement)=>el.scrollTo({top:el.scrollHeight,behavior:"instant" as ScrollBehavior}));
  expect(await paymentDialog.evaluate((el:HTMLElement)=>el.scrollTop)).toBeGreaterThan(paymentScroll.scrollTop);
  await paymentDialog.evaluate((el:HTMLElement)=>el.scrollTo({top:0,behavior:"instant" as ScrollBehavior}));
  await page.setViewportSize({ width:390, height:844 });
  await page.screenshot({animations:"disabled", path: resolve(evidence, "owner-pagamentos-after-audit-mobile.png"), fullPage:false });
  expect(await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth)).toBe(false);
  await page.setViewportSize({ width:1366, height:768 });
  await page.getByRole("button", { name: "Fechar configuração de pagamentos" }).click();
  expect(await page.evaluate(()=>getComputedStyle(document.body).overflow)).not.toBe("hidden");

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
  await group999.getByRole("button", { name: "Habilitar" }).click();
  await expect(group999.getByText("Habilitado no SOS", { exact: true })).toBeVisible();
  await group999.getByRole("button", { name:"Gerenciar" }).click();
  const groupDialog=page.getByRole("dialog",{name:"Gerenciar SOS YOUTUBER 999"});
  await expect(groupDialog).toBeVisible();
  await expect(groupDialog.getByText("Habilitado no SOS",{exact:true})).toBeVisible();
  await expect(groupDialog.getByText("Vínculo externo",{exact:true})).toBeVisible();
  await expect(groupDialog.getByText("NÃO CONFIRMADO",{exact:true})).toBeVisible();
  expect(await page.evaluate(()=>getComputedStyle(document.body).overflow)).toBe("hidden");
  expect(await groupDialog.evaluate((el)=>getComputedStyle(el.parentElement!).backdropFilter)).toContain("blur");
  await page.screenshot({animations:"disabled",path:resolve(evidence,"owner-grupo-gerenciar-desktop.png"),fullPage:false});
  await page.getByRole("button",{name:"Fechar gerenciamento do grupo"}).click();
  expect(await page.evaluate(()=>getComputedStyle(document.body).overflow)).not.toBe("hidden");
  await expect(page.locator(".manual-access-section").getByText("Código do país + DDD + Número do WhatsApp.", { exact: true })).toBeVisible();
  const manualFieldGeometry = await page.locator(".manual-access-section").evaluate((section) => {
    const nameInput = section.querySelector("input[placeholder='Nome do participante']")!;
    const phoneField = section.querySelector(".phone-field")!;
    const name = nameInput.getBoundingClientRect();
    const phone = phoneField.getBoundingClientRect();
    const nameBlock = nameInput.closest(".field-block")!.getBoundingClientRect();
    const phoneBlock = phoneField.closest(".field-block")!.getBoundingClientRect();
    const nameLabel = nameInput.closest(".field-block")!.querySelector("label")!.getBoundingClientRect();
    const phoneLabel = phoneField.closest(".field-block")!.querySelector("label")!.getBoundingClientRect();
    return { nameY:name.y, phoneY:phone.y, nameHeight:name.height, phoneHeight:phone.height,
      nameBlockY:nameBlock.y,phoneBlockY:phoneBlock.y,nameLabelY:nameLabel.y,phoneLabelY:phoneLabel.y,
      nameLabelH:nameLabel.height,phoneLabelH:phoneLabel.height };
  });
  expect(Math.abs(manualFieldGeometry.nameY-manualFieldGeometry.phoneY)).toBeLessThanOrEqual(1);
  expect(Math.abs(manualFieldGeometry.nameHeight-manualFieldGeometry.phoneHeight)).toBeLessThanOrEqual(1);
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
  await page.setViewportSize({ width: 1366, height: 768 });
  await integrationConfigButton.click();
  const integrationDialog = page.getByRole("dialog", { name: "Configurar integração WhatsApp" });
  await expect(integrationDialog).toBeVisible();
  const modalGeometry = await integrationDialog.evaluate((el:HTMLElement) => {
    const modal=el.getBoundingClientRect();
    const title=el.querySelector(".astra-modal-title")!.getBoundingClientRect();
    const status=el.querySelector(".astra-status-grid")!.getBoundingClientRect();
    const firstSection=el.querySelector(".integration-section")!.getBoundingClientRect();
    const style=getComputedStyle(el);
    return {
      modalTop:modal.top,modalBottom:modal.bottom,modalWidth:modal.width,
      titleBottom:title.bottom,statusTop:status.top,statusBottom:status.bottom,sectionTop:firstSection.top,
      overflowX:style.overflowX,overflowY:style.overflowY,scrollWidth:el.scrollWidth,clientWidth:el.clientWidth,
      titleBackground:getComputedStyle(el.querySelector(".astra-modal-title")!).backgroundColor,
      titleHeight:title.height
    };
  });
  expect(modalGeometry.modalTop).toBeGreaterThanOrEqual(0);
  expect(modalGeometry.modalBottom).toBeLessThanOrEqual(768);
  expect(modalGeometry.statusTop).toBeGreaterThanOrEqual(modalGeometry.titleBottom-1);
  expect(modalGeometry.sectionTop).toBeGreaterThanOrEqual(modalGeometry.statusBottom-1);
  expect(modalGeometry.scrollWidth).toBeLessThanOrEqual(modalGeometry.clientWidth+1);
  expect(modalGeometry.titleBackground).toBe("rgba(0, 0, 0, 0)");
  expect(modalGeometry.titleHeight).toBeLessThan(140);
  await page.screenshot({animations:"disabled", path: resolve(evidence, "owner-whatsapp-config-top-desktop.png"), fullPage: true });
  const integrationOverflowY = await integrationDialog.evaluate((el) => getComputedStyle(el).overflowY);
  expect(["auto", "scroll"]).toContain(integrationOverflowY);
  await expect(page.getByRole("radio", { name: /Meta Oficial/ })).toBeVisible();
  await expect(page.getByRole("radio", { name: /Meta \+ Grupos/ })).toBeVisible();
  await expect(page.getByRole("radio", { name: /Evolution Gateway/ })).toBeVisible();
  await page.getByRole("radio", { name: /Meta \+ Grupos/ }).click();
  await expect(page.locator(".astra-status-grid article").first().locator("strong")).toHaveText("META + GRUPOS");
  await page.getByRole("button", { name: "Explicar o modo selecionado" }).click();
  await expect(page.getByRole("dialog", { name: "O que muda em Meta + Grupos?" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "O que muda em Meta + Grupos?" })).toHaveCount(0);
  await page.getByRole("radio", { name: /Evolution Gateway/ }).click();
  await expect(page.locator(".astra-status-grid article").first().locator("strong")).toHaveText("EVOLUTION");
  await expect(page.locator(".astra-status-grid article").nth(1).locator("span")).toHaveText("Gateway Evolution");
  await expect(page.getByPlaceholder("https://evolution.seudominio.com")).toBeVisible();
  await expect(page.getByLabel("Credencial de acesso da Meta", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Para ativar mensagens reais pela Meta", { exact: false })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Explicar endereço de retorno da Meta" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Validar conexão" })).toHaveCount(0);
  await page.getByRole("radio", { name: /Meta \+ Grupos/ }).click();
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
  const hybridMode = page.getByRole("radio", { name: /Meta \+ Grupos/ });
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
  await page.screenshot({animations:"disabled", path: resolve(evidence, "owner-whatsapp-config-desktop.png"), fullPage: true });
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 1440, height: 1000 });
  await expect(integrationDialog).toHaveCount(0);

  await page.setViewportSize({ width: 390, height: 844 });
  const activeOwnerTab=page.locator(".owner-tabs button.active");
  const activeOwnerTabBox=await activeOwnerTab.boundingBox();
  expect(activeOwnerTabBox).not.toBeNull();
  expect(activeOwnerTabBox!.x).toBeGreaterThanOrEqual(-1);
  expect(activeOwnerTabBox!.x+activeOwnerTabBox!.width).toBeLessThanOrEqual(391);
  await page.screenshot({animations:"disabled", path: resolve(evidence, "owner-mobile.png"), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({animations:"disabled", path: resolve(evidence, "owner-desktop.png"), fullPage: true });

  // Percurso real Owner -> participante administrativo -> Owner. O retorno deve
  // renovar a sessão administrativa e jamais cair na proteção de cadastro de 120 min.
  await page.getByRole("button", { name: "Abrir menu do Owner Fábio" }).click();
  let ownerDeskMenu=page.getByRole("dialog",{name:"Menu do Owner"});
  await expect(ownerDeskMenu).toBeVisible();
  const ownerOpenRound=ownerDeskMenu.locator(".owner-round-row.open").first();
  const ownerRoundTitle=ownerOpenRound.getByText("Fila 1",{exact:true});
  const ownerRoundProgress=ownerOpenRound.locator(".owner-round-progress");
  await expect(ownerRoundTitle).toBeVisible();
  await expect(ownerRoundProgress).toHaveText(/\d+\/10 vídeos · recebendo contribuições/);
  const ownerRoundGeometry=await ownerOpenRound.evaluate((el:HTMLElement)=>{
    const title=el.querySelector(".owner-round-copy>strong")!.getBoundingClientRect();
    const progress=el.querySelector(".owner-round-progress")!.getBoundingClientRect();
    return {titleBottom:title.bottom,progressTop:progress.top,titleLeft:title.left,progressLeft:progress.left};
  });
  expect(ownerRoundGeometry.progressTop).toBeGreaterThanOrEqual(ownerRoundGeometry.titleBottom-1);
  expect(Math.abs(ownerRoundGeometry.titleLeft-ownerRoundGeometry.progressLeft)).toBeLessThanOrEqual(1);
  await page.keyboard.press("Escape");
  await expect(ownerDeskMenu).toHaveCount(0);
  await page.getByRole("button", { name: "Abrir menu do Owner Fábio" }).click();
  ownerDeskMenu=page.getByRole("dialog",{name:"Menu do Owner"});
  await ownerDeskMenu.getByRole("button",{name:"Participar da fila",exact:true}).click();
  await expect(page.getByRole("heading",{name:"Vamos montar a próxima seleção?"})).toBeVisible();
  await expect(page.locator(".header-admin-badge")).toHaveText("ADMIN");
  await expect(page.getByText("QUADRO COMPARTILHADO · FILA 1",{exact:true})).toBeVisible();
  await page.screenshot({animations:"disabled",path:resolve(evidence,"participante-admin-desktop.png"),fullPage:true});
  await page.getByRole("button",{name:"Abrir menu da minha conta"}).click();
  const adminAccountMenu=page.getByRole("dialog",{name:"Minha conta"});
  await expect(adminAccountMenu.getByText("Owner principal · Fila atual 1",{exact:true})).toBeVisible();
  await expect(adminAccountMenu.getByText("Fila atual:",{exact:false})).toBeVisible();
  await expect(adminAccountMenu.getByText("Grupo SOS YOUTUBER #",{exact:false})).toHaveCount(0);
  await page.screenshot({animations:"disabled",path:resolve(evidence,"participante-admin-conta-desktop.png"),fullPage:false});
  await adminAccountMenu.getByRole("button",{name:"Voltar ao painel administrativo"}).click();
  await expect(page.getByRole("heading",{name:"Sua conexão, em números."})).toBeVisible();
  await expect(page.getByText("Proteção contra cadastro repetido",{exact:true})).toHaveCount(0);
  await expect(page.locator(".header-admin-badge")).toHaveText("OWNER");

  await page.getByRole("button", { name: "Abrir menu do Owner Fábio" }).click();
  ownerDeskMenu=page.getByRole("dialog",{name:"Menu do Owner"});
  await expect(ownerDeskMenu).toBeVisible();
  await ownerDeskMenu.getByRole("button",{name:/Sair do painel Owner/}).click();
  await expect(page.getByRole("heading",{name:"Vamos montar a próxima seleção?"})).toBeVisible();
  await expect(page.locator(".header-admin-badge")).toHaveText("ADMIN");
  await page.getByRole("button",{name:"Abrir menu da minha conta"}).click();
  const postOwnerLogoutMenu=page.getByRole("dialog",{name:"Minha conta"});
  await postOwnerLogoutMenu.getByRole("button",{name:"Sair da minha conta"}).click();
  await expect(page.getByRole("heading",{name:"Entre na sua conexão"})).toBeVisible();

  await page.getByLabel("Seu nome ou como prefere ser chamado").fill("Pessoa E2E"); await fillBrazilPhone(page, "900000001");
  await expect(page.getByLabel("Digite o número correspondente ao seu grupo")).toHaveCount(0); await page.getByRole("button", { name: "Continuar", exact: true }).click();
  await expect(page.getByLabel("Credencial", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Vamos montar a próxima seleção?" })).toBeVisible();

  const avatarTrigger=page.getByRole("button",{name:"Trocar avatar de Pessoa E2E"});
  const avatarGeometry=await avatarTrigger.evaluate((el:HTMLElement)=>{
    const box=el.getBoundingClientRect(),style=getComputedStyle(el);
    const avatar=el.querySelector(".header-avatar") as HTMLElement;
    const avatarBox=avatar.getBoundingClientRect(),avatarStyle=getComputedStyle(avatar);
    return {width:box.width,height:box.height,radius:parseFloat(style.borderTopLeftRadius),overflow:style.overflow,
      avatarWidth:avatarBox.width,avatarHeight:avatarBox.height,avatarRadius:parseFloat(avatarStyle.borderTopLeftRadius),avatarOverflow:avatarStyle.overflow};
  });
  expect(Math.abs(avatarGeometry.width-avatarGeometry.height)).toBeLessThanOrEqual(1);
  expect(avatarGeometry.radius).toBeGreaterThanOrEqual(avatarGeometry.width/2-1);
  // O botão externo permite o badge ADMIN/OWNER ultrapassar a borda; quem recorta
  // a imagem é o avatar interno, que permanece perfeitamente circular.
  expect(avatarGeometry.overflow).toBe("visible");
  expect(Math.abs(avatarGeometry.avatarWidth-avatarGeometry.avatarHeight)).toBeLessThanOrEqual(1);
  expect(avatarGeometry.avatarRadius).toBeGreaterThanOrEqual(avatarGeometry.avatarWidth/2-1);
  expect(avatarGeometry.avatarOverflow).toBe("hidden");

  await page.screenshot({animations:"disabled",path:resolve(evidence,"participante-inicio-desktop.png"),fullPage:true});
  const banners=page.getByRole("region",{name:"Boas-vindas ao SOS YouTuber"});
  await banners.getByRole("button",{name:"Próximo banner"}).click();
  await expect(banners.getByText("Seu tempo continua com você.",{exact:true})).toBeVisible();
  await banners.locator("img").evaluate(async image=>{await (image as HTMLImageElement).decode();});
  await page.screenshot({animations:"disabled",path:resolve(evidence,"banner-tempo-desktop.png"),fullPage:false});
  await banners.getByRole("button",{name:"Próximo banner"}).click();
  await expect(banners.getByText("Uma contribuição extra na mesma fila.",{exact:true})).toBeVisible();
  await page.setViewportSize({width:390,height:844});
  await banners.locator("img").evaluate(async image=>{await (image as HTMLImageElement).decode();});
  await page.screenshot({animations:"disabled",path:resolve(evidence,"banner-passe-mobile.png"),fullPage:false});
  await page.setViewportSize({width:1440,height:1000});
  await banners.getByRole("button",{name:"Próximo banner"}).click();

  await avatarTrigger.click();
  const avatarDialog=page.getByRole("dialog",{name:"Escolher avatar"});
  await expect(avatarDialog).toBeVisible();
  await expect(avatarDialog.getByRole("button",{name:/Escolher avatar /})).toHaveCount(34);
  await expect(avatarDialog.getByText("Tirar foto",{exact:true})).toHaveCount(0);
  await expect(avatarDialog.getByText("Galeria",{exact:true})).toHaveCount(0);
  await page.screenshot({animations:"disabled",path:resolve(evidence,"participante-avatar-desktop.png"),fullPage:false});
  await page.setViewportSize({width:390,height:844});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth)).toBe(false);
  await page.screenshot({animations:"disabled",path:resolve(evidence,"participante-avatar-mobile.png"),fullPage:false});
  await avatarDialog.getByRole("button",{name:"Escolher avatar 17",exact:true}).click();
  await expect(avatarDialog).toHaveCount(0);
  await expect(avatarTrigger.locator(".header-avatar.preset")).toBeVisible();
  await avatarTrigger.click();
  const selectedAvatarDialog=page.getByRole("dialog",{name:"Escolher avatar"});
  await expect(selectedAvatarDialog.getByRole("button",{name:"Escolher avatar 17",exact:true})).toHaveClass(/selected/);
  await page.keyboard.press("Escape");
  await expect(selectedAvatarDialog).toHaveCount(0);
  await expect(avatarTrigger).toBeFocused();
  expect(await page.evaluate(()=>document.body.style.overflow)).not.toBe("hidden");

  await page.getByRole("button",{name:"Abrir menu da minha conta"}).click();
  const accountMenu=page.getByRole("dialog",{name:"Minha conta"});
  await expect(accountMenu).toBeVisible();
  await expect(accountMenu.getByRole("region",{name:"Tempo acumulado de acompanhamento"})).toBeVisible();
  await expect(accountMenu.getByText("Foto do perfil",{exact:true})).toBeVisible();
  await expect(accountMenu.getByRole("button",{name:"Tirar foto"})).toBeVisible();
  await expect(accountMenu.getByRole("button",{name:"Galeria"})).toBeVisible();
  await expect(accountMenu.getByRole("button",{name:"Usar iniciais"})).toBeVisible();
  await page.getByRole("button",{name:"Fechar minha conta"}).click();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByPlaceholder("Cole a URL do seu vídeo no YouTube").fill("https://youtu.be/dQw4w9WgXcQ");
  await page.getByRole("button", { name: "Salvar no espaço 1" }).click();
  await expect(page.getByText("Você já participou desta fila.", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Ver moedas e passes" }).click();
  const storeDialog=page.getByRole("dialog",{name:"Loja SOS YouTuber"});
  await expect(storeDialog).toBeVisible();
  expect(await page.evaluate(()=>document.body.style.overflow)).toBe("hidden");
  await storeDialog.locator("summary").focus();
  await page.keyboard.press("Tab");
  await expect(storeDialog.getByRole("button",{name:"Fechar loja"})).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(storeDialog.locator("summary")).toBeFocused();
  await storeDialog.evaluate(el=>el.scrollTop=0);

  await expect(storeDialog.getByText("10 moedas + 1 passe bônus",{exact:false})).toBeVisible();
  await expect(storeDialog.getByRole("heading",{name:"1 passe",exact:true})).toBeVisible();
  await page.screenshot({animations:"disabled",path:resolve(evidence,"participante-loja-mobile.png"),fullPage:false});
  expect(await storeDialog.evaluate((el)=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
  await page.setViewportSize({width:1366,height:768});
  await storeDialog.locator(".store-editorial-art").evaluateAll(async images=>{await Promise.all(images.map(image=>(image as HTMLImageElement).decode()));});
  const productGeometry=await storeDialog.locator(".store-product").evaluateAll(cards=>cards.map(card=>{
    const image=card.querySelector("img")!.getBoundingClientRect(),copy=card.querySelector(".store-product-copy")!.getBoundingClientRect();
    return image.bottom<=copy.top+1;
  }));
  expect(productGeometry).toEqual([true,true]);
  await page.screenshot({animations:"disabled",path:resolve(evidence,"participante-loja-desktop.png"),fullPage:false});
  expect(await storeDialog.evaluate((el)=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
  await page.setViewportSize({width:390,height:844});
  await storeDialog.getByRole("button",{name:"Quero este pacote"}).click();
  await page.getByLabel("E-mail do pagador").fill("e2e@example.com"); await page.getByLabel("CPF do pagador").fill("12345678901");
  await page.getByRole("button", { name: /Gerar Pix de/ }).click(); await page.getByRole("button", { name: "Simular confirmação" }).click();
  await expect(page.getByText("Pagamento confirmado:", { exact: false })).toBeVisible();
  await page.getByPlaceholder("Cole a URL do seu vídeo no YouTube").fill("https://youtu.be/9bZkp7q19f0");
  await page.getByRole("button", { name: "Salvar no espaço 2" }).click();
  await expect(page.getByText("2 de 10 vídeos", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
  await page.screenshot({animations:"disabled", path: resolve(evidence, "participante-mobile.png"), fullPage: true });
  const ownerToken = approvalToken; // Reuse the Owner session already authenticated in this scenario.
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
  await page.screenshot({animations:"disabled", path: resolve(evidence, "ciclo-completo-mobile.png"), fullPage: true });
  await page.locator(".ready-card > button").click();
  await expect(page.getByRole("button",{name:"Continuar para Google/YouTube"})).toBeVisible();
  await page.screenshot({animations:"disabled",path:resolve(evidence,"consentimento-youtube-mobile.png"),fullPage:true});
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
  await page.screenshot({animations:"disabled", path: resolve(evidence, "compartilhar-playlist-mobile.png"), fullPage: true });
  await page.locator(".ready-card > button").click();
  await expect(page.getByRole("dialog", {name:"Criação de playlist"})).toBeVisible();
  await page.getByRole("button",{name:"Confirmar criação"}).click();
  await expect(page.getByRole("link", { name: "Abrir playlist no YouTube" })).toHaveAttribute("href", "https://www.youtube.com/playlist?list=e2e-private-playlist");
  // Ao terminar a criação, o app abre o acompanhamento automaticamente.
  await expect(page.getByRole("dialog", { name: "Acompanhar vídeos da fila" })).toBeVisible();
  const watchDialog=page.getByRole("dialog",{name:"Acompanhar vídeos da fila"});
  await expect(watchDialog.getByText("0% concluído",{exact:true})).toBeVisible();
  await expect(watchDialog.getByText(/0:00 de tempo verificado acumulado/)).toBeVisible();
  await watchDialog.getByText("Acompanhamento opcional no computador",{exact:true}).click();
  const companion=watchDialog.locator(".companion-panel");
  await expect(companion.getByRole("button",{name:"Gerar código de conexão"})).toBeDisabled();
  await companion.getByRole("checkbox").check();
  await companion.getByRole("button",{name:"Gerar código de conexão"}).click();
  const code=await companion.locator(".companion-pairing>strong").innerText();
  expect(code).toMatch(/^[A-F0-9]{12}$/);
  const apiUrl=await companion.getByLabel("Servidor do companion").inputValue();
  // Run the actual Python HTTP client against the isolated test API.
  const pythonResult=JSON.parse(execFileSync("python3",["-c",[
    "import json,sys",
    "sys.path.insert(0,sys.argv[1])",
    "from sos_companion import CompanionApi,Observation",
    "data=json.load(sys.stdin)",
    "client=CompanionApi(data['server'])",
    "device=client.pair(data['code'])",
    "observed=client.observe(Observation('ADVANCING',5,120))",
    "print(json.dumps({'device':device,'observed':observed}))"
  ].join("\n"),resolve("../../companion")],{input:JSON.stringify({server:apiUrl,code}),encoding:"utf8",timeout:15000}));
  const device=pythonResult.device;
  expect(pythonResult.observed.rewards.verifiedSeconds).toBe(0);
  await expect(companion.getByRole("button",{name:"Desconectar Meu computador"})).toBeVisible({timeout:10000});
  const download=await request.get("/downloads/sos-companion.py");
  expect(download.ok()).toBe(true);expect(await download.text()).toContain("class CompanionWindow");
  await companion.scrollIntoViewIfNeeded();
  await page.screenshot({animations:"disabled",path:resolve(evidence,"companion-mobile.png")});
  await page.setViewportSize({width:1440,height:1000});
  await companion.scrollIntoViewIfNeeded();
  await page.screenshot({animations:"disabled",path:resolve(evidence,"companion-desktop.png")});
  await companion.getByRole("button",{name:"Desconectar Meu computador"}).click();
  await expect(companion.getByText("Desconectado",{exact:true})).toBeVisible();
  expect((await request.get(apiUrl+"/companion/device",{headers:{authorization:"Bearer "+device.deviceToken}})).status()).toBe(401);
  await page.setViewportSize({width:390,height:844});

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
  await expect(page.getByRole("link",{name:"Abrir playlist no YouTube"})).toBeVisible();
  expect(exported).toBe(true);
  expect(await page.evaluate(() => sessionStorage.getItem("conexao_creation_intent"))).toBeNull();
  expect(page.url()).not.toContain("youtube=connected");

  // Badge ADMIN em uma submissão real da nova fila: deve ficar inteiro dentro
  // do envelope reservado do avatar, sem depender de bottom negativo.
  await page.unroute("**/dashboard");
  const adminParticipantSession=await request.post("http://127.0.0.1:17333/admin/participant-session",{
    headers:{authorization:`Bearer ${ownerToken}`}
  });
  expect(adminParticipantSession.ok()).toBeTruthy();
  const adminParticipantToken=(await adminParticipantSession.json()).token as string;
  const adminSaved=await request.post("http://127.0.0.1:17333/rounds/current/submissions",{
    headers:{authorization:`Bearer ${adminParticipantToken}`},
    data:{url:"https://youtu.be/E2EADM00001"}
  });
  expect(adminSaved.status()).toBe(201);
  await page.evaluate((token)=>{
    localStorage.setItem("conexao_token",token);
    localStorage.setItem("conexao_active_role","user");
  },adminParticipantToken);
  await page.reload();
  await expect(page.getByRole("heading",{name:"Vamos montar a próxima seleção?"})).toBeVisible();
  const adminQueueContributor=page.locator(".slot-contributor").filter({has:page.locator(".admin-badge")}).first();
  await expect(adminQueueContributor).toBeVisible();
  await expect(adminQueueContributor.locator(".admin-badge")).toHaveText("ADMIN");
  await expect(adminQueueContributor).toContainText("Participação administrativa");
  await expect(adminQueueContributor).not.toContainText("SOS YOUTUBER #");
  const badgeGeometry=await adminQueueContributor.evaluate((el:HTMLElement)=>{
    const shell=el.querySelector(".slot-avatar-shell.has-admin-badge") as HTMLElement;
    const badge=el.querySelector(".admin-badge") as HTMLElement;
    const shellBox=shell.getBoundingClientRect(),badgeBox=badge.getBoundingClientRect(),cardBox=el.closest(".slot")!.getBoundingClientRect();
    return {
      shellTop:shellBox.top,shellBottom:shellBox.bottom,
      badgeTop:badgeBox.top,badgeBottom:badgeBox.bottom,
      badgeLeft:badgeBox.left,badgeRight:badgeBox.right,
      cardLeft:cardBox.left,cardRight:cardBox.right
    };
  });
  expect(badgeGeometry.badgeTop).toBeGreaterThanOrEqual(badgeGeometry.shellTop-1);
  expect(badgeGeometry.badgeBottom).toBeLessThanOrEqual(badgeGeometry.shellBottom+1);
  expect(badgeGeometry.badgeLeft).toBeGreaterThanOrEqual(badgeGeometry.cardLeft-1);
  expect(badgeGeometry.badgeRight).toBeLessThanOrEqual(badgeGeometry.cardRight+1);
  await adminQueueContributor.scrollIntoViewIfNeeded();
  await adminQueueContributor.locator("xpath=ancestor::*[contains(concat(' ',normalize-space(@class),' '),' slot ')]").screenshot({animations:"disabled",path:resolve(evidence,"participante-admin-badge-fila.png")});

  expect(errors).toEqual([]);
});
