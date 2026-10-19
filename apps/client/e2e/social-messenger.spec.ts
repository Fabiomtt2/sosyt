import { test, expect as baseExpect, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { ownerSession } from "./helpers/owner-session";

const expect=baseExpect.configure({timeout:15_000});
test.use({actionTimeout:30_000});
test("duas sessões: consentimento, amizade paga uma vez, presentes, bloqueio e SUPER pelo nome", async ({ browser, request }) => {
 test.setTimeout(360_000);
 const server="http://127.0.0.1:17333", evidence=resolve("../../.local-tmp/social-messenger-evidence");mkdirSync(evidence,{recursive:true});
 const owner=await ownerSession(request),oh={authorization:"Bearer "+owner};
 async function member(phone:string,name:string){
  const approved=await request.post(server+"/admin/members",{headers:oh,data:{phone,name,groupCode:"1"}});expect(approved.ok(),await approved.text()).toBe(true);
  const code=await request.post(server+"/auth/request-code",{data:{phone,name}});expect(code.ok(),await code.text()).toBe(true);
  const login=await request.post(server+"/auth/verify",{data:{phone,code:(await code.json()).devCode}});expect(login.ok(),await login.text()).toBe(true);return login.json();
 }
 const alice=await member("5571999990801","Alice Amizades"),bob=await member("5571999990802","Beto Amizades");
 const ah={authorization:"Bearer "+alice.token},bh={authorization:"Bearer "+bob.token};
 const contexts=[await browser.newContext({viewport:{width:1440,height:960}}),await browser.newContext({viewport:{width:390,height:844}})];
 const a=await contexts[0].newPage(),b=await contexts[1].newPage();
 const errors:string[]=[];for(const page of [a,b])page.on("pageerror",error=>errors.push(error.message));
 async function login(page:Page,token:string){await page.goto("/?audit=social-messenger");await page.evaluate(token=>{localStorage.setItem("conexao_token",token);localStorage.setItem("conexao_active_role","user");},token);await page.reload();await expect(page.getByRole("heading",{name:"Vamos montar a próxima seleção?"})).toBeVisible();}
 async function openInbox(page:Page){await page.getByRole("button",{name:/Abrir correio e amigos/}).first().click();const hub=page.getByRole("dialog",{name:"Mensagens e inventário"});await expect(hub).toBeVisible();await expect.poll(()=>hub.evaluate(el=>{const r=el.getBoundingClientRect();return r.left>=-1&&r.right<=innerWidth+1;})).toBe(true);expect(await hub.locator(".social-hub-header p").evaluate(el=>el.getBoundingClientRect().bottom<=el.closest(".social-hub-header")!.getBoundingClientRect().bottom+1)).toBe(true);return hub;}
 try {
  expect((await request.post(server+"/chat/global",{headers:bh,data:{body:"Olá! Sou Beto e quero conhecer a comunidade."}})).ok()).toBe(true);
  await login(a,alice.token);await login(b,bob.token);
  // Unknown people cannot deliver unsolicited direct messages, even through the HTTP endpoint.
  const denied=await request.post(server+"/mail/dm",{headers:ah,data:{toUserId:bob.user.id,body:"Esta mensagem exige consentimento."}});expect(denied.status()).toBe(403);
  await a.locator(".global-chat").getByRole("button",{name:"Beto Amizades",exact:true}).click();
  const hubA=a.getByRole("dialog",{name:"Mensagens e inventário"});await expect(hubA).toBeVisible();
  await expect(hubA.getByLabel("Seu recado")).toHaveCount(0);
  await hubA.getByRole("button",{name:"Pedir para conversar · grátis",exact:true}).click();
  await expect(hubA.getByText("Seu pedido foi enviado.",{exact:false})).toBeVisible();
  await expect(b.getByRole("button",{name:/Abrir correio e amigos/}).first().locator("b")).toBeVisible();
  const hubB=await openInbox(b);
  await hubB.getByRole("button",{name:"Aceitar conversa",exact:true}).click();
  await expect(hubA.getByLabel("Seu recado")).toBeVisible();
  await hubA.getByLabel("Seu recado").fill("Obrigada por aceitar a conversa, Beto!");await hubA.getByRole("button",{name:"Enviar",exact:true}).click();
  await expect(hubA.getByRole("log")).toContainText("Obrigada por aceitar a conversa, Beto!");
  await expect.poll(async()=>((await (await request.get(server+"/mail/unread-count",{headers:bh})).json()).unread)).toBeGreaterThan(0);
  // Friendship is separate: a paid request, free acceptance, and an explicit pending state.
  const before=(await (await request.get(server+"/dashboard",{headers:ah})).json()).wallet.total;
  await hubA.getByRole("button",{name:"Adicionar · 1 moeda",exact:true}).click();
  const invite=a.getByRole("dialog",{name:"Confirmar convite de amizade"});await expect(invite).toContainText("não devolve a moeda");const sentInvite=a.waitForResponse(response=>response.url()===server+"/social/requests"&&response.request().method()==="POST");await invite.getByRole("button",{name:"Enviar por 1 moeda",exact:true}).click();
  const invitationResponse=await sentInvite;expect(invitationResponse.ok()).toBe(true);const invitationIntent=invitationResponse.request().postDataJSON();
  await expect(hubA.getByRole("button",{name:/Convite enviado/})).toBeVisible();
  expect((await (await request.get(server+"/dashboard",{headers:ah})).json()).wallet.total).toBe(before-1);
  const replay=await request.post(server+"/social/requests",{headers:ah,data:invitationIntent});expect(replay.ok(),await replay.text()).toBe(true);expect((await (await request.get(server+"/dashboard",{headers:ah})).json()).wallet.total).toBe(before-1);
  const bBalance=(await (await request.get(server+"/dashboard",{headers:bh})).json()).wallet.total;
  await hubB.getByRole("button",{name:/Amigos/}).click();await hubB.getByRole("button",{name:"Aceitar grátis",exact:true}).click();
  await expect(hubA.getByText("Vocês são amigos",{exact:true})).toBeVisible();
  expect((await (await request.get(server+"/dashboard",{headers:bh})).json()).wallet.total).toBe(bBalance);
  const friendOverview=await (await request.get(server+"/social",{headers:ah})).json();expect(friendOverview.friends.some((friend:any)=>friend.user?.id===bob.user.id)).toBe(true);
  // Purchased coins remain transferable; granting inventory and transfers do not manufacture revenue.
  for(const code of ["COINS_10","SKIP_1"]){const payment=await request.post(server+"/payments/pix",{headers:ah,data:{product:code,email:"social@example.test",cpf:"52998224725"}});expect(payment.ok(),await payment.text()).toBe(true);expect((await request.post(server+"/payments/"+(await payment.json()).id+"/demo-approve",{headers:ah})).ok()).toBe(true);}
  await hubA.getByRole("button",{name:"Enviar um presente",exact:true}).click();
  await hubA.getByLabel("Moedas para presentear").fill("2");await hubA.getByRole("button",{name:"Presentear moedas",exact:true}).click();await a.getByRole("dialog",{name:"Confirmar presente"}).getByRole("button",{name:"Confirmar moedas",exact:true}).click();
  await expect(hubA.getByRole("status")).toContainText("Moedas entregues");
  expect((await (await request.get(server+"/dashboard",{headers:bh})).json()).wallet.purchased).toBe(2);
  await hubA.getByRole("button",{name:"1 Pular",exact:true}).click();await a.getByRole("dialog",{name:"Confirmar presente"}).getByRole("button",{name:"Confirmar presente",exact:true}).click();
  await expect(hubA.getByRole("status")).toContainText("Presente entregue");
  expect((await (await request.get(server+"/queues/mine",{headers:bh})).json()).skipsAvailable).toBe(1);
  expect((await (await request.get(server+"/queues/mine",{headers:ah})).json()).skipsAvailable).toBe(0);
  for(const width of [1440,390]){await a.setViewportSize({width,height:960});expect(await hubA.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);await a.screenshot({path:resolve(evidence,"messenger-"+width+".png"),animations:"disabled"});}
  await hubB.getByRole("button",{name:/^Conversas(?: |$)/}).click();await hubB.getByRole("button",{name:/Alice Amizades/}).first().click();
  await expect(hubB.getByRole("log")).toContainText("Obrigada por aceitar");
  await hubA.getByRole("button",{name:"Bloquear",exact:true}).click();await a.getByRole("dialog",{name:"Confirmar bloqueio"}).getByRole("button",{name:"Confirmar bloqueio",exact:true}).click();
  await expect(hubA.getByText("Interações indisponíveis entre vocês.",{exact:true})).toBeVisible();
  for(const [headers,to] of [[ah,bob.user.id],[bh,alice.user.id]] as const){expect((await request.post(server+"/mail/dm",{headers,data:{toUserId:to,body:"Bloqueio deve impedir esta mensagem."}})).status()).toBe(403);}
  await expect.poll(async()=>{const chat=await (await request.get(server+"/chat/global",{headers:ah})).json();return chat.messages.some((message:any)=>message.sender.id===bob.user.id);}).toBe(false);
  await hubA.getByRole("button",{name:"Amigos",exact:true}).click();await expect(hubA.getByRole("button",{name:"Desbloquear",exact:true})).toBeVisible();await a.screenshot({path:resolve(evidence,"friends-blocked-390.png"),animations:"disabled"});
  await a.keyboard.press("Escape");
  // Root selects a known person, instead of guessing the raw database ID.
  await a.evaluate(token=>{localStorage.setItem("conexao_owner_token",token);localStorage.setItem("conexao_active_role","owner");},owner);await a.reload();await a.setViewportSize({width:1440,height:960});
  await a.getByRole("button",{name:"Acesso",exact:true}).click();
  await a.getByLabel("Buscar por nome, WhatsApp ou ID").fill("Beto Amizades");await a.getByLabel("Participante para receber SUPER").selectOption(bob.user.id);
  await expect(a.getByText(bob.user.id,{exact:true})).toBeVisible();await a.getByRole("button",{name:"Doar SUPER",exact:true}).click();await expect(a.getByRole("status")).toContainText("SUPER concedido");
  expect((await (await request.get(server+"/super/me",{headers:bh})).json()).active).toBe(true);
  await a.screenshot({path:resolve(evidence,"owner-grant-super-1440.png"),animations:"disabled"});
  expect(errors).toEqual([]);
 } finally {for(const context of contexts)await context.close();}
});
