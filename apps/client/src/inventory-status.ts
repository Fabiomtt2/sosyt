export type InventoryStatusSnapshot={
 accountId:string;coins?:number;passes?:number;skips?:number;administrative:boolean;
 superActive?:boolean;superExpiresAt?:string;
};
export type InventoryStatusChange={kind:"coins"|"pass"|"skip"|"super";direction:"gain"|"loss";label:string;announcement:string};
const quantity=(n:number)=>n.toLocaleString("pt-BR",{maximumFractionDigits:3});
/** Only differences between two confirmed snapshots of the same account are changes. */
export function inventoryStatusChanges(previous:InventoryStatusSnapshot|undefined,current:InventoryStatusSnapshot):InventoryStatusChange[]{
 if(!previous||previous.accountId!==current.accountId||previous.administrative!==current.administrative)return [];
 const changes:InventoryStatusChange[]=[];
 for(const [field,kind,name] of [["coins","coins","Moedas"],["passes","pass","Passe"],["skips","skip","Pular"]] as const){
  if(current.administrative&&field!=="coins")continue;
  const before=previous[field],after=current[field];
  if(typeof before!=="number"||typeof after!=="number"||!Number.isFinite(before)||!Number.isFinite(after))continue;
  const delta=Math.round((after-before)*1000)/1000;if(!delta)continue;
  changes.push({kind,direction:delta>0?"gain":"loss",label:(delta>0?"+":"−")+quantity(Math.abs(delta)),announcement:name+": "+(delta>0?"aumento de ":"redução de ")+quantity(Math.abs(delta))+". Saldo confirmado: "+quantity(after)+"."});
 }
 if(!current.administrative&&typeof previous.superActive==="boolean"&&typeof current.superActive==="boolean"){
  if(previous.superActive!==current.superActive)changes.push({kind:"super",direction:current.superActive?"gain":"loss",label:current.superActive?"+SUPER":"−SUPER",announcement:current.superActive?"SUPER ativado nesta conta.":"SUPER agora está inativo."});
  else if(current.superActive&&previous.superExpiresAt&&current.superExpiresAt){
   const difference=Date.parse(current.superExpiresAt)-Date.parse(previous.superExpiresAt);
   // Expiration is a server timestamp. The ticking countdown never generates an event.
   const days=Math.round(difference/86_400_000);
   if(Number.isFinite(days)&&days!==0)changes.push({kind:"super",direction:days>0?"gain":"loss",label:(days>0?"+":"−")+Math.abs(days)+" dias",announcement:"Validade do SUPER "+(days>0?"ampliada":"reduzida")+" em "+Math.abs(days)+" dias."});
  }
 }
 return changes;
}
