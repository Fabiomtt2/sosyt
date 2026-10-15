import {afterEach,beforeEach,expect,it,vi} from "vitest";
import {claimPurchase,rememberPurchase} from "./usePurchaseFeedback";
import {benefitLabels,productKind,productExplanation,receiptLabels} from "./commerce";
const storage=new Map<string,string>();
beforeEach(()=>{storage.clear();vi.stubGlobal("localStorage",{getItem:(key:string)=>storage.get(key)??null,setItem:(key:string,value:string)=>storage.set(key,value)});});
afterEach(()=>vi.unstubAllGlobals());
it("uma confirmação é apresentada uma vez por usuário, inclusive após fechar a compra",()=>{
 rememberPurchase("alice","payment-1");
 expect(claimPurchase("alice","payment-1")).toBe(true);
 expect(claimPurchase("alice","payment-1")).toBe(false);
 expect(claimPurchase("bruno","payment-1")).toBe(true);
 expect(JSON.parse(storage.get("sos_purchases_v1:alice:pending")!)).toEqual([]);
});
it("benefícios não confundem assinatura com item nem Pular com passe",()=>{
 const base={code:"X",title:"Oferta",description:"",amountCents:2000,credits:0,extraPasses:0};
 const skip={...base,grantsItem:"SKIP",grantsItemQty:2};
 expect(productKind(skip)).toBe("skip");
 expect(benefitLabels(skip)).toEqual(["2 Pular"]);
 expect(productExplanation(skip)).toContain("Não conclui vídeos");
 expect(productKind({...base,extraPasses:1})).toBe("pass");
 expect(benefitLabels({...base,grantsItem:"SUPER",grantsItemQty:1,subscriptionDays:30})).toEqual(["SUPER por 30 dias"]);
});
it("comemoração descreve quantidade entregue, incluindo valores fracionados",()=>{
 expect(receiptLabels({userId:"alice",paymentId:"p1",productCode:"CUSTOM",amountCents:1000,approvedAt:"2026-10-14",credits:2.5,extraPasses:1,subscriptionDays:0,items:[{itemCode:"SKIP",quantity:2}]})).toEqual(["2,5 moedas","1 passe","2 Pular"]);
});

it("confirmação não se repete quando o navegador lê o armazenamento mas recusa gravação",()=>{
 vi.stubGlobal("localStorage",{getItem:()=>null,setItem:()=>{throw new Error("QuotaExceeded");}});
 rememberPurchase("storage-blocked","payment-blocked");
 expect(claimPurchase("storage-blocked","payment-blocked")).toBe(true);
 expect(claimPurchase("storage-blocked","payment-blocked")).toBe(false);
});
