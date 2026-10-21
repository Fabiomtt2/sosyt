import {test,expect} from "@playwright/test";
import {ownerSession} from "./helpers/owner-session";
import {mkdirSync} from "node:fs";
import {resolve} from "node:path";

test("ADMIN recebe formulário de elevação e troca sua credencial sem controles Root",async({page,request})=>{
  test.setTimeout(90000);
  const api="http://127.0.0.1:17333",root=await ownerSession(request),headers={authorization:"Bearer "+root};
  const phone="5571999990827",name="Admin UI Sintético",current="SyntheticAdmin2026!",next="NewSyntheticAdmin2026!";
  expect((await request.post(api+"/admin/members",{headers,data:{phone,name,groupCode:"1"}})).ok()).toBe(true);
  const sent=await request.post(api+"/auth/request-code",{data:{phone,name}});expect(sent.ok()).toBe(true);
  const verified=await request.post(api+"/auth/verify",{data:{phone,code:(await sent.json()).devCode}});expect(verified.ok()).toBe(true);const member=await verified.json();
  const promoted=await request.post(api+"/admin/owners",{headers,data:{userId:member.user.id}});expect(promoted.ok(),await promoted.text()).toBe(true);const id=(await promoted.json()).id;
  expect((await request.post(api+"/admin/credentials",{headers,data:{ownerId:id,password:current,mustChange:true}})).ok()).toBe(true);
  // The shared browser fixture is DEV. A single guard response exercises the
  // credential prompt; strict production credential checks have HTTP unit tests.
  let requested=false;
  await page.route("**/admin/elevate",async route=>{
    if(!requested){requested=true;await route.fulfill({status:401,contentType:"application/json",body:JSON.stringify({code:"CREDENTIAL_REQUIRED",message:"Informe sua credencial administrativa para abrir o painel."})});return;}
    expect(route.request().postDataJSON().secret).toBe(current);await route.continue();
  });
  await page.goto("/");await page.evaluate(token=>{localStorage.clear();localStorage.setItem("conexao_token",token);localStorage.setItem("conexao_active_role","user");sessionStorage.setItem("sos-chat-open","false");},member.token);await page.reload();
  await page.getByRole("button",{name:"Abrir menu da minha conta",exact:true}).click();
  await page.getByRole("button",{name:"Abrir painel administrativo",exact:true}).click();
  const confirm=page.getByRole("form",{name:"Confirmar credencial administrativa",exact:true});await expect(confirm).toBeVisible();await confirm.getByLabel("Credencial administrativa",{exact:true}).fill(current);
  await confirm.getByRole("button",{name:"Confirmar e abrir painel",exact:true}).click();
  await page.getByRole("button",{name:"Abrir menu do Owner",exact:true}).click();await page.getByRole("button",{name:/Minha credencial administrativa/}).click();
  const form=page.getByRole("form",{name:"Minha credencial administrativa",exact:true});await form.getByLabel("Credencial atual",{exact:true}).fill(current);await form.getByLabel("Nova credencial",{exact:true}).fill(next);await form.getByLabel("Repita a nova credencial",{exact:true}).fill(next);
  const saved=page.waitForResponse(response=>response.url().endsWith("/admin/credentials/self")&&response.request().method()==="POST");await form.getByRole("button",{name:"Salvar minha credencial",exact:true}).click();expect((await saved).status()).toBe(200);await expect(form.getByRole("status")).toContainText("foi salva");
  await expect(page.getByRole("navigation",{name:"Seções administrativas"}).getByRole("button",{name:"Compras",exact:true})).toHaveCount(0);
  const token=await page.evaluate(()=>localStorage.getItem("conexao_owner_token"));expect((await request.get(api+"/admin/credentials",{headers:{authorization:"Bearer "+token}})).status()).toBe(403);
  const out=resolve("../../.local-tmp/benefit-halo-evidence");mkdirSync(out,{recursive:true});
  for(const width of [1440,390]){await page.setViewportSize({width,height:960});await form.scrollIntoViewIfNeeded();expect(await page.locator(".owner-access-panel").evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);await page.screenshot({path:resolve(out,"admin-self-credential-"+width+".png"),animations:"disabled"});}
});
