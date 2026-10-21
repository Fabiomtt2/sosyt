import {useEffect,useId,useRef,useState} from "react";
import type {Dashboard,SuperState} from "./api";
import {CommerceArtwork} from "./CommerceArtwork";
import {inventoryStatusChanges,type InventoryStatusSnapshot,type InventoryStatusChange} from "./inventory-status";
import "./inventory-statusbar.css";

const quantity=(value?:number)=>typeof value==="number"&&Number.isFinite(value)?value.toLocaleString("pt-BR",{maximumFractionDigits:3}):"—";
const expiry=(value:string)=>new Date(value).toLocaleString("pt-BR",{day:"2-digit",month:"2-digit",year:"numeric",hour:"2-digit",minute:"2-digit"});
type Props={accountId:string;wallet?:Dashboard["wallet"];skipsAvailable?:number;passesAvailable?:number;subscription?:SuperState;onUseSkip?:()=>void;onUsePass?:()=>void;onOpenStore?:()=>void};
/** Parent supplies confirmed dashboard state; this component never credits or predicts a balance. */
export function InventoryStatusBar({accountId,wallet,skipsAvailable,passesAvailable,subscription,onUseSkip,onUsePass,onOpenStore}:Props){
 const previous=useRef<InventoryStatusSnapshot|undefined>(undefined),revision=useRef(0),tooltipPrefix=useId();
 const [changes,setChanges]=useState<Array<InventoryStatusChange&{revision:number}>>([]);
 const [expanded,setExpanded]=useState<string>();
 const coins=wallet?.total,passes=passesAvailable??wallet?.extraPasses,skips=skipsAvailable;
 const administrative=subscription?.source==="ROOT_OWNER",superActive=subscription?.active,superExpiresAt=subscription?.expiresAt;
 useEffect(()=>{
  const snapshot={accountId,coins,passes,skips,administrative,superActive,superExpiresAt};
  const updates=inventoryStatusChanges(previous.current,snapshot);previous.current=snapshot;
  if(!updates.length){setChanges([]);return;}
  setChanges(updates.map(change=>({...change,revision:++revision.current})));
  const timer=window.setTimeout(()=>setChanges([]),2400);return()=>window.clearTimeout(timer);
 },[accountId,coins,passes,skips,administrative,superActive,superExpiresAt]);
 const entries=[
  {kind:"coins" as const,name:"Moedas",value:quantity(coins),details:wallet?`Compradas: ${quantity(wallet.purchased)}. Recompensas: ${quantity(wallet.reward)}. Iniciais: ${quantity(wallet.promo)}. Cada URL usa 1 moeda.`:"Atualizando saldo confirmado."},
  {kind:"pass" as const,name:"Passe",value:administrative?"ADMIN":quantity(passes),details:administrative?"Acesso administrativo sem consumo de Passe.":"Abre outra fila ou permite uma contribuição extra. Salvar a URL também usa 1 moeda."},
  {kind:"skip" as const,name:"Pular",value:administrative?"ADMIN":quantity(skips),details:administrative?"Acesso administrativo sem consumo de Pular.":"Abre outra fila e mantém sua participação e o progresso na atual. Não conclui vídeos por você."},
  {kind:"super" as const,name:"SUPER",value:administrative?"ADMIN":subscription?superActive?"Ativo":"Inativo":"—",details:administrative?"Benefícios SUPER incluídos no acesso administrativo.":superExpiresAt?`${superActive?"Ativo até":"Validade registrada"}: ${expiry(superExpiresAt)}.`:superActive?"SUPER ativo nesta conta.":"Sem assinatura SUPER ativa."}
 ];
 return <section className="inventory-statusbar" aria-label="Inventário da conta">
  <ul className="inventory-status-items">{entries.map(entry=>{
   const change=changes.find(item=>item.kind===entry.kind),id=tooltipPrefix+"-"+entry.kind;
   return <li key={entry.kind} className={"inventory-status-item status-"+entry.kind+(entry.kind==="super"&&superActive?" is-active":"")+(change?" has-"+change.direction:"")}>
    <button className="inventory-status-trigger" type="button" aria-label={entry.name+": "+entry.value} aria-describedby={id} onClick={()=>{
      const action=entry.kind==="skip"?onUseSkip:entry.kind==="pass"?onUsePass:onOpenStore;
      if(action){setExpanded(undefined);action();}else setExpanded(value=>value===entry.kind?undefined:entry.kind);
     }} onKeyDown={event=>{if(event.key==="Escape")setExpanded(undefined);}}>
     <span className="inventory-status-art" aria-hidden="true"><CommerceArtwork kind={entry.kind}/></span>
     <strong className="inventory-status-quantity">{entry.value}</strong><span className="inventory-status-label">{entry.name}</span>
    </button>
    <button type="button" className="inventory-status-info" aria-label={"Detalhes de "+entry.name} aria-controls={id} aria-expanded={expanded===entry.kind} onClick={()=>setExpanded(value=>value===entry.kind?undefined:entry.kind)} onKeyDown={event=>{if(event.key==="Escape")setExpanded(undefined);}}>i</button>
    <span className={"inventory-status-detail"+(expanded===entry.kind?" is-expanded":"")} role="tooltip" id={id}>{entry.details}</span>
    {change&&<span key={change.revision} className={"inventory-status-change is-"+change.direction} aria-hidden="true">{change.label}</span>}
   </li>;
  })}</ul>
  <span className="inventory-status-announcement" role="status" aria-live="polite" aria-atomic="true">{changes.map(change=>change.announcement).join(" ")}</span>
 </section>;
}
