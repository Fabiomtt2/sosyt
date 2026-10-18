import { ownerSession } from "./helpers/owner-session";
import { test,expect } from "@playwright/test";
import { resolve } from "node:path";

// Integrated UI: the added management panels must be reachable in a real browser
// and fit desktop/mobile after converging the two branches.
test("painéis novos do Owner permanecem navegáveis e sem overflow lateral",async({page,request})=>{
  test.setTimeout(180_000);
  const token=await ownerSession(request);
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
      if(title==="Acesso" && width===1440){
        const password=page.getByLabel("Nova credencial",{exact:true});
        const confirmation=page.getByLabel("Repetir",{exact:true});
        await password.fill("semnumerosabc");
        await confirmation.fill("semnumerosabc");
        await page.locator(".owner-access-form").first().getByRole("button",{name:"Salvar minha credencial",exact:true}).click();
        await expect(page.getByRole("alert")).toContainText("letras e números");
        await expect(password).toHaveValue("semnumerosabc");
        await expect(confirmation).toHaveValue("semnumerosabc");
        await password.fill("");await confirmation.fill("");
      }
      if(title==="Avatares"){
        const upload=page.getByLabel("Escolher ilustração do avatar");
        await upload.focus();
        await expect(upload).toBeFocused();
      }
      if(title!=="Solicitações") await page.screenshot({path:resolve(`../../docs/evidencias/convergencia-${title.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"")}-${width}.png`),fullPage:true,animations:"disabled",timeout:30_000});
    }
  }
});
