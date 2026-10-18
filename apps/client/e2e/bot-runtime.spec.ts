import {test,expect} from "@playwright/test";
import {resolve} from "node:path";
import {ownerSession} from "./helpers/owner-session";
test("Root acompanha eventos, agenda humana e teste sem disparo automático",async({page,request})=>{
 const api="http://127.0.0.1:17333",token=await ownerSession(request),headers={authorization:"Bearer "+token};
 const initial=await (await request.get(api+"/admin/bot/automations/runtime",{headers})).json();
 let testsRequested=0;page.on("request",r=>{if(r.method()==="POST"&&r.url().endsWith("/admin/bot/test-message"))testsRequested++;});
 await page.goto("/?audit=bot-runtime-synthetic");
 await page.evaluate(t=>{localStorage.setItem("conexao_owner_token",t);localStorage.setItem("conexao_active_role","owner");},token);await page.reload();
 await page.getByRole("button",{name:"Atitudes do bot",exact:true}).click();
 await expect(page.getByRole("heading",{name:"Operação e entregas"})).toBeVisible();
 await expect(page.getByRole("button",{name:"Testar no meu WhatsApp",exact:true})).toBeEnabled();
 expect(testsRequested).toBe(0);
 await expect(page.getByRole("button",{name:"Confirmar e enfileirar",exact:true})).toBeDisabled();
 const schedule=page.getByRole("checkbox",{name:"Definir horário do atendimento humano"});
 await schedule.check();
 await page.getByLabel("Hora de início do atendimento humano").selectOption("9");
 await page.getByLabel("Hora de fim do atendimento humano").selectOption("18");
 await page.getByRole("button",{name:"Salvar horário",exact:true}).click();
 await expect(page.getByRole("status").filter({hasText:"Horário salvo."})).toBeVisible();
 const stored=await (await request.get(api+"/admin/bot/support-availability",{headers})).json();
 expect(stored).toMatchObject({enabled:true,startHour:9,endHour:18,timeZone:"America/Bahia"});
 for(const width of [1440,390]){
  await page.setViewportSize({width,height:960});
  await page.getByRole("heading",{name:"Operação e entregas"}).scrollIntoViewIfNeeded();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:resolve("../../.local-tmp/bot-runtime-after-"+width+".png"),animations:"disabled"});
 }
 expect(testsRequested).toBe(0);
 const final=await (await request.get(api+"/admin/bot/automations/runtime",{headers})).json();
 expect(final.events).toEqual(initial.events);
 await request.post(api+"/admin/bot/support-availability",{headers,data:{enabled:false,days:[0,1,2,3,4,5,6],startHour:0,endHour:24}});
});
