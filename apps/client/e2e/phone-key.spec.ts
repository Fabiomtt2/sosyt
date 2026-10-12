import { test, expect } from "@playwright/test";
import { resolve } from "node:path";

test("chave WhatsApp: registro confirmado, aprovação manual e login na mesma conta",async({page,request})=>{
  const api="http://127.0.0.1:17333", phone="5571999998077";
  const owner=await request.post(api+"/admin/login",{data:{name:"Fabio0",identifier:"5571999990001",groupCode:"#",secret:"e2e-owner-secret-32-characters-long"}});
  expect(owner.ok(),await owner.text()).toBeTruthy();
  const token=(await owner.json()).token;
  // Activate the production UI while the isolated fixture returns the key.
  // No WhatsApp message is sent by this test.
  await page.route("**/auth/options",route=>route.fulfill({json:{proofRequired:true,googleRequired:false,googleConfigured:false,whatsappConfigured:true}}));
  await page.goto("/?audit=phone-key");
  await page.getByRole("button",{name:"Quero participar",exact:true}).click();
  await page.getByLabel("Seu nome ou como prefere ser chamado").fill("Pessoa Chave");
  await page.getByRole("button",{name:"Selecionar país e DDI"}).click();
  await page.keyboard.type("55");
  await page.getByRole("button",{name:"Brasil +55"}).click();
  await page.getByRole("button",{name:"Selecionar DDD do Brasil"}).click();
  // This DDD is exposed by the selector's incremental numeric filter.
  await page.keyboard.type("71");
  await page.getByRole("button",{name:"DDD 71 BA"}).click();
  await page.getByLabel("WhatsApp",{exact:true}).fill("999998077");
  await page.getByRole("checkbox").check();
  const response=page.waitForResponse(result=>result.url().endsWith("/auth/request-code"));
  await page.getByRole("button",{name:"Enviar dados e continuar"}).click();
  const issued=await (await response).json();
  expect(issued.expiresInSeconds).toBe(300);
  await expect(page.getByRole("heading",{name:"Confira seu WhatsApp"})).toBeVisible();
  await expect(page.getByRole("button",{name:/Enviar nova chave/})).toBeDisabled();
  await page.getByLabel("Chave recebida no WhatsApp").fill("000000");
  await page.getByRole("button",{name:"Confirmar chave e continuar"}).click();
  await expect(page.getByText("Código inválido ou expirado.",{exact:true})).toBeVisible();
  await page.setViewportSize({width:390,height:844});
  await page.screenshot({path:resolve("../../docs/evidencias/login-chave-whatsapp-mobile.png"),fullPage:true});
  await page.getByLabel("Chave recebida no WhatsApp").fill(issued.devCode);
  await page.getByRole("button",{name:"Confirmar chave e continuar"}).click();
  await expect(page.getByRole("heading",{name:"Solicitação em análise"})).toBeVisible();
  const approval=await request.post(api+"/admin/members",{headers:{authorization:"Bearer "+token},data:{name:"Pessoa Chave",phone,groupCode:"1"}});
  expect(approval.ok()).toBeTruthy();
  // A fresh key after the resend window is generated through the isolated DB
  // clock, leaving browser and server security behavior unchanged.
  const {default:Database}=await import("better-sqlite3");
  const db=new Database(resolve("../../.local-tmp/browser-test.db"));
  db.prepare("UPDATE login_codes SET created_at=? WHERE phone=?").run(new Date(Date.now()-61_000).toISOString(),phone);db.close();
  await page.getByRole("button",{name:"Verificar situação"}).click();
  await expect(page.getByRole("heading",{name:"Cadastro aprovado"})).toBeVisible();
  await page.getByRole("button",{name:"Voltar ao acesso"}).click();
  const response2=page.waitForResponse(result=>result.url().endsWith("/auth/request-code"));
  await page.getByRole("button",{name:"Continuar",exact:true}).click();
  const issued2=await (await response2).json();
  await page.getByLabel("Chave recebida no WhatsApp").fill(issued2.devCode);
  await page.getByRole("button",{name:"Confirmar chave e continuar"}).click();
  await expect.poll(()=>page.evaluate(()=>Boolean(localStorage.getItem("conexao_token")))).toBe(true);
  const session=await page.evaluate(()=>localStorage.getItem("conexao_token"));
  const dashboard=await request.get(api+"/dashboard",{headers:{authorization:"Bearer "+session}});
  expect((await dashboard.json()).wallet.total).toBe(10);
  await page.screenshot({path:resolve("../../docs/evidencias/login-chave-conta-mobile.png"),fullPage:true});
});
