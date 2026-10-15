import {useEffect,useState,type CSSProperties} from "react";
import {createPortal} from "react-dom";
import {Coins,Ticket,ArrowUpRight,Sparkles,X} from "lucide-react";
import type {PurchaseReceipt} from "./api";
import {quantity,receiptLabels} from "./commerce";

export function PurchaseCelebration({receipt,onClose,onInventory}:{receipt:PurchaseReceipt;onClose:()=>void;onInventory:()=>void}){
 const [destination,setDestination]=useState<{x:number;y:number}>();
 const superPurchase=receipt.subscriptionDays>0;
 const Icon=superPurchase?Sparkles:receipt.credits>0?Coins:receipt.extraPasses>0?Ticket:ArrowUpRight;
 const itemCount=receipt.items.reduce((n,item)=>n+item.quantity,0);
 const increase=superPurchase?"SUPER ativado":receipt.credits>0?"+"+quantity(receipt.credits):receipt.extraPasses>0?"+"+receipt.extraPasses+" passe"+(receipt.extraPasses===1?"":"s"):itemCount>0?"+"+itemCount+" item"+(itemCount===1?"":"s"):"Confirmado";
 useEffect(()=>{
  const anchor=document.querySelector(receipt.credits>0?'[data-purchase-anchor="coins"]':'[data-purchase-anchor="inventory"]');
  const rect=anchor?.getBoundingClientRect();
  if(rect&&rect.top>=0&&rect.bottom<window.innerHeight&&rect.right<window.innerWidth)setDestination({x:rect.left+rect.width/2,y:rect.top+rect.height/2});
  // The wallet can sit outside the viewport on a compact dashboard. Keep
  // quantity feedback visible without scrolling the person unexpectedly.
  if(!rect || rect.top<0 || rect.bottom>=window.innerHeight || rect.right>=window.innerWidth) {
    const profile=document.querySelector(".header-actions .profile")?.getBoundingClientRect();
    if(profile)setDestination({x:Math.min(window.innerWidth-54,profile.left+profile.width/2),y:Math.max(65,profile.bottom+20)});
  }
  const timer=window.setTimeout(onClose,6500);
  return()=>window.clearTimeout(timer);
 },[receipt.paymentId,onClose,receipt.credits]);
 return createPortal(<>
  {destination&&<div className="purchase-arrival" style={{left:destination.x,top:destination.y}} aria-hidden="true">
   {[0,1,2,3,4].map(n=><i key={n} style={{"--spread":(n-2)*18+"px","--delay":n*85+"ms"} as CSSProperties}><Icon size={23}/></i>)}
   <b>{increase}</b>
  </div>}
  <section className={"purchase-celebration"+(superPurchase?" is-super":"")} role="status" aria-live="polite" aria-label="Compra confirmada" data-payment-id={receipt.paymentId}>
   <button className="celebration-close" onClick={onClose} aria-label="Fechar confirmação"><X size={16}/></button>
   <span className="celebration-emblem"><Icon size={29}/></span>
   <div><small>{superPurchase?"SEU MOMENTO SUPER":"CHEGOU À SUA CONTA"}</small>
   <strong>{superPurchase?"Seu novo brilho está ativo.":"Compra confirmada!"}</strong>
   <p>{receiptLabels(receipt).join(" · ")}</p>
   {superPurchase&&<p>Seu avatar ganhou uma moldura. Aproveite cada conversa.</p>}
   <button className="text-button" onClick={()=>{onClose();onInventory();}}>Ver meu inventário</button></div>
  </section>
 </>,document.body);
}
