import type { ReactNode } from "react";
import { X } from "lucide-react";
import { useModalLifecycle } from "./useModalLifecycle";
export function JourneyModal({ children, onClose }:{children:ReactNode;onClose:()=>void}) {
 const ref=useModalLifecycle(onClose);
 return <div className="modal-backdrop" onMouseDown={onClose}>
  <section ref={ref} className="modal journey-modal" role="dialog" aria-modal="true" aria-label="Minha jornada" onMouseDown={e=>e.stopPropagation()}>
   <div className="journey-modal-toolbar"><strong>Minha jornada</strong><button className="close" aria-label="Fechar minha jornada" onClick={onClose}><X size={20}/></button></div>{children}
  </section>
 </div>;
}
