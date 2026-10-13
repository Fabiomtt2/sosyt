import { useCallback,useEffect,useState,useRef,type FormEvent } from "react";
import { Gift,Inbox,Package,Send,X } from "lucide-react";
import { api,type ChatSender,type MailMessage,type MailThread,type SuperState } from "./api";
import { UserAvatarView } from "./AvatarModal";
import { useModalLifecycle } from "./useModalLifecycle";

export function CommunityModal({onClose,targetId,currentUserId}:{onClose:()=>void;targetId?:string;currentUserId:string}){
 const [threads,setThreads]=useState<MailThread[]>([]),[items,setItems]=useState<Array<{itemCode:string;quantity:number}>>([]);
 const [subscription,setSubscription]=useState<SuperState>();
 const [selected,setSelected]=useState<string|undefined>(targetId),[who,setWho]=useState<ChatSender>();
 const [messages,setMessages]=useState<MailMessage[]>([]),[draft,setDraft]=useState("");
 const [busy,setBusy]=useState(false),[error,setError]=useState(""),[notice,setNotice]=useState("");
 const [confirmGift,setConfirmGift]=useState<{item:string;to:string;name:string}>();
 const giftReference=useRef<{item:string;to:string;id:string}|undefined>(undefined);
 const ref=useModalLifecycle(()=>{if(confirmGift)setConfirmGift(undefined);else onClose();},true,!busy);
 const load=useCallback(async()=>{
  try{
   const [mail,inventory,superInfo]=await Promise.all([api.mailInbox(),api.queuesMine(),api.superMe()]);
   setThreads(mail.threads);setItems(inventory.inventory);setSubscription(superInfo);
  }catch(cause){setError(cause instanceof Error?cause.message:"Não foi possível atualizar seus dados.");}
 },[]);
 useEffect(()=>{void load();const timer=setInterval(()=>void load(),10000);return()=>clearInterval(timer);},[load]);
 useEffect(()=>{
  if(!selected){setMessages([]);return;}
  setMessages([]);
  let active=true;
  async function update(){
   try{
    const result=await api.mailThread(selected!);
    if(active)setMessages(result.messages);
   }catch(cause){if(active)setError(cause instanceof Error?cause.message:"Não foi possível abrir a conversa.");}
  }
  void update();const timer=setInterval(()=>void update(),5000);
  return()=>{active=false;clearInterval(timer);};
 },[selected]);
 useEffect(()=>{
  if(!selected||selected==="broadcast"){setWho(undefined);return;}
  const existing=threads.find(t=>t.withId===selected)?.with;
  if(existing){setWho(existing);return;}
  let active=true;
  void api.chatList().then(chat=>{if(active)setWho(chat.messages.find(m=>m.sender.id===selected)?.sender);}).catch(()=>{if(active)setWho(undefined);});
  return()=>{active=false;};
 },[selected,threads]);
 async function send(event:FormEvent){
  event.preventDefault();if(!selected||!draft.trim()||busy)return;
  setBusy(true);setError("");
  try{await api.mailSend(selected,draft.trim());setDraft("");setMessages((await api.mailThread(selected)).messages);await load();}
  catch(cause){setError(cause instanceof Error?cause.message:"Não foi possível enviar.");}
  finally{setBusy(false);}
 }
 async function gift(){
  if(!confirmGift||busy)return;
  setBusy(true);setError("");setNotice("");
  try{
    if(!giftReference.current||giftReference.current.item!==confirmGift.item||giftReference.current.to!==confirmGift.to)giftReference.current={item:confirmGift.item,to:confirmGift.to,id:crypto.randomUUID()};
    await api.giftItem(confirmGift.to,confirmGift.item,1,giftReference.current.id);giftReference.current=undefined;setConfirmGift(undefined);setNotice("Presente entregue! Seu inventário foi atualizado.");await load();}
  catch(cause){setError(cause instanceof Error?cause.message:"Não foi possível entregar o presente.");}
  finally{setBusy(false);}
 }
 return <div className="modal-backdrop" onMouseDown={()=>{if(!busy&&!confirmGift)onClose();}}>
  <section ref={ref} className="modal community-modal" role="dialog" aria-modal="true" aria-label="Mensagens e inventário" onMouseDown={e=>e.stopPropagation()}>
   <button className="close" aria-label="Fechar mensagens e inventário" disabled={busy} onClick={onClose}><X size={20}/></button>
   <div className="community-intro"><div><p className="eyebrow dark">SEU ESPAÇO NA COMUNIDADE</p><h2>Conversas que aproximam.</h2></div><img src={import.meta.env.BASE_URL+"assets/user/messages-editorial-v3.webp"} alt=""/></div>
   <p className="muted">Recados da equipe, conversas e presentes ficam juntos aqui.</p>
   <section className="inventory-shelf" aria-label="Meu inventário">
    <div><Package size={20}/><strong>Meu inventário</strong></div>
    {items.length?items.map(item=><span key={item.itemCode}><b>{item.quantity===Number.MAX_SAFE_INTEGER?"∞":item.quantity.toLocaleString("pt-BR")}</b> {item.itemCode==="SKIP"?"Pular":item.itemCode}</span>):<p>Você ainda não tem itens. As compras confirmadas aparecem aqui.</p>}
    <small>Pular permite participar de outra fila, mantendo a atual.</small>
    {subscription&&<p className="inventory-subscription">{subscription.active?"SUPER ativo":"SUPER não contratado"}{subscription.active&&subscription.expiresAt?" · até "+new Date(subscription.expiresAt).toLocaleDateString("pt-BR"):""}</p>}
   </section>
   <div className="community-columns">
    <nav aria-label="Conversas" className="community-threads"><h3><Inbox size={16}/> Mensagens</h3>
     {!threads.length&&<p className="muted">Toque no avatar de alguém no chat para iniciar uma conversa.</p>}
     {threads.map(t=><button key={t.key} type="button" disabled={busy||Boolean(confirmGift)} aria-pressed={selected===(t.withId??"broadcast")} onClick={()=>{setSelected(t.withId??"broadcast");setError("");}}><strong>{t.with?.name??"Equipe SOS YouTuber"}</strong><span>{t.lastBody}</span>{t.unread>0&&<b>{t.unread} nova{t.unread===1?"":"s"}</b>}</button>)}
    </nav>
    <section className="community-conversation" aria-label="Conversa selecionada">
     {selected?<><div className="conversation-person"><UserAvatarView name={who?.name??"Equipe SOS YouTuber"} avatar={who?.avatar??undefined}/><strong>{selected==="broadcast"?"Avisos da equipe":who?.name??"Participante"}</strong></div>
      <div className="community-messages" aria-live="polite">{!messages.length&&<p className="muted">Comece com um olá. Seu recado fica salvo para a pessoa ler depois.</p>}{messages.map(m=><article key={m.id} className={m.mine?"mine":""}>{m.role==="OWNER"&&m.sender&&<div className="conversation-person"><UserAvatarView name={m.sender.name} avatar={m.sender.avatar??undefined}/><b>{m.sender.name} · Owner</b></div>}<p>{m.body}</p><time>{new Date(m.createdAt).toLocaleString("pt-BR")}</time></article>)}</div>
      {selected!=="broadcast"&&selected!==currentUserId&&<><form className="community-compose" onSubmit={send}><textarea aria-label="Seu recado" value={draft} onChange={e=>setDraft(e.target.value)} maxLength={2000} placeholder="Escreva uma mensagem gentil…"/><button className="primary compact" disabled={busy||!draft.trim()}><Send size={16}/>Enviar</button></form>
       {who&&who.id===selected&&items.length>0&&<div className="community-gifts"><span><Gift size={16}/> Presentear {who.name}</span>{items.map(item=><button className="secondary compact" key={item.itemCode} disabled={busy} onClick={()=>setConfirmGift({item:item.itemCode,to:who.id,name:who.name})}>1 {item.itemCode==="SKIP"?"Pular":item.itemCode}</button>)}</div>}
      </>}
     </>:<p className="community-empty">Escolha uma conversa ou encontre alguém no chat da comunidade.</p>}
    </section>
   </div>
   {confirmGift&&<div className="gift-confirm" role="group" aria-label="Confirmar presente"><strong>Enviar 1 {confirmGift.item==="SKIP"?"Pular":confirmGift.item} para {confirmGift.name}?</strong><p>{subscription?.source==="ROOT_OWNER"?"O item será concedido pela sua conta Owner.":"Esse item sai do seu inventário e entra na conta dessa pessoa."}</p><button className="secondary" disabled={busy} onClick={()=>setConfirmGift(undefined)}>Voltar</button><button className="primary" disabled={busy} onClick={()=>void gift()}>{busy?"Entregando…":"Confirmar presente"}</button></div>}
   {notice&&<p role="status">{notice}</p>}{error&&<p className="error" role="alert">{error}</p>}
  </section>
 </div>;
}
