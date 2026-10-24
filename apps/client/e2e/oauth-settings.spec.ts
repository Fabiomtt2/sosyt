import {test,expect} from "@playwright/test";
import {resolve} from "node:path";
import {ownerSession} from "./helpers/owner-session";

test("Root configura OAuth sem revelar o segredo e pode voltar ao ambiente",async({page,request})=>{
 test.setTimeout(120_000);
 const token=await ownerSession(request);
 await page.goto("/?audit=oauth-settings");
 await page.evaluate(token=>{localStorage.setItem("conexao_owner_token",token);localStorage.setItem("conexao_active_role","owner");},token);
 await page.reload();
 await page.getByRole("button",{name:"Comunicação",exact:true}).click();
 const panel=page.getByRole("region",{name:"Conexão Google e YouTube"});
 await expect(panel).toBeVisible();
 await panel.getByLabel("Client ID",{exact:true}).fill("synthetic-ui.apps.googleusercontent.com");
 await panel.getByLabel("Client Secret",{exact:true}).fill("synthetic-ui-oauth-secret");
 const response=page.waitForResponse(r=>r.url().endsWith("/admin/integrations/youtube")&&r.request().method()==="POST");
 await panel.getByRole("button",{name:"Salvar credenciais Google"}).click();
 const saved=await response;
 expect(saved.ok()).toBe(true);
 expect(await saved.text()).not.toContain("synthetic-ui-oauth-secret");
 await expect(panel.getByLabel("Client Secret",{exact:true})).toHaveValue("");
 await expect(page.getByRole("status")).toContainText("Credenciais OAuth salvas");
 for(const width of [1440,390]){
  await page.setViewportSize({width,height:900});
  await panel.scrollIntoViewIfNeeded();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  await panel.screenshot({path:resolve(`../../docs/evidencias/oauth-settings-${width}.png`),animations:"disabled"});
 }
 await panel.getByRole("button",{name:"Usar credenciais do servidor"}).click();
 await expect(panel.getByRole("button",{name:"Usar credenciais do servidor"})).toHaveCount(0);
});
