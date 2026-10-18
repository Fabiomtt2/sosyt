import { LevelBadge } from "./GamificationPanel";
import { useCallback,useEffect,useState,useRef,type FormEvent } from "react";
import { Gift,Inbox,Package,Send,X } from "lucide-react";
import { api,type ChatSender,type MailMessage,type MailThread,type SuperState,type Dashboard } from "./api";
import { UserAvatarView } from "./AvatarModal";
import { useModalLifecycle } from "./useModalLifecycle";

export function CommunityModal({onClose,targetId,currentUserId,wallet,onChanged}:{onClose:()=>void;targetId?:string;currentUserId:string;wallet?:Dashboard["wallet"];onChanged?:()=>Promise<void>}){
 const [threads,setThreads]=useState<MailThread[]>([]),[items,setItems]=useState<Array<{itemCode:string;quantity:number}>>([]);
 const [subscription,setSubscription]=useState<SuperState>();
 const [selected,setSelected]=useState<string|undefined>(targetId),[who,setWho]=useState<ChatSender>();
 const [messages,setMessages]=useState<MailMessage[]>([]),[draft,setDraft]=useState("");
 const [busy,setBusy]=useState(false),[error,setError]=useState(""),[notice,setNotice]=useState("");
 const [rewardBalance,setRewardBalance]=useState(wallet?.reward??0);
 const [coinAmount,setCoinAmount]=useState(5);
 const [confirmCoins,setConfirmCoins]=useState<{to:string;name:string;coins:number;reference:string}>();
 const [confirmGift,setConfirmGift]=useState<{item:string;to:string;name:string}>();
 const giftReference=useRef<{item:string;to:string;id:string}|undefined>(undefined);
 const ref=useModalLifecycle(()=>{if(confirmGift)setConfirmGift(undefined);else if(confirmCoins)setConfirmCoins(undefined);else onClose();},true,!busy);
 const load=useCallback(async()=>{
  try{
   const [mail,inventory,superInfo,journey]=await Promise.all([api.mailInbox(),api.queuesMine(),api.superMe(),api.gamification()]);
   setThreads(mail.threads);setItems(inventory.inventory);setSubscription(superInfo);setRewardBalance(journey.progress?.rewardCoins ?? wallet?.reward ?? 0);
  }catch(cause){setError(cause instanceof Error?cause.message:"Não foi possível atualizar seus dados.");}
 },[wallet?.reward]);
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
 return <div className="modal-backdrop" onMouseDown={()=>{if(!busy&&!confirmGift&&!confirmCoins)onClose();}}>
  <section ref={ref} className="modal community-modal" role="dialog" aria-modal="true" aria-label="Mensagens e inventário" onMouseDown={e=>e.stopPropagation()}>
   <div className="community-sticky-head"><strong>{selected&&who?who.name:"Mensagens e inventário"}</strong><button className="close" aria-label="Fechar mensagens e inventário" disabled={busy} onClick={()=>{if(confirmGift)setConfirmGift(undefined);else if(confirmCoins)setConfirmCoins(undefined);else onClose();}}><X size={20}/></button></div>
   <div className="community-intro"><div><p className="eyebrow dark">SEU ESPAÇO NA COMUNIDADE</p><h2>Conversas que aproximam.</h2></div><img src={import.meta.env.BASE_URL+"assets/user/messages-editorial-v3.webp"} alt=""/></div>
   <p className="muted">Recados da equipe, conversas e presentes ficam juntos aqui.</p>
   <details className="inventory-panel" open={!selected}><summary><Package size={16}/><strong>Meu inventário</strong><span>{subscription?.active?"SUPER ativo":"Moedas, passes e Pular"}</span></summary>
   <section className="inventory-shelf" aria-label="Meu inventário">
    <div><Package size={20}/><strong>Meu inventário</strong></div>
    {wallet&&<><span><b>{wallet.total.toLocaleString("pt-BR",{maximumFractionDigits:3})}</b> moedas</span><span><b>{wallet.extraPasses}</b> passe{wallet.extraPasses===1?"":"s"}</span></>}
    {items.length?items.map(item=><span key={item.itemCode}><b>{item.quantity===Number.MAX_SAFE_INTEGER?"∞":item.quantity.toLocaleString("pt-BR")}</b> {item.itemCode==="SKIP"?"Pular":item.itemCode}</span>):<p>Você ainda não tem itens Pular. Suas compras confirmadas aparecem aqui.</p>}
    <span><b>{rewardBalance.toLocaleString("pt-BR")}</b> moedas de recompensa · para trocas e presentes</span>
    <small>Passe: contribuição extra na mesma fila, usando também 1 moeda. Pular: entrada em outra fila, mantendo a atual.</small>
    {subscription&&<p className="inventory-subscription">{subscription.active?"SUPER ativo":"SUPER não contratado"}{subscription.active&&subscription.expiresAt?" · até "+new Date(subscription.expiresAt).toLocaleDateString("pt-BR"):""}</p>}
   </section></details>
   <div className="community-columns">
    <nav aria-label="Conversas" className="community-threads"><h3><Inbox size={16}/> Mensagens</h3>
     {!threads.length&&<p className="muted">Toque no avatar de alguém no chat para iniciar uma conversa.</p>}
     {threads.map(t=><button key={t.key} type="button" disabled={busy||Boolean(confirmGift)||Boolean(confirmCoins)} aria-pressed={selected===(t.withId??"broadcast")} onClick={()=>{setSelected(t.withId??"broadcast");setError("");}}><div className="conversation-person"><UserAvatarView name={t.with?.name??"Equipe SOS YouTuber"} avatar={t.with?.avatar??undefined} presentation={t.with?.presentation}/>{t.with?.presentation?.progress&&<LevelBadge progress={t.with.presentation.progress} compact/>}<strong>{t.with?.name??"Equipe SOS YouTuber"}</strong></div><span>{t.lastBody}</span>{t.unread>0&&<b>{t.unread} nova{t.unread===1?"":"s"}</b>}</button>)}
    </nav>
    <section className="community-conversation" aria-label="Conversa selecionada">
     {selected?<><div className="conversation-person"><UserAvatarView name={who?.name??"Equipe SOS YouTuber"} avatar={who?.avatar??undefined} presentation={who?.presentation}/>{who?.presentation?.progress&&<LevelBadge progress={who.presentation.progress} compact/>}<strong>{selected==="broadcast"?"Avisos da equipe":who?.name??"Participante"}</strong></div>
      <div className="community-messages" aria-live="polite">{!messages.length&&<p className="muted">Comece com um olá. Seu recado fica salvo para a pessoa ler depois.</p>}{messages.map(m=><article key={m.id} className={(m.mine?"mine ":"")+((m.sender?.presentation?.progress?.level??1)>=30?"message-level30 ":"")+(m.sender?.presentation?.badge==="SUPER"?"message-super":m.sender?.presentation?.badge==="ADMIN"?"message-admin":"")}>{m.sender&&<div className="conversation-person"><UserAvatarView name={m.sender.name} avatar={m.sender.avatar??undefined} presentation={m.sender.presentation}/>{m.sender.presentation?.progress&&<LevelBadge progress={m.sender.presentation.progress} compact/>}<b>{m.sender.name}{m.sender.presentation?.badge&&<small className="conversation-badge">{m.sender.presentation.badge}</small>}</b></div>}<p>{m.body}</p><time>{new Date(m.createdAt).toLocaleString("pt-BR")}</time></article>)}</div>
      {selected!=="broadcast"&&selected!=="system"&&selected!==currentUserId&&<><form className="community-compose" onSubmit={send}><textarea aria-label="Seu recado" value={draft} onChange={e=>setDraft(e.target.value)} maxLength={2000} placeholder="Escreva uma mensagem gentil…"/><button className="primary compact" disabled={busy||!draft.trim()}><Send size={16}/>Enviar</button></form>
       {who&&who.id===selected&&items.length>0&&<div className="community-gifts"><span><Gift size={16}/> Presentear {who.name}</span>{items.map(item=><button className="secondary compact" key={item.itemCode} disabled={busy} onClick={()=>setConfirmGift({item:item.itemCode,to:who.id,name:who.name})}>1 {item.itemCode==="SKIP"?"Pular":item.itemCode}</button>)}</div>}
       {who&&who.id===selected&&<div className="community-coin-gift"><label>Moedas de recompensa para {who.name}<input aria-label="Moedas para presentear" type="number" min="1" max={Math.floor(rewardBalance)} value={coinAmount} onChange={e=>setCoinAmount(Number(e.target.value))}/></label><button type="button" className="secondary" disabled={busy||confirmCoins!==undefined||!Number.isInteger(coinAmount)||coinAmount<1||coinAmount>rewardBalance} onClick={()=>setConfirmCoins({to:who.id,name:who.name,coins:coinAmount,reference:crypto.randomUUID()})}>Presentear moedas</button></div>}
      </>}
     </>:<p className="community-empty">Escolha uma conversa ou encontre alguém no chat da comunidade.</p>}
    </section>
   </div>
   {confirmGift&&<div className="gift-confirm" role="group" aria-label="Confirmar presente"><strong>Enviar 1 {confirmGift.item==="SKIP"?"Pular":confirmGift.item} para {confirmGift.name}?</strong><p>{subscription?.source==="ROOT_OWNER"?"O item será concedido pela sua conta ADMIN.":"Esse item sai do seu inventário e entra na conta dessa pessoa."}</p><button className="secondary" disabled={busy} onClick={()=>setConfirmGift(undefined)}>Voltar</button><button className="primary" disabled={busy} onClick={()=>void gift()}>{busy?"Entregando…":"Confirmar presente"}</button></div>}
   {confirmCoins&&<div className="gift-confirm" role="group" aria-label="Confirmar presente de moedas"><strong>Enviar {confirmCoins.coins} moedas de recompensa para {confirmCoins.name}?</strong><p>Elas sairão do seu saldo de recompensa. Moedas compradas e receita não são alteradas.</p><button className="secondary" disabled={busy} onClick={()=>setConfirmCoins(undefined)}>Cancelar presente</button><button className="primary" disabled={busy} onClick={()=>{setBusy(true);setError("");void api.giftRewardCoins(confirmCoins.to,confirmCoins.coins,confirmCoins.reference).then(async()=>{setConfirmCoins(undefined);setNotice("Moedas de recompensa entregues!");await load();await onChanged?.();}).catch(e=>setError(e instanceof Error?e.message:"Não foi possível entregar.")).finally(()=>setBusy(false));}}>Confirmar moedas</button></div>}
   {notice&&<p role="status">{notice}</p>}{error&&<p className="error" role="alert">{error}</p>}
  </section>
 </div>;
}
