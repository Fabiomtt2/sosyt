import { useEffect,useState } from "react";
import { ownerApi,type BotPasswordState } from "./api";
export function BotPasswordSettings(){
 const [data,setData]=useState<BotPasswordState>(),[busy,setBusy]=useState(false),[message,setMessage]=useState("");
 useEffect(()=>{void ownerApi.botPassword().then(setData).catch(e=>setMessage(e.message));},[]);
 if(!data)return <p role="status">{message||"Carregando acesso pelo bot…"}</p>;
 return <section className="owner-panel owner-bot-password"><h3>Senha de participante pelo bot</h3>
  <p className="muted">Após confirmar a identidade e ter o grupo aprovado, o bot pode gerar a senha automaticamente. A chave de cinco minutos e o Google continuam como alternativas. A senha atual nunca é substituída automaticamente.</p>
  <label className="journey-toggle"><input type="checkbox" checked={data.enabled} onChange={e=>setData({...data,enabled:e.target.checked})}/>Geração automática ativa</label>
  <div className="journey-settings-grid"><label>Modelo de mensagem aprovado na Meta<input value={data.templateName} onChange={e=>setData({...data,templateName:e.target.value})} placeholder="Nome do modelo, com um campo para a mensagem"/><small>É necessário fora de uma conversa WhatsApp recente comprovada.</small></label><label>Idioma do modelo<input value={data.templateLanguage} onChange={e=>setData({...data,templateLanguage:e.target.value})} placeholder="pt_BR"/></label></div>
  <p className="muted">A senha só nasce junto de um registro real na fila de envio. Sem chip, provedor validado ou modelo necessário, o sistema preserva o acesso por chave e a conta.</p>
  <button className="primary" disabled={busy} onClick={()=>{setBusy(true);setMessage("");void ownerApi.saveBotPassword({enabled:data.enabled,templateName:data.templateName,templateLanguage:data.templateLanguage}).then(value=>{setData(value);setMessage("Configuração do acesso automático salva.");}).catch(e=>setMessage(e.message)).finally(()=>setBusy(false));}}>{busy?"Salvando…":"Salvar acesso pelo bot"}</button>
  {message&&<p role="status">{message}</p>}
  <details className="journey-owner-history"><summary>Últimas senhas preparadas pelo servidor</summary><p>Aqui aparecem somente nome e situação de envio. Nenhuma senha é exibida no painel ou no correio.</p>{data.deliveries.map(d=><article key={d.userId}><strong>{d.name}</strong><span>{d.status}</span><small>{new Date(d.createdAt).toLocaleString("pt-BR")}</small></article>)}</details>
 </section>;
}
