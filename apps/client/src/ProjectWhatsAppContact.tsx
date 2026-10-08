import { useEffect,useState } from "react";
import { MessageCircle } from "lucide-react";
import { participationApi } from "./api";

/** Resolve the public contact from the server, never from a frontend phone literal. */
export function ProjectWhatsAppContact(){
 const [url,setUrl]=useState<string>();
 useEffect(()=>{
  let active=true,inFlight=false;
  async function refresh(){
   if(inFlight||document.visibilityState==="hidden")return;
   inFlight=true;
   try{const result=await participationApi.groups();if(active)setUrl(result.whatsappJoinUrl);}
   catch{/* Keep the last known public contact during transient network failure. */}
   finally{inFlight=false;}
  }
  void refresh();
  const timer=window.setInterval(()=>void refresh(),10_000);
  const focus=()=>void refresh();
  window.addEventListener("focus",focus);document.addEventListener("visibilitychange",focus);
  return()=>{active=false;window.clearInterval(timer);window.removeEventListener("focus",focus);document.removeEventListener("visibilitychange",focus);};
 },[]);
 if(!url)return null;
 return <aside className="project-whatsapp-contact"><a className="text-button" href={url} target="_blank" rel="noreferrer"><MessageCircle size={17}/>Conversar com o SOS no WhatsApp</a><p className="muted">Abre uma mensagem pronta para você enviar. Também pode pedir ajuda por lá.</p></aside>;
}
