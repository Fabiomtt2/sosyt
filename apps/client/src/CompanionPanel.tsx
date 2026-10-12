import { useEffect,useState } from "react";
import { Monitor,Unplug } from "lucide-react";
import { api,type CompanionDevice } from "./api";

export function CompanionPanel(){
 const [open,setOpen]=useState(false),[consent,setConsent]=useState(false),[busy,setBusy]=useState(false);
 const [devices,setDevices]=useState<CompanionDevice[]>([]),[error,setError]=useState("");
 const [pairing,setPairing]=useState<{code:string;apiUrl:string;expires:number}>();
 const [now,setNow]=useState(Date.now());
 useEffect(()=>{
  if(!open)return;
  let alive=true;
  const refresh=()=>void api.companionDevices().then(result=>{if(alive)setDevices(result.devices);}).catch(reason=>{if(alive)setError(reason.message);});
  refresh();
  const poll=window.setInterval(refresh,5000),clock=window.setInterval(()=>setNow(Date.now()),1000);
  return()=>{alive=false;window.clearInterval(poll);window.clearInterval(clock);};
 },[open]);
 async function connect(){
  if(!consent)return;
  setBusy(true);setError("");
  try{
   const result=await api.companionPairing();
   setPairing({code:result.pairingCode,apiUrl:result.apiUrl,expires:Date.now()+result.expiresInSeconds*1000});
  }catch(reason){setError(reason instanceof Error?reason.message:"Não foi possível gerar o código.");}
  finally{setBusy(false);}
 }
 async function revoke(id:string){
  setBusy(true);setError("");
  try{await api.companionRevoke(id);setDevices((await api.companionDevices()).devices);}
  catch(reason){setError(reason instanceof Error?reason.message:"Não foi possível desconectar.");}
  finally{setBusy(false);}
 }
 const remaining=Math.max(0,Math.ceil(((pairing?.expires??0)-now)/1000));
 return <details className="companion-panel" onToggle={event=>setOpen(event.currentTarget.open)}>
  <summary><Monitor size={18}/> Acompanhamento opcional no computador</summary>
  {open&&<div className="companion-content">
   <p>O aplicativo Python observa somente a região do contador que você selecionar. As imagens ficam no seu computador; apenas tempos e estado da leitura chegam ao SOS.</p>
   <p>Ele complementa o player, sem comprovar atenção humana nem conceder moedas sozinho. Mantenha esta página visível enquanto acompanha os vídeos.</p>
   <div className="companion-downloads">
    <a className="secondary" href={import.meta.env.BASE_URL+"downloads/sos-companion.py"} download>Baixar aplicativo Python</a>
    <a href={import.meta.env.BASE_URL+"downloads/companion-instrucoes.txt"} download>Instruções de instalação</a>
   </div>
   <small>Uso em computador com Python, Pillow e Tesseract instalados. O download não inicia nenhuma captura.</small>
   <label className="companion-consent"><input type="checkbox" checked={consent} onChange={event=>setConsent(event.target.checked)}/><span>Quero autorizar a conexão de um computador. Posso revogar abaixo a qualquer momento.</span></label>
   <button className="secondary" disabled={!consent||busy} onClick={()=>void connect()}>{busy?"Aguarde…":"Gerar código de conexão"}</button>
   {pairing&&<div className="companion-pairing" role="status">
    <span>{remaining>0?"Digite este código no aplicativo Python:":"Código expirado. Gere outro para conectar."}</span>
    {remaining>0&&<><strong>{pairing.code}</strong><small>Expira em {Math.floor(remaining/60)}:{String(remaining%60).padStart(2,"0")} · uso único · não compartilhe.</small></>}
    <label>Endereço do servidor<input aria-label="Servidor do companion" readOnly value={pairing.apiUrl} onFocus={event=>event.currentTarget.select()}/></label>
   </div>}
   {error&&<p className="error" role="alert">{error}</p>}
   {devices.length>0&&<ul className="companion-devices" aria-label="Computadores conectados">{devices.map(device=>{
    const recent=Boolean(device.lastSeenAt&&now-Date.parse(device.lastSeenAt)<20000);
    const status=!device.authorized?"Desconectado":!recent?"Aguardando aplicativo":device.signal==="STOPPED"?"Observação parada":device.signal==="UNREADABLE"?"Contador não reconhecido":device.playerMatches?"Contador compatível com o player":"Sem correspondência confirmada";
    return <li key={device.id}><div><strong>{device.label}</strong><small>{status}</small></div>{Boolean(device.authorized)&&<button className="secondary" aria-label={"Desconectar "+device.label} disabled={busy} onClick={()=>void revoke(device.id)}><Unplug size={16}/> Desconectar</button>}</li>;
   })}</ul>}
  </div>}
 </details>;
}
