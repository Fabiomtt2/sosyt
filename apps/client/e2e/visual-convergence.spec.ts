import { test,expect } from "@playwright/test";
import { resolve } from "node:path";
import { existsSync,readFileSync } from "node:fs";

// Integrated UI: the added management panels must be reachable in a real browser
// and fit desktop/mobile after converging the two branches.
test("painéis novos do Owner permanecem navegáveis e sem overflow lateral",async({page,request})=>{
  const api="http://127.0.0.1:17333";
  const session=resolve("../../.local-tmp/browser-owner-session.json");
  let token:string;
  if(existsSync(session)) token=JSON.parse(readFileSync(session,"utf8")).token;
  else {
    const owner=await request.post(api+"/admin/login",{data:{name:"Fabio0",identifier:"5571999990001",groupCode:"#",secret:"e2e-owner-secret-32-characters-long"}});
    expect(owner.ok(),await owner.text()).toBe(true);
    token=(await owner.json()).token;
  }
  await page.goto("/?audit=convergencia-visual");
  await page.evaluate(token=>{localStorage.setItem("conexao_owner_token",token);localStorage.setItem("conexao_active_role","owner");},token);
  await page.reload();
  await expect(page.getByRole("heading",{name:"Sua conexão, em números."})).toBeVisible();
  const tabs=["Solicitações", "Integrações","Loja","Bot","Comunicação","Acesso","Avatares"];
  for(const width of [1440,390]){
    await page.setViewportSize({width,height:width===390?844:960});
    for(const title of tabs){
      await page.getByRole("button",{name:title,exact:title!=="Solicitações"}).first().click();
      await expect(page.locator("main.dashboard")).toBeVisible();
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`${title} largura ${width}`).toBe(true);
      if(title==="Loja"){
        const card=page.locator(".store-admin-product").first();
        await expect(card).toBeVisible();
        await expect(card.locator(".store-admin-price")).toContainText("R$");
        const action=card.getByRole("button",{name:"Editar item"});
        await expect(action).toBeVisible();
        const bounds=await Promise.all([card.locator(".store-admin-price").boundingBox(),action.boundingBox()]);
        for(const box of bounds){
          expect(box,`produto visível em ${width}px`).toBeTruthy();
          expect(box!.x,`produto no limite esquerdo em ${width}px`).toBeGreaterThanOrEqual(0);
          expect(box!.x+box!.width,`produto no limite direito em ${width}px`).toBeLessThanOrEqual(width+1);
        }
        await action.click();
        await expect(page.locator("#store-product-editor h3")).toContainText("Editando");
      }
      if(title!=="Solicitações") await page.screenshot({path:resolve(`../../docs/evidencias/convergencia-${title.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"")}-${width}.png`),fullPage:true});
    }
  }
});
