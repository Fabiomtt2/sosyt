import { useEffect,useState } from "react";
import { ownerApi,type GamificationBotData,type GamificationBotSettings } from "./api";
export function JourneyBotSettings(){
 const [data,setData]=useState<GamificationBotData>(),[draft,setDraft]=useState<GamificationBotSettings>(),[busy,setBusy]=useState(false),[message,setMessage]=useState("");
 useEffect(()=>{void ownerApi.gamificationBot().then(value=>{setData(value);setDraft(value.settings);}).catch(e=>setMessage(e.message));},[]);
 if(!data||!draft)return <p role="status">{message||"Carregando mensagens da jornada…"}</p>;
 return <details className="journey-owner-history"><summary>Bot · mensagens da jornada e entregas</summary>
  <p>Os avisos de nível, Booster, ranking, trocas e presentes estão ligados aos eventos reais. Sem conexão WhatsApp, os avisos internos continuam disponíveis no correio.</p>
  <label className="journey-toggle"><input type="checkbox" checked={draft.enabled} onChange={e=>setDraft({...draft,enabled:e.target.checked})}/>Avisos da jornada ativos</label>
  <div className="journey-settings-grid">{data.catalog.map(meta=>{
   const event=draft.events[meta.event];
   const change=(patch:Partial<typeof event>)=>setDraft({...draft,events:{...draft.events,[meta.event]:{...event,...patch}}});
   return <fieldset key={meta.event}><legend>{meta.label}</legend>
    <label className="journey-toggle"><input type="checkbox" checked={event.enabled} onChange={e=>change({enabled:e.target.checked})}/>Ativar este aviso</label>
    <label className="journey-toggle"><input type="checkbox" checked={event.internalEnabled} onChange={e=>change({internalEnabled:e.target.checked})}/>Enviar no correio do SOS</label>
    <label className="journey-toggle"><input type="checkbox" checked={event.whatsappEnabled} onChange={e=>change({whatsappEnabled:e.target.checked})}/>Também pelo WhatsApp</label>
    <label>Mensagem acolhedora<textarea value={event.text} maxLength={2000} onChange={e=>change({text:e.target.value})}/></label>
    <small>Campos disponíveis: {meta.placeholders.map(p=>"{"+p+"}").join(" · ")}</small>
    <label>Modelo aprovado na Meta<input value={event.templateName} onChange={e=>change({templateName:e.target.value})} placeholder="Opcional enquanto há conversa recente"/></label>
    <p>Fora de uma conversa recente comprovada, a Meta precisa de um modelo aprovado com um campo para o texto. O cadastro do modelo acontece na Meta.</p>
   </fieldset>;
  })}</div>
  <button className="primary" disabled={busy} onClick={()=>{setBusy(true);setMessage("");void ownerApi.saveGamificationBot(draft).then(value=>{setData(value);setDraft(value.settings);setMessage("Mensagens salvas. Entregas pendentes serão revisadas pelo servidor.");}).catch(e=>setMessage(e.message)).finally(()=>setBusy(false));}}>{busy?"Salvando…":"Salvar mensagens da jornada"}</button>
  {message&&<p role="status">{message}</p>}
  <h3>Entregas recentes</h3><p>Pendente aguarda conexão ou modelo. Na fila ainda não é enviado. Enviado significa aceito pelo provedor; não significa lido pelo participante.</p>
  {data.deliveries.slice(0,20).map(d=><article key={d.eventId}><strong>{d.name}</strong><span>{d.event} · {d.status}{d.reason?" · "+d.reason:""}</span><small>{new Date(d.createdAt).toLocaleString("pt-BR")}</small></article>)}
 </details>;
}
