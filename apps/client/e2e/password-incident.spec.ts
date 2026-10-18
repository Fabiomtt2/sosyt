import {test,expect,type Page} from "@playwright/test";
import {resolve} from "node:path";

async function identify(page:Page){
 await page.getByLabel("Seu nome ou como prefere ser chamado").fill("Pessoa Bot");
 await page.getByRole("button",{name:"Selecionar país e DDI"}).click();
 await page.keyboard.type("55");await page.getByRole("button",{name:"Brasil +55"}).click();
 await page.getByRole("button",{name:"Selecionar DDD do Brasil"}).click();
 await page.keyboard.type("71");await page.getByRole("button",{name:"DDD 71 BA"}).click();
 await page.getByLabel("WhatsApp",{exact:true}).fill("999998078");
}
for(const status of [401,403]){
 test("senha rejeitada "+status+" não cria pedido de aprovação",async({page})=>{
  let requests=0,passwords=0,keys=0;
  await page.route("**/auth/role",r=>r.fulfill({json:{role:"user"}}));
  await page.route("**/auth/password/login",r=>{passwords++;return r.fulfill({status,json:{message:"Senha recusada para teste."}});});
  await page.route("**/participation/request",r=>{requests++;return r.fulfill({status:500,json:{message:"Não deve registrar pedido."}});});
  await page.route("**/auth/request-code",r=>{keys++;return r.fulfill({status:500,json:{message:"Não deve pedir chave."}});});
  await page.goto("/?audit=password-incident");
  await expect(page.getByLabel("Senha recebida ou criada por você")).toBeVisible();
  await identify(page);
  await page.getByLabel("Senha recebida ou criada por você").fill("SyntheticPassword123");
  await page.getByRole("button",{name:"Continuar",exact:true}).click();
  await expect(page.getByRole("alert")).toHaveText("Senha recusada para teste.");
  expect(passwords).toBe(1);expect(requests).toBe(0);expect(keys).toBe(0);
  await expect(page.getByRole("heading",{name:"Solicitação em análise"})).toHaveCount(0);
 });
}
test("pendência antiga permite entrar com senha no mesmo número",async({page})=>{
 await page.addInitScript(()=>localStorage.setItem("conexao_participation_request",JSON.stringify({token:"synthetic-pending"})));
 await page.route("**/participation/status",r=>r.fulfill({json:{status:"PENDING",requestToken:"synthetic-pending",name:"Pessoa Bot",phone:"5571999998078",message:"Pedido antigo"}}));
 await page.goto("/?audit=password-pending");
 await page.getByRole("button",{name:"Já recebi a senha — entrar na minha conta",exact:true}).click();
 await expect(page.getByLabel("Senha recebida ou criada por você")).toBeVisible();
 await expect(page.getByLabel("Seu nome ou como prefere ser chamado")).toHaveValue("Pessoa Bot");
 expect(await page.evaluate(()=>localStorage.getItem("conexao_participation_request"))).toBeNull();
});

test("senha abre dashboard com entrada no grupo pendente e permite acompanhar convite",async({page,request})=>{
 const {ownerSession}=await import("./helpers/owner-session");
 const token=await ownerSession(request),api="http://127.0.0.1:17333",phone="5571999998078";
 expect((await request.post(api+"/admin/members",{headers:{authorization:"Bearer "+token},data:{name:"Pessoa Bot",phone,groupCode:"1"}})).ok()).toBe(true);
 const login=await request.post(api+"/auth/login",{data:{name:"Pessoa Bot",phone}});
 expect(login.ok()).toBe(true);const session=(await login.json()).token;
 const response=await request.get(api+"/dashboard",{headers:{authorization:"Bearer "+session}});
 expect(response.ok()).toBe(true);const fixture=await response.json();
 let state:"JOINING"|"INVITED"|"NEEDS_SUPPORT"="JOINING";
 await page.route("**/auth/role",r=>r.fulfill({json:{role:"user"}}));
 await page.route("**/auth/password/login",r=>r.fulfill({json:{token:session,mustChangePassword:false}}));
 await page.route("**/dashboard",r=>r.fulfill({json:{...fixture,groupAccess:{ready:false,state}}}));
 await page.goto("/?audit=password-group-pending");await identify(page);
 await page.getByLabel("Senha recebida ou criada por você").fill("SyntheticPassword123");
 await page.getByRole("button",{name:"Continuar",exact:true}).click();
 const status=page.getByRole("status",{name:"Entrada no grupo"});
 await expect(status).toContainText("Estamos preparando sua entrada no grupo");
 await expect(page.getByRole("button",{name:"Abrir menu da minha conta"})).toBeVisible();
 for(const width of [1440,390]){
  await page.setViewportSize({width,height:960});
  await page.screenshot({path:resolve("../../.local-tmp/password-group-pending-"+width+".png"),animations:"disabled"});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 }
 await expect(page.getByPlaceholder("Cole a URL do seu vídeo no YouTube")).toHaveCount(0);
 await page.getByRole("button",{name:"Abrir menu da minha conta"}).click();
 const account=page.getByRole("dialog",{name:"Minha conta"});
 await expect(account).toContainText("Entrada no grupo em andamento");
 await expect(account).not.toContainText("Acesso autorizado pelo Owner");
 await account.getByRole("button",{name:"Fechar minha conta"}).click();
 state="INVITED";await page.getByTitle("Atualizar",{exact:true}).click();
 await expect(status).toContainText("Confira seu convite no WhatsApp");
 state="NEEDS_SUPPORT";await page.getByTitle("Atualizar",{exact:true}).click();
 await expect(status).toContainText("Sua entrada no grupo precisa de atenção");
});

test("Evolution encaminha cadastro ao bot sem pedir OTP ou aprovação manual",async({page})=>{
 let approvals=0,keys=0,options=0;
 const link="https://wa.me/5511999999999?text=Ol%C3%A1";
 await page.route("**/auth/options",r=>{options++;return r.fulfill({json:{proofRequired:true,googleRequired:false,googleConfigured:false,whatsappConfigured:true,whatsappMode:"EVOLUTION",botRegistrationUrl:link}});});
 await page.route("**/auth/request-code",r=>{keys++;return r.fulfill({status:500,json:{message:"OTP não deve ser solicitado."}});});
 await page.route("**/participation/request",r=>{approvals++;return r.fulfill({status:500,json:{message:"Não deve criar aprovação."}});});
 await page.goto("/?audit=evolution-registration");
 await expect(page.getByRole("button",{name:"Prefiro a chave no WhatsApp",exact:true})).toHaveCount(0);
 await page.getByRole("button",{name:"Quero participar",exact:true}).click();
 await identify(page);await page.getByRole("checkbox").check();
 await page.getByRole("button",{name:"Enviar dados e continuar",exact:true}).click();
 const status=page.getByRole("status",{name:"Cadastro com o bot"});
 await expect(status).toContainText("O bot vai confirmar como você quer ser chamado e enviar sua senha nesta conversa.");
 await expect(status.getByRole("link",{name:"Abrir conversa para cadastro no WhatsApp"})).toHaveAttribute("href",link);
 await expect(status).toContainText("nenhuma mensagem é enviada automaticamente");
 expect(approvals).toBe(0);expect(keys).toBe(0);expect(options).toBe(1);
});
