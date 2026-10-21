import {useState} from "react";
import {Eye} from "lucide-react";
import {useModalLifecycle} from "./useModalLifecycle";
import "./watch-presence.css";
export function WatchPresencePrompt({onConfirm,onPause}:{onConfirm:()=>Promise<void>;onPause:()=>void}){
 const [busy,setBusy]=useState(false),[error,setError]=useState("");
 const modal=useModalLifecycle(onPause,true,!busy);
 async function confirm(){
  if(busy)return;setBusy(true);setError("");
  try{await onConfirm();}catch(cause){setError(cause instanceof Error?cause.message:"Não conseguimos confirmar agora. Tente novamente.");}finally{setBusy(false);}
 }
 return <div className="watch-presence-backdrop" onMouseDown={event=>event.stopPropagation()}><section ref={node=>{modal.current=node;}} className="watch-presence-prompt" role="dialog" aria-modal="true" aria-labelledby="watch-presence-heading">
  <span className="watch-presence-eye" aria-hidden="true"><Eye size={30}/></span>
  <p className="eyebrow dark">UMA PAUSA PARA CONTINUAR</p>
  <h2 id="watch-presence-heading">Você continua por aqui?</h2>
  <p>O player foi pausado. Confirme para retomar o acompanhamento; este intervalo não gera XP nem moedas.</p>
  <p className="watch-presence-reassurance">Seu progresso anterior está salvo. Você pode voltar quando quiser.</p>
  {error&&<p className="error" role="alert">{error}</p>}
  <button type="button" className="primary" disabled={busy} onClick={()=>void confirm()}>{busy?"Confirmando…":"Estou aqui, continuar"}</button>
  <button type="button" className="secondary" disabled={busy} onClick={onPause}>Pausar por enquanto</button>
 </section></div>;
}
