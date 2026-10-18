import { ownerSession } from "./helpers/owner-session";
import {test,expect} from "@playwright/test";
import {resolve} from "node:path";
import Database from "better-sqlite3";

test("loja completa, recibos, animação e identidade SUPER persistem sem duplicar",async({page,request})=>{
 test.setTimeout(240000);
 const server="http://127.0.0.1:17333",evidence=resolve("../../docs/evidencias");
 const errors:string[]=[];page.on("pageerror",error=>errors.push(error.message));
 const owner=await ownerSession(request);
 const oh={authorization:"Bearer "+owner};
 async function member(phone:string,name:string){
  expect((await request.post(server+"/admin/members",{headers:oh,data:{phone,name,groupCode:"1"}})).ok()).toBe(true);
  const code=(await (await request.post(server+"/auth/request-code",{data:{phone,name}})).json()).devCode;
  const result=await request.post(server+"/auth/verify",{data:{phone,code}});expect(result.ok()).toBe(true);return result.json();
 }
 const lia=await member("5571999990401","Lia Criadora"),kai=await member("5571999990402","Kai Criador"),auth={authorization:"Bearer "+lia.token};
 expect((await request.put(server+"/profile/avatar",{headers:auth,data:{kind:"PRESET",presetId:"avatar-17"}})).ok()).toBe(true);
 const admin=(await (await request.post(server+"/admin/participant-session",{headers:oh})).json()).token;
 await request.post(server+"/chat/global",{headers:{authorization:"Bearer "+admin},data:{body:"Boas-vindas ao nosso espaço de criação."}});
 await page.setViewportSize({width:1440,height:960});
 await page.goto("/?audit=commerce-20261014");
 await page.evaluate(token=>{localStorage.setItem("conexao_token",token);localStorage.setItem("conexao_active_role","user");},lia.token);
 await page.reload();
 await expect(page.getByRole("heading",{name:"Vamos montar a próxima seleção?"})).toBeVisible();
 await expect(page.locator(".gc-admin-badge").first()).toHaveText("ADMIN");
 expect(await page.locator(".super-cta").evaluate(el=>getComputedStyle(el,"::after").animationName)).toBe("sos-super-shimmer");
 const wallet=page.locator('[data-purchase-anchor="coins"]');
 const celebration=page.getByRole("status",{name:"Compra confirmada"});
 async function buy(code:string){
  await page.locator(".wallet-store-link").click();
  const store=page.getByRole("dialog",{name:"Loja SOS YouTuber"});
  await store.locator('[data-product-code="'+code+'"]').getByRole("button",{name:"Quero este item"}).click({timeout:30_000});
  const modal=page.getByRole("dialog",{name:/Comprar /});
  await modal.getByLabel("E-mail do pagador").fill("lia@example.test");
  await modal.getByLabel("CPF do pagador").fill("52998224725");
  // On the low-memory desktop, the trace showed 11 s for action stability before a successful 201 response.
  const response=page.waitForResponse(r=>r.url()===server+"/payments/pix"&&r.request().method()==="POST",{timeout:30_000});
  await modal.getByRole("button",{name:/Gerar Pix de/}).click({timeout:30_000});
  const created=await response;
  expect(created.status()).toBe(201);
  const pix=await created.json();
  await expect(modal.getByRole("button",{name:"Simular confirmação"})).toBeVisible();
  expect(pix.status).toBe("PENDING");
  return {modal,pix};
 }
 await page.locator(".wallet-store-link").click();
 const store=page.getByRole("dialog",{name:"Loja SOS YouTuber"});
 for(const code of ["COINS_10","PASS_SINGLE","SKIP_1","SUPER_30"])await expect(store.locator('[data-product-code="'+code+'"]')).toHaveCount(1);
 for(const width of [1440,390]){
  await page.setViewportSize({width,height:960});
  await store.locator('[data-product-code="SKIP_1"]').scrollIntoViewIfNeeded();
  expect(await store.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
  await page.screenshot({path:resolve(evidence,"commerce-items-"+width+".png"),animations:"disabled"});
 }
 await page.keyboard.press("Escape");await page.setViewportSize({width:1440,height:960});
 const coins=await buy("COINS_10");
 await expect(celebration).toHaveCount(0);await expect(wallet).toContainText("10");
 await coins.modal.getByRole("button",{name:"Simular confirmação"}).click();
 await expect(celebration).toContainText("10 moedas");
 await expect(wallet).toContainText("20");
 await expect(page.locator(".purchase-arrival b")).toHaveText("+10");
 // Inspect the visible phase deterministically: the intentional two-second animation ends at opacity 0.
 const arrival = page.locator(".purchase-arrival b");
 expect(await arrival.evaluate(el => {
  const animation = el.getAnimations().find(item => (item as CSSAnimation).animationName === "sos-balance-plus");
  if (!animation) return false;
  animation.pause(); animation.currentTime = 800;
  return true;
 })).toBe(true);
 await expect(arrival).toHaveCSS("opacity","1");
 await page.screenshot({path:resolve(evidence,"commerce-coins-confirmed-1440.png")});
 await page.reload();await expect(wallet).toContainText("20");await expect(celebration).toHaveCount(0);
 await request.post(server+"/payments/"+coins.pix.id+"/demo-approve",{headers:auth});
 expect((await (await request.get(server+"/dashboard",{headers:auth})).json()).wallet.total).toBe(20);
 const pass=await buy("PASS_SINGLE");
 await expect(pass.modal).toContainText("contribuição extra na mesma fila");
 await pass.modal.getByRole("button",{name:"Simular confirmação"}).click();
 await expect(celebration).toContainText("1 passe");await celebration.getByLabel("Fechar confirmação").click();
 const skip=await buy("SKIP_1");
 await expect(skip.modal).toContainText("Não conclui vídeos por você");
 await skip.modal.getByRole("button",{name:"Fechar compra"}).click();
 await request.post(server+"/payments/"+skip.pix.id+"/demo-approve",{headers:auth});
 await page.reload();
 await expect(celebration).toContainText("1 Pular");
 await celebration.getByRole("button",{name:"Ver meu inventário"}).click();
 const inventory=page.getByRole("dialog",{name:"Mensagens e inventário"});
 await expect(inventory.getByLabel("Meu inventário")).toContainText("1 passe");
 await expect(inventory.getByLabel("Meu inventário")).toContainText("1 Pular");
 await page.screenshot({path:resolve(evidence,"commerce-inventory-1440.png"),animations:"disabled"});
 await page.keyboard.press("Escape");
 const superPurchase=await buy("SUPER_30");
 await expect(superPurchase.modal).toContainText("moldura SUPER enquanto a assinatura estiver ativa");
 await superPurchase.modal.getByRole("button",{name:"Simular confirmação"}).click();
 await expect(celebration).toHaveClass(/is-super/);
 await expect(celebration).toContainText("SUPER por 30 dias");
 await expect(page.locator(".header-avatar")).toHaveClass(/avatar-tier-super/);
 await expect(page.locator(".header-avatar")).toHaveClass(/preset/);
 await expect.poll(()=>celebration.evaluate(el=>getComputedStyle(el).opacity)).toBe("1");
 expect(await celebration.evaluate(el=>{const r=el.getBoundingClientRect();return el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));})).toBe(true);
 await page.screenshot({path:resolve(evidence,"commerce-super-welcome-1440.png")});
 await celebration.getByLabel("Fechar confirmação").click();
 const room=page.getByRole("complementary",{name:"Chat global da comunidade"});
 await room.getByLabel("Mensagem para o chat global").fill("Uma nova fase para criar com vocês.");
 await room.getByRole("button",{name:"Enviar mensagem à comunidade"}).click();
 const message=room.locator(".gc-msg-super").filter({hasText:"Uma nova fase para criar com vocês."});
 await expect(message).toBeVisible();
 await expect(message.locator(".user-avatar")).toHaveAttribute("data-badge","SUPER");
 expect(await message.locator(".gc-super-text").evaluate(el=>getComputedStyle(el).color)).toBe("rgb(73, 49, 65)");
 await expect(room.getByLabel("Mensagem para o chat global")).toBeEnabled();
 await room.getByLabel("Mensagem para o chat global").fill("Obrigada por compartilhar suas ideias.");
 await room.getByRole("button",{name:"Enviar mensagem à comunidade"}).click();
 await expect(room.getByText("Obrigada por compartilhar suas ideias.",{exact:true})).toBeVisible();
 await request.post(server+"/mail/dm",{headers:auth,data:{toUserId:kai.user.id,body:"Olá, Kai! Vamos criar juntos."}});
 for(const width of [1440,390]){
  await page.setViewportSize({width,height:960});
  await page.screenshot({path:resolve(evidence,"commerce-super-chat-"+width+".png"),animations:"disabled"});
 }
 // A second user sees the same image and subscription identity in direct messages.
 await page.evaluate(token=>{localStorage.setItem("conexao_token",token);},kai.token);await page.reload();
 await page.getByRole("button",{name:"Mensagens e inventário",exact:true}).click();
 const direct=page.getByRole("dialog",{name:"Mensagens e inventário"});
 await direct.getByRole("button",{name:/Lia Criadora/}).click();
 await expect(direct.locator(".community-messages .user-avatar")).toHaveAttribute("data-badge","SUPER");
 await expect(direct.locator(".community-messages")).toContainText("Olá, Kai!");
 await page.screenshot({path:resolve(evidence,"commerce-super-direct-390.png"),animations:"disabled"});
 await page.keyboard.press("Escape");
 // Expiration in the isolated browser fixture only; production is never touched.
 const db=new Database(resolve("../../.local-tmp/browser-test.db"));
 db.prepare("UPDATE super_subscriptions SET expires_at=? WHERE user_id=?").run(new Date(Date.now()-1000).toISOString(),lia.user.id);db.close();
 await page.evaluate(token=>{localStorage.setItem("conexao_token",token);},lia.token);await page.reload();
 await expect(page.locator(".header-avatar")).not.toHaveClass(/avatar-tier-super/);
 await expect(page.locator(".header-avatar")).toHaveClass(/preset/);
 await expect(page.locator(".gc-msg-super").filter({hasText:"Uma nova fase para criar com vocês."})).toHaveCount(0);
 await page.emulateMedia({reducedMotion:"reduce"});
 expect(await page.locator(".super-cta").evaluate(el=>getComputedStyle(el,"::after").display)).toBe("none");
 expect(errors).toEqual([]);
});
