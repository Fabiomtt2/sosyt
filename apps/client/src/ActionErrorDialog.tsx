import {createPortal} from "react-dom";
import {CircleAlert,X} from "lucide-react";
import {useModalLifecycle} from "./useModalLifecycle";
export function ActionErrorDialog({message,onClose}:{message:string;onClose:()=>void}){
 const ref=useModalLifecycle(onClose);
 return createPortal(<div className="modal-backdrop action-error-backdrop" onMouseDown={onClose}><section ref={ref} role="alertdialog" aria-modal="true" aria-labelledby="action-error-title" aria-describedby="action-error-message" className="modal action-error-dialog" onMouseDown={event=>event.stopPropagation()}>
  <button type="button" className="close" onClick={onClose} aria-label="Fechar aviso"><X size={20}/></button><CircleAlert size={30}/><h2 id="action-error-title">Vamos conferir este passo</h2><p id="action-error-message" className="error">{message}</p><button type="button" className="primary" onClick={onClose}>Entendi, voltar</button>
 </section></div>,document.body);
}
