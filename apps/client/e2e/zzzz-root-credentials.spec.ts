import {test,expect as browserExpect} from "@playwright/test";
import {ownerSession} from "./helpers/owner-session";
import Database from "better-sqlite3";
import {mkdirSync} from "node:fs";
import {resolve} from "node:path";
const expect=browserExpect.configure({timeout:15000});
test.use({actionTimeout:30000});
test("Root salva credencial na própria conta, administra outro Root e recupera um participante",async({page,request})=>{
 test.setTimeout(180000);
 const api="http://127.0.0.1:17333",owner=await ownerSession(request),headers={authorization:"Bearer "+owner};
 const memberPhone="5571999990974",memberName="Lia Credenciais";
 expect((await request.post(api+"/admin/members",{headers,data:{phone:memberPhone,name:memberName,groupCode:"1"}})).ok()).toBe(true);
 const code=(await(await request.post(api+"/auth/request-code",{data:{phone:memberPhone,name:memberName}})).json()).devCode;
 const member=await(await request.post(api+"/auth/verify",{data:{phone:memberPhone,code}})).json();
 const admin=await(await request.post(api+"/admin/participant-session",{headers})).json();
 const out=resolve("../../.local-tmp/benefit-halo-evidence");mkdirSync(out,{recursive:true});
 const db=new Database(resolve("../../.local-tmp/browser-test.db"));
 try{
  await page.goto("/?audit=root-credential");
  await page.evaluate(({owner,user})=>{localStorage.setItem("conexao_owner_token",owner);localStorage.setItem("conexao_token",user);localStorage.setItem("conexao_active_role","user");sessionStorage.setItem("sos-chat-open","false");},{owner,user:admin.token});await page.reload();
  await page.getByRole("button",{name:"Abrir menu da minha conta",exact:true}).click();
  const account=page.getByRole("dialog",{name:"Minha conta",exact:true});
  await account.locator("summary").filter({hasText:/^Minha credencial Owner$/}).click();
  const ownForm=account.getByRole("form",{name:"Minha credencial Owner",exact:true});
  await ownForm.getByLabel("Nova credencial Owner",{exact:true}).fill("E2eMinhaCredencial2026");
  await ownForm.getByLabel("Repita a credencial Owner",{exact:true}).fill("E2eMinhaCredencial2026");
  const ownSaved=page.waitForResponse(response=>response.url().endsWith("/admin/credentials")&&response.request().method()==="POST");
  await ownForm.getByRole("button",{name:"Salvar minha credencial Owner",exact:true}).click();expect((await ownSaved).status()).toBe(200);
  await expect(account.getByRole("status")).toContainText("Sua credencial Owner foi salva");
  for(const width of [1440,390]){await page.setViewportSize({width,height:960});await ownForm.scrollIntoViewIfNeeded();expect(await account.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);await page.screenshot({path:resolve(out,"root-credential-self-"+width+".png"),animations:"disabled"});}
  await account.getByRole("button",{name:"Fechar minha conta",exact:true}).click();
  await page.evaluate(()=>localStorage.setItem("conexao_active_role","owner"));await page.reload();
  await page.getByRole("navigation",{name:"Seções administrativas"}).getByRole("button",{name:"Acesso",exact:true}).click();
  const rootForm=page.getByRole("form",{name:"Credencial de outro Owner",exact:true});
  await rootForm.getByLabel("Owner para alterar credencial",{exact:true}).selectOption("rafael");
  await rootForm.getByLabel("Nova credencial do Owner",{exact:true}).fill("E2eOutroOwner2026");await rootForm.getByLabel("Repita a credencial do Owner",{exact:true}).fill("E2eOutroOwner2026");await rootForm.getByLabel("Motivo da alteração",{exact:true}).fill("Recuperação sintética autorizada pelo outro Owner");
  const rootSaved=page.waitForResponse(response=>response.url().endsWith("/admin/credentials")&&response.request().method()==="POST");await rootForm.getByRole("button",{name:"Salvar credencial do Owner",exact:true}).click();expect((await rootSaved).status()).toBe(200);await expect(rootForm.getByRole("status")).toContainText("A nova credencial do Owner foi salva");
  const memberForm=page.getByRole("form",{name:"Senha provisória de participante",exact:true});
  await memberForm.getByLabel("Buscar participante",{exact:true}).fill(memberName);await memberForm.getByLabel("Participante para senha provisória",{exact:true}).selectOption(member.user.id);
  await memberForm.getByLabel("Nova senha provisória",{exact:true}).fill("E2eLiaProvisoria2026");await memberForm.getByLabel("Repita a senha provisória",{exact:true}).fill("E2eLiaProvisoria2026");await memberForm.getByLabel("Motivo da recuperação",{exact:true}).fill("Pessoa solicitou recuperar acesso no cenário sintético");
  const memberSaved=page.waitForResponse(response=>response.url().endsWith("/admin/participants/"+memberPhone+"/password")&&response.request().method()==="POST");await memberForm.getByRole("button",{name:"Salvar senha provisória",exact:true}).click();expect((await memberSaved).status()).toBe(200);await expect(memberForm.getByRole("status")).toContainText("Senha provisória salva");
  for(const width of [1440,390]){await page.setViewportSize({width,height:960});await memberForm.scrollIntoViewIfNeeded();expect(await page.locator(".owner-access-panel").evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);await page.screenshot({path:resolve(out,"root-credential-member-"+width+".png"),animations:"disabled"});}
  const login=await request.post(api+"/auth/password/login",{data:{phone:memberPhone,password:"E2eLiaProvisoria2026"}});expect(login.ok(),await login.text()).toBe(true);expect((await login.json()).mustChangePassword).toBe(true);
  const rows=db.prepare("SELECT event,actor_owner_id AS actor,detail FROM password_reset_audit WHERE event='CREDENTIAL_SET' ORDER BY rowid DESC LIMIT 3").all() as {actor:string;detail:string}[];expect(rows).toHaveLength(3);expect(rows.every(row=>row.actor==="fabio")).toBe(true);expect(JSON.stringify(rows)).not.toContain("E2e");
 }finally{db.close();}
});
