import { useCallback, useEffect, useState } from "react";
import { ownerApi, type GoogleIdentityRequest } from "./api";

function IdentityRequest({item,onChange}:{item:GoogleIdentityRequest;onChange:()=>Promise<void>}){
  const [group,setGroup]=useState(item.groupCode??"");
  const [confirmed,setConfirmed]=useState(false);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  async function decide(approve:boolean){
    setBusy(true);setError("");
    try{await ownerApi.decideGoogleIdentity(item.id,approve,approve?group:undefined);await onChange();}
    catch(cause){setError(cause instanceof Error?cause.message:"Não foi possível analisar o vínculo.");}
    finally{setBusy(false);}
  }
  return <article className="identity-request">
    <div><strong>{item.name}</strong><span>{item.phone}</span><span>{item.email}</span><small>Google confirmou este e-mail. O vínculo com o WhatsApp precisa ser conferido.</small></div>
    <div><label>Grupo SOS YOUTUBER<input inputMode="numeric" value={group} maxLength={3} onChange={event=>setGroup(event.target.value.replace(/\D/g,""))}/></label>
      <label className="consent-row"><input type="checkbox" checked={confirmed} onChange={event=>setConfirmed(event.target.checked)}/><span>Conferi com o participante que este Google e WhatsApp pertencem à mesma pessoa.</span></label>
      <div className="ready-actions"><button className="primary compact" disabled={busy||!confirmed||!/^[1-9]\d{0,2}$/.test(group)} onClick={()=>void decide(true)}>Confirmar vínculo</button><button className="text-button" disabled={busy} onClick={()=>void decide(false)}>Não aprovar</button></div>
      {error&&<p className="error" role="alert">{error}</p>}
    </div>
  </article>;
}
export function GoogleIdentityRequests(){
  const [items,setItems]=useState<GoogleIdentityRequest[]>([]);
  const [error,setError]=useState("");
  const load=useCallback(async()=>{try{setItems((await ownerApi.googleIdentities()).claims);setError("");}catch(cause){setError(cause instanceof Error?cause.message:"Falha ao consultar identidades.");}},[]);
  useEffect(()=>{void load();const timer=window.setInterval(()=>void load(),10_000);return()=>window.clearInterval(timer);},[load]);
  if(!items.length&&!error)return null;
  return <section className="owner-panel" aria-label="Associações Google pendentes"><h2>Acesso alternativo com Google · {items.length}</h2><p className="muted">Associe a identidade à conta existente. A aprovação não cria outra carteira nem substitui um Google já vinculado.</p>{error&&<p className="error" role="alert">{error}</p>}{items.map(item=><IdentityRequest key={item.id} item={item} onChange={load}/>)}</section>;
}
