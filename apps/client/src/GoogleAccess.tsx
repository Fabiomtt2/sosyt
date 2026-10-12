import { useEffect, useRef, useState } from "react";
import { api, type GoogleIdentityClaim } from "./api";
import { isCompletePhoneField } from "./PhoneField";

const verifierKey="sos_google_browser_verifier";
const pendingKey="sos_google_identity_pending";
export function GoogleAccess({name,phone,onDone}:{name:string;phone:string;onDone:()=>void}) {
  const [configured,setConfigured]=useState(false);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const [claim,setClaim]=useState<GoogleIdentityClaim>();
  const started=useRef(false);
  const done=useRef(onDone);done.current=onDone;
  useEffect(()=>{
    void api.authOptions().then((value)=>setConfigured(value.googleConfigured)).catch(()=>{});
    if(started.current)return;started.current=true;
    const fragment=new URLSearchParams(window.location.hash.slice(1));
    const ticket=fragment.get("google_login"),failure=fragment.get("google_error");
    if(ticket||failure)history.replaceState(null,"",window.location.pathname+window.location.search);
    if(failure)setError(failure==="cancelled"?"Acesso Google cancelado. Você pode usar a chave WhatsApp.":"Não foi possível confirmar o acesso Google. Tente novamente.");
    const remember=(value:GoogleIdentityClaim)=>{setClaim(value);localStorage.setItem(pendingKey,value.requestToken);};
    if(ticket){
      const browserVerifier=sessionStorage.getItem(verifierKey);
      sessionStorage.removeItem(verifierKey);
      if(!browserVerifier){setError("Reinicie o acesso Google neste navegador.");return;}
      setBusy(true);
      void api.googleComplete({ticket,browserVerifier}).then((result)=>{
        if(result.token){
          localStorage.setItem("conexao_token",result.token);localStorage.removeItem("conexao_owner_token");
          localStorage.removeItem(pendingKey);done.current();
        }else if(result.claim)remember(result.claim);
      }).catch((cause)=>setError(cause instanceof Error?cause.message:"Falha no retorno Google.")).finally(()=>setBusy(false));
    }else{
      const saved=localStorage.getItem(pendingKey);
      if(saved)void api.googleStatus(saved).then(remember).catch(()=>localStorage.removeItem(pendingKey));
    }
  },[]);
  async function start(){
    setError("");setBusy(true);
    try{
      if(name.trim().length<2)throw new Error("Informe seu nome acima antes de continuar.");
      if(!isCompletePhoneField(phone))throw new Error("Informe seu WhatsApp acima para localizar o cadastro e grupo.");
      const browserVerifier=Array.from(crypto.getRandomValues(new Uint8Array(32)),value=>value.toString(16).padStart(2,"0")).join("");
      sessionStorage.setItem(verifierKey,browserVerifier);
      const result=await api.googleStart({name:name.trim(),phone,browserVerifier});
      window.location.assign(result.url);
    }catch(cause){sessionStorage.removeItem(verifierKey);setError(cause instanceof Error?cause.message:"Não foi possível iniciar o acesso Google.");setBusy(false);}
  }
  async function refresh(){
    if(!claim)return;setBusy(true);setError("");
    try{setClaim(await api.googleStatus(claim.requestToken));}
    catch(cause){setError(cause instanceof Error?cause.message:"Falha ao consultar associação.");}
    finally{setBusy(false);}
  }
  if(!configured&&!claim&&!error&&!busy)return null;
  return <aside className="google-access" aria-label="Acesso alternativo com Google">
    {claim&&<div role="status"><strong>Identidade Google</strong><p>{claim.message}</p><div className="ready-actions"><button type="button" className="text-button" disabled={busy} onClick={()=>void refresh()}>Verificar associação</button><button type="button" className="text-button" onClick={()=>{localStorage.removeItem(pendingKey);setClaim(undefined);}}>Ocultar acompanhamento</button></div></div>}
    {configured&&<><button type="button" className="secondary" disabled={busy} onClick={()=>void start()}>{busy?"Confirmando identidade…":"Continuar com Google"}</button><p className="muted">Opcional. Usamos sua identidade e e-mail para o acesso. Seu WhatsApp e grupo continuam vinculados à mesma conta; criar playlists terá uma autorização separada.</p></>}
    {error&&<p className="error" role="alert">{error}</p>}
  </aside>;
}
