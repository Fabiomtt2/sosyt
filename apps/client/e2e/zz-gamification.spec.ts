import {test,expect as browserExpect} from "@playwright/test";
const expect=browserExpect.configure({timeout:15_000});
import {ownerSession} from "./helpers/owner-session";
import {resolve} from "node:path";
import {mkdirSync} from "node:fs";
import {execFileSync} from "node:child_process";
test("jornada, níveis, trocas e presentes convergem com Owner e chats",async({page,request})=>{
 test.setTimeout(240000);
 const api="http://127.0.0.1:17333",evidence=resolve("../../docs/evidencias"),root=resolve("../..");
 const owner=await ownerSession(request),oh={authorization:"Bearer "+owner};
 async function member(phone:string,name:string){
  expect((await request.post(api+"/admin/members",{headers:oh,data:{phone,name,groupCode:"1"}})).ok()).toBe(true);
  const code=(await (await request.post(api+"/auth/request-code",{data:{phone,name}})).json()).devCode;
  const res=await request.post(api+"/auth/verify",{data:{phone,code}});expect(res.ok()).toBe(true);return res.json();
 }
 const a=await member("5571999990711","Marina Criadora"),b=await member("5571999990712","João Criador"),ah={authorization:"Bearer "+a.token};
 const consent=await request.post(api+"/social/message-requests",{headers:ah,data:{targetUserId:b.user.id}});expect(consent.ok(),await consent.text()).toBe(true);
 expect((await request.post(api+"/social/message-requests/"+(await consent.json()).id,{headers:{authorization:"Bearer "+b.token},data:{accept:true}})).ok()).toBe(true);
 execFileSync(process.execPath,["--import","tsx","scripts/e2e-gamification-seed.mjs",a.user.id],{cwd:root,timeout:30000});
 expect((await request.put(api+"/profile/avatar",{headers:ah,data:{kind:"PRESET",presetId:"avatar-17"}})).ok()).toBe(true);
 expect((await request.post(api+"/chat/global",{headers:ah,data:{body:"Cada passo conta. Que bom crescer com vocês!"}})).ok()).toBe(true);
 await page.goto("/?audit=gamification");
 await page.evaluate(token=>{localStorage.setItem("conexao_token",token);localStorage.setItem("conexao_active_role","user");},a.token);
 await page.reload();
 const room=page.getByRole("complementary",{name:"Chat global da comunidade"});
 const mine=room.locator(".gc-msg").filter({hasText:"Cada passo conta. Que bom crescer com vocês!"});
 await expect(mine.getByLabel(/Nível 30/)).toBeVisible();
 await expect(mine.locator('[data-emblem-tier="11"] img')).toBeVisible();
 await expect.poll(()=>mine.locator('[data-emblem-tier="11"] img').evaluate((img:HTMLImageElement)=>img.complete&&img.naturalWidth>0)).toBe(true);
 await expect(mine.locator(".user-avatar.preset")).toHaveCount(1);
 await page.getByRole("button",{name:/Minha jornada/}).click();
 const journey=page.getByRole("dialog",{name:"Minha jornada"});
 await expect(journey.getByText("24.000 XP acumulados",{exact:true})).toBeVisible();
 await expect(journey.getByText(/A cada 10 níveis, \+20 moedas/)).toBeVisible();
 await expect(journey.getByRole("list",{name:"Ranking de experiência do mês"})).toContainText("Marina Criadora");
 for(const width of [1440,390]){
  await page.setViewportSize({width,height:960});
  expect(await journey.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
  await page.screenshot({path:resolve(evidence,"journey-"+width+".png"),fullPage:false,animations:"disabled"});
 }
 const walletBefore=(await (await request.get(api+"/dashboard",{headers:ah})).json()).wallet;
 const passesBefore=walletBefore.extraPasses;
 const cost=(await (await request.get(api+"/gamification/me",{headers:ah})).json()).redeemPrices.PASS;
 const pass=journey.locator(".journey-redemption-card").filter({has:page.getByRole("heading",{name:"Passe",exact:true})});
 await pass.getByRole("button",{name:"Trocar",exact:true}).click();
 const confirmed=page.getByRole("dialog",{name:"Troca concluída"});
 await expect(confirmed).toBeVisible();await expect(confirmed).toContainText("+1 Passe");await expect(confirmed).toContainText("moedas de recompensa debitadas");
 const receiptEvidence=resolve("../../.local-tmp/social-messenger-evidence");mkdirSync(receiptEvidence,{recursive:true});
 await page.screenshot({path:resolve(receiptEvidence,"reward-exchange-390.png"),animations:"disabled"});
 const walletAfter=(await (await request.get(api+"/dashboard",{headers:ah})).json()).wallet;
 expect(walletAfter.reward).toBe(walletBefore.reward-cost);expect(walletAfter.purchased).toBe(walletBefore.purchased);
 await confirmed.getByRole("button",{name:"Entendi",exact:true}).click();
 await expect(confirmed).toHaveCount(0);
 expect((await (await request.get(api+"/dashboard",{headers:ah})).json()).wallet.extraPasses).toBe(passesBefore+1);
 await page.keyboard.press("Escape");
 await page.locator(".wallet-store-link").click();
 const store=page.getByRole("dialog",{name:"Loja SOS YouTuber"});
 await store.locator('[data-product-code="SKIP_1"]').getByRole("button",{name:"Trocar recompensas",exact:true}).click();
 const skipReceipt=page.getByRole("dialog",{name:"Troca concluída"});await expect(skipReceipt).toContainText("+1 Pular");
 await skipReceipt.getByRole("button",{name:"Entendi",exact:true}).click();
 await expect(store.getByRole("status")).toContainText("Pular chegou");
 expect((await (await request.get(api+"/queues/mine",{headers:ah})).json()).skipsAvailable).toBe(1);
 await page.keyboard.press("Escape");
 await request.post(api+"/chat/global",{headers:{authorization:"Bearer "+b.token},data:{body:"Vamos conversar sobre nossa próxima seleção?"}});
 // Another session posts through the API; allow one 5s polling cycle plus transport.
  await expect(room.getByRole("button",{name:"Ver João Criador",exact:true})).toBeVisible({timeout:12_000});
 await room.getByRole("button",{name:"Ver João Criador",exact:true}).click();
 await page.getByRole("button",{name:"Ver perfil, amigos e mensagens",exact:true}).click();
 const direct=page.getByRole("dialog",{name:"Mensagens e inventário"});
 await direct.getByLabel("Seu recado").fill("Um presente para sua próxima seleção.");
 await direct.getByRole("button",{name:"Enviar",exact:true}).click();
 await direct.getByRole("button",{name:"Enviar um presente",exact:true}).click();
 await direct.getByLabel("Moedas para presentear").fill("5");
 await direct.getByRole("button",{name:"Presentear moedas",exact:true}).click();
 await expect(page.getByRole("dialog",{name:"Confirmar presente",exact:true})).toContainText("João Criador");
 await direct.getByRole("button",{name:"Confirmar moedas",exact:true}).click();
 await expect(direct.getByRole("status")).toContainText("Moedas entregues");
 expect((await (await request.get(api+"/dashboard",{headers:{authorization:"Bearer "+b.token}})).json()).wallet.reward).toBe(5);
 await expect(direct.getByRole("button",{name:"Fechar mensagens e inventário"})).toBeInViewport();
 await page.screenshot({path:resolve(evidence,"journey-direct-390.png"),fullPage:false,animations:"disabled"});
 await page.keyboard.press("Escape");
 // Visual fixture only: show Friday art without changing the real server clock
 // or granting a reward outside its window. The server rejection remains real.
 const balance=(await (await request.get(api+"/dashboard",{headers:ah})).json()).wallet.reward;
 const liveBooster=(await (await request.get(api+"/gamification/me",{headers:ah})).json()).booster;
 await page.route("**/dashboard",async route=>{
  const response=await route.fetch();const json=await response.json();
  json.gamification.booster={...json.gamification.booster,available:true,claimed:false,windowEndsAt:new Date(Date.now()+3600000).toISOString()};
  await route.fulfill({response,json});
 });
 await page.reload();await page.getByRole("button",{name:/Minha jornada/}).click();
 const friday=page.getByRole("dialog",{name:"Minha jornada"});
 await friday.getByText("O que pode vir no presente?",{exact:true}).click();
 for(const width of [1440,390]){
  await page.setViewportSize({width,height:960});
  await friday.locator(".journey-booster").scrollIntoViewIfNeeded();
  await expect(friday.getByRole("button",{name:"Fechar minha jornada"})).toBeInViewport();
  await page.screenshot({path:resolve(evidence,"journey-booster-preview-"+width+".png"),fullPage:false,animations:"disabled"});
 }
 if(!liveBooster.available){
  await friday.getByRole("button",{name:"Abrir meu presente",exact:true}).click();
  await expect(friday.getByRole("alert")).toBeVisible();
  expect((await (await request.get(api+"/dashboard",{headers:ah})).json()).wallet.reward).toBe(balance);
 }
 await page.unroute("**/dashboard");await page.keyboard.press("Escape");
 await page.evaluate(token=>{localStorage.setItem("conexao_owner_token",token);localStorage.setItem("conexao_active_role","owner");},owner);await page.reload();
 await page.getByRole("button",{name:"Jornada",exact:true}).click();
 await expect(page.getByRole("heading",{name:"Jornada e recompensas"})).toBeVisible();
 await expect(page.getByLabel("XP por vídeo completo")).toHaveValue("100");
 for(const width of [1440,390]){
  await page.setViewportSize({width,height:960});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:resolve(evidence,"journey-owner-"+width+".png"),fullPage:false,animations:"disabled"});
 }
});
