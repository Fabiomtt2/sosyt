import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { useModalLifecycle } from "./useModalLifecycle";
import { CommerceArtwork } from "./CommerceArtwork";
import "./redemption-celebration.css";

export type ConfirmedRedemption={code:"PASS"|"SKIP";price?:number;replayed:boolean};
/** A reward exchange receipt is deliberately separate from a payment receipt. */
export function RedemptionCelebration({receipt,onClose}:{receipt:ConfirmedRedemption;onClose:()=>void}) {
 const modalRef=useModalLifecycle(onClose);
 const label=receipt.code==="PASS"?"Passe":"Pular";
 return createPortal(<div className="redemption-confirm-backdrop" onMouseDown={onClose}><section ref={modalRef} className="purchase-celebration redemption-celebration" role="dialog" aria-modal="true" aria-label="Troca concluída" onMouseDown={event=>event.stopPropagation()}>
  <button type="button" className="celebration-close" aria-label="Fechar confirmação da troca" onClick={onClose}><X size={18}/></button>
  <span className="redemption-receipt-art"><CommerceArtwork kind={receipt.code==="PASS"?"pass":"skip"}/></span>
  <div><small>SUAS RECOMPENSAS VIRARAM UM ITEM</small><strong role="status" aria-live="polite" aria-label="Troca concluída">{receipt.replayed?"Troca já registrada":"Troca concluída!"}</strong>
   <p className="redemption-item-quantity"><b>{receipt.replayed?"1":"+1"} {label}</b> no seu inventário</p>
   <p>{receipt.price!==undefined?<><b>{receipt.price.toLocaleString("pt-BR")}</b> moedas de recompensa debitadas.</>:"Seu saldo de recompensa foi usado nesta troca."} {receipt.replayed?"A repetição não fez um novo débito.":"Moedas compradas preservadas."}</p>
   <p>{receipt.code==="PASS"?"Use para abrir outra fila ou enviar uma contribuição extra.":"Use para entrar em outra fila mantendo a atual."}</p>
   <button type="button" className="text-button" onClick={onClose}>Entendi</button>
  </div>
 </section></div>,document.body);
}
