import type {CommerceProduct,PurchaseReceipt} from "./api";
export const quantity=(value:number)=>value.toLocaleString("pt-BR",{maximumFractionDigits:3});
export function benefitLabels(item:{credits:number;extraPasses:number;subscriptionDays?:number;grantsItem?:string;grantsItemQty?:number}) {
 const parts:string[]=[];
 if(item.credits>0)parts.push(quantity(item.credits)+(item.credits===1?" moeda":" moedas"));
 if(item.extraPasses>0)parts.push(quantity(item.extraPasses)+(item.extraPasses===1?" passe":" passes"));
 if(item.subscriptionDays)parts.push("SUPER por "+item.subscriptionDays+" dias");
 else if(item.grantsItem&&(item.grantsItemQty??0)>0)parts.push(quantity(item.grantsItemQty!)+" "+(item.grantsItem==="SKIP"?"Pular":item.grantsItem));
 return parts;
}
export const productKind=(item:CommerceProduct):"coins"|"super"|"skip"|"pass"|"item"=>item.subscriptionDays?"super":item.credits>0?"coins":item.grantsItem==="SKIP"?"skip":item.extraPasses>0?"pass":"item";
export function productExplanation(item:CommerceProduct) {
 return [
  item.credits>0?"Cada moeda permite salvar uma URL válida.":null,
  item.extraPasses>0?"O passe abre outra fila ou permite uma contribuição extra na mesma fila; salvar a URL também usa 1 moeda.":null,
  item.grantsItem==="SKIP"&&!item.subscriptionDays?"Pular abre outra fila sem apagar sua participação e seu progresso na atual. Não conclui vídeos por você.":null,
  item.subscriptionDays?"Seu avatar continua o mesmo, com moldura SUPER enquanto a assinatura estiver ativa. Você também tem chat sem espera, até 5 vídeos por fila e divulgação do canal.":null
 ].filter(Boolean).join(" ");
}
export const receiptLabels=(receipt:PurchaseReceipt)=>[
 ...benefitLabels(receipt),
 ...receipt.items.map(item=>quantity(item.quantity)+" "+(item.itemCode==="SKIP"?"Pular":item.itemCode))
];
