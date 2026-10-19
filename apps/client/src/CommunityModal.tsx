import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowLeft, ArrowUpRight, Bell, Check, CheckCheck, Gift, Inbox, MessageCircle, Package, Search, Send, UserCheck, UserPlus, Users, X, ShieldBan, UserMinus } from "lucide-react";
import { api, type ChatSender, type Dashboard, type MailMessage, type MailThread, type SuperState } from "./api";
import { UserAvatarView } from "./AvatarModal";
import { LevelBadge } from "./GamificationPanel";
import { InventoryOverview } from "./UserWallet";
import { useModalLifecycle } from "./useModalLifecycle";
import "./community-social.css";
import "./friends-controls.css";

type SocialOverview = Awaited<ReturnType<typeof api.socialOverview>>;
type PublicProfile = Awaited<ReturnType<typeof api.socialProfile>>;
type Notifications = Awaited<ReturnType<typeof api.socialNotifications>>;
type MessageRequests = Awaited<ReturnType<typeof api.socialMessageRequests>>;
export type CommunityTab = "messages" | "friends" | "notifications" | "inventory";
type GiftConfirmation =
  | { kind: "coins"; to: string; name: string; coins: number; reference: string }
  | { kind: "item"; to: string; name: string; item: string; reference: string };
const number = (value: number) => value === Number.MAX_SAFE_INTEGER ? "∞" : value.toLocaleString("pt-BR", { maximumFractionDigits: 3 });
const stamp = (value: string) => new Date(value).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
const itemName = (code: string) => code === "SKIP" ? "Pular" : code === "PASS" ? "Passe" : code;
export const notifyCommunityChanged = () => window.dispatchEvent(new Event("sos-community-updated"));

function Person({ user, onClick, compact = false }: { user: ChatSender; onClick?: () => void; compact?: boolean }) {
  const body = <><UserAvatarView name={user.name} avatar={user.avatar ?? undefined} presentation={user.presentation}/><span className="social-person-copy">
    <strong>{user.name}</strong><span>{user.presentation?.badge === "ADMIN" ? "ADMIN" : user.groupCode && user.groupCode !== "#" ? "SOS YouTuber " + user.groupCode : "Comunidade"}
      {user.presentation?.badge === "SUPER" && <b className="social-super-label">SUPER</b>}</span>
    {!compact && user.presentation?.progress && <LevelBadge progress={user.presentation.progress} compact/>}
  </span></>;
  return onClick ? <button type="button" className="social-person is-action" onClick={onClick}>{body}<ArrowUpRight size={16}/></button> : <div className="social-person">{body}</div>;
}
function notificationText(notification: Notifications["notifications"][number]) {
  const name = notification.actor?.name ?? "A comunidade";
  if (notification.kind === "MESSAGE_REQUEST") return name + " pediu permissão para conversar com você.";
  if (notification.kind === "MESSAGE_ACCEPTED") return name + " aceitou conversar com você.";
  if (notification.kind === "FRIEND_REQUEST") return name + " quer fazer parte dos seus amigos.";
  if (notification.kind === "FRIEND_ACCEPTED") return name + " aceitou seu convite de amizade.";
  if (notification.kind === "COINS_RECEIVED") return name + " enviou moedas para você.";
  if (notification.kind === "ITEM_RECEIVED") return name + " enviou um presente para você.";
  return typeof notification.payload.message === "string" ? notification.payload.message : "Você tem uma novidade na comunidade.";
}

export function CommunityModal({ onClose, targetId, currentUserId, wallet, onChanged, initialTab = "messages" }: {
  onClose: () => void; targetId?: string; currentUserId: string; wallet?: Dashboard["wallet"]; onChanged?: () => Promise<void>; initialTab?: CommunityTab;
}) {
  const [tab, setTab] = useState<CommunityTab>(initialTab);
  const [threads, setThreads] = useState<MailThread[]>([]);
  const [items, setItems] = useState<Array<{ itemCode: string; quantity: number }>>([]);
  const [subscription, setSubscription] = useState<SuperState>();
  const [inventoryCounts, setInventoryCounts] = useState<{skipsAvailable:number;passesAvailable:number}>();
  const [social, setSocial] = useState<SocialOverview>();
  const [notifications, setNotifications] = useState<Notifications>();
  const [messageRequests, setMessageRequests] = useState<MessageRequests>();
  const [selected, setSelected] = useState<string | undefined>(targetId);
  const [profile, setProfile] = useState<PublicProfile>();
  const [messages, setMessages] = useState<MailMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [phone, setPhone] = useState("");
  const [found, setFound] = useState<PublicProfile>();
  const [busy, setBusy] = useState(false), [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(""), [notice, setNotice] = useState("");
  const [coinAmount, setCoinAmount] = useState(5);
  const [giftOpen, setGiftOpen] = useState(false);
  const [confirmation, setConfirmation] = useState<GiftConfirmation>();
  const [inviteFriend, setInviteFriend] = useState<{ id:string; name:string }>();
  const [blockPerson, setBlockPerson] = useState<{ id:string; name:string }>();
  const [removeFriend, setRemoveFriend] = useState<{ id: string; name: string }>();
  const messageEnd = useRef<HTMLDivElement>(null);
  const confirmationRef = useRef<HTMLElement>(null);
  const scrollToEnd = useRef(true);
  const actionReferences = useRef(new Map<string, string>());
  const inFlight = useRef(false);
  const isRoot = subscription?.source === "ROOT_OWNER";
  const transferable = social?.transferableCoins ?? (wallet ? wallet.purchased + wallet.reward : 0);
  const interactionBlocked = Boolean(profile?.interactionBlocked || profile?.relationship.status === "BLOCKED" || social?.blocked?.some(person=>person.userId===selected));
  const blockedByMe = Boolean(profile?.blockedByMe || profile?.relationship.blockedByMe || social?.blocked?.some(person=>person.userId===selected));
  const canInteract = selected && Boolean(profile?.user) && !interactionBlocked && !["broadcast", "system", currentUserId].includes(selected);
  const acceptedConversation = messageRequests?.requests.some(request => request.status === "ACCEPTED" && (request.senderId === selected || request.recipientId === selected));
  const pendingConversation = messageRequests?.requests.find(request => request.status === "PENDING" && (request.senderId === selected || request.recipientId === selected));
  const incomingConversations = messageRequests?.requests.filter(request => request.incoming && request.status === "PENDING") ?? [];
  const canMessage = canInteract && (profile?.relationship.status === "FRIEND" || acceptedConversation);
  const requestCost = social?.friendshipRequestCost ?? 1;
  const visibleThreads = threads.filter(thread=>!social?.blocked?.some(person=>person.userId===thread.withId));
  const who = profile?.user ?? (!interactionBlocked ? threads.find(thread => thread.withId === selected)?.with : undefined);
  const activeFriend = social?.friends.find(friend => friend.user?.id === selected);
  useEffect(()=>{if(interactionBlocked){setGiftOpen(false);setConfirmation(undefined);setInviteFriend(undefined);}},[interactionBlocked]);
  const close = () => {
    if (busy) return;
    if (inviteFriend) setInviteFriend(undefined);
    else if (blockPerson) setBlockPerson(undefined);
    else if (confirmation) setConfirmation(undefined);
    else if (removeFriend) setRemoveFriend(undefined);
    else onClose();
  };
  const ref = useModalLifecycle(close, true, !busy);
  useEffect(() => {
    if (confirmation || removeFriend || inviteFriend || blockPerson) {
      const frame = requestAnimationFrame(() => confirmationRef.current?.querySelector<HTMLButtonElement>("button")?.focus());
      return () => cancelAnimationFrame(frame);
    }
  }, [confirmation, removeFriend, inviteFriend, blockPerson]);
  const load = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const [mail, inventory, superInfo, friendships, updates, requests] = await Promise.all([
        api.mailInbox(), api.queuesMine(), api.superMe(), api.socialOverview(), api.socialNotifications(), api.socialMessageRequests()
      ]);
      setThreads(mail.threads); setItems(inventory.inventory); setInventoryCounts({skipsAvailable:inventory.skipsAvailable,passesAvailable:inventory.passesAvailable}); setSubscription(superInfo);
      setSocial(friendships); setNotifications(updates); setMessageRequests(requests); setLoaded(true);
      notifyCommunityChanged();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Não conseguimos atualizar sua comunidade. Tente novamente."); }
    finally { inFlight.current = false; }
  }, []);
  const loadProfile = useCallback(async (id: string) => {
    if (["broadcast", "system"].includes(id)) { setProfile(undefined); return; }
    setProfile(await api.socialProfile(id));
  }, []);
  useEffect(() => { void load(); const timer = setInterval(() => { if (!document.hidden) void load(); }, 5000); return () => clearInterval(timer); }, [load]);
  useEffect(() => { if (targetId) { setSelected(targetId); setTab("messages"); } }, [targetId]);
  useEffect(() => {
    if (!selected) { setMessages([]); setProfile(undefined); return; }
    setMessages([]); setProfile(undefined); setGiftOpen(false); scrollToEnd.current = true;
    let active = true;
    const update = async () => {
      try {
        const [threadState,profileState] = await Promise.allSettled([api.mailThread(selected),["broadcast","system"].includes(selected)?Promise.resolve(undefined):api.socialProfile(selected)]);
        if (!active) return;
        if(profileState.status==="fulfilled")setProfile(profileState.value);
        if(threadState.status==="fulfilled"){setMessages(threadState.value.messages);notifyCommunityChanged();}
        else if(profileState.status!=="fulfilled" || !profileState.value?.interactionBlocked)throw threadState.reason;
      } catch (cause) { if (active) setError(cause instanceof Error ? cause.message : "Não conseguimos abrir esta conversa."); }
    };
    void update();
    const timer = setInterval(() => { if (!document.hidden) void update(); }, 5000);
    return () => { active = false; clearInterval(timer); };
  }, [selected]);
  useEffect(() => {
    if (scrollToEnd.current) messageEnd.current?.scrollIntoView({ block: "end", behavior: "auto" });
  }, [messages]);
  function choose(id: string) { setSelected(id); setTab("messages"); setError(""); setNotice(""); }
  function chooseTab(value: CommunityTab) { setTab(value); setError(""); setNotice(""); }
  async function action(run: () => Promise<unknown>, success: string) {
    if (busy) return;
    setBusy(true); setError(""); setNotice("");
    try {
      await run(); setNotice(success); await load();
      if (selected) await loadProfile(selected);
      if (found?.user) setFound(await api.socialProfile(found.user.id));
      notifyCommunityChanged();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Não conseguimos concluir. Seus dados continuam salvos."); }
    finally { setBusy(false); }
  }
  function reference(key: string) {
    if (!actionReferences.current.has(key)) actionReferences.current.set(key, crypto.randomUUID());
    return actionReferences.current.get(key)!;
  }
  async function requestFriend(id: string) {
    await action(async () => { await api.socialRequest(id, reference("friend:" + id)); actionReferences.current.delete("friend:" + id); setInviteFriend(undefined); await onChanged?.(); }, "Convite enviado. A pessoa poderá aceitar quando quiser.");
  }
  async function block(id:string, blocked:boolean) {
    await action(async()=>{await api.socialBlock(id,blocked);setBlockPerson(undefined);setGiftOpen(false);setConfirmation(undefined);},blocked?"Bloqueio aplicado. As interações entre vocês foram interrompidas.":"Pessoa desbloqueada. A amizade anterior não é restaurada automaticamente.");
  }
  async function respond(id: string, value: "ACCEPT" | "DECLINE" | "CANCEL" | "REMOVE") {
    await action(() => api.socialRespond(id, value), value === "ACCEPT" ? "Amizade confirmada! Que venham boas conversas." : value === "REMOVE" ? "Amizade removida. As conversas anteriores continuam salvas." : "Convite atualizado.");
    setRemoveFriend(undefined);
  }
  async function send(event: FormEvent) {
    event.preventDefault();
    if (!canMessage || !selected || !draft.trim() || busy) return;
    await action(async () => {
      await api.mailSend(selected, draft.trim()); setDraft("");
      scrollToEnd.current = true; setMessages((await api.mailThread(selected)).messages);
    }, "");
  }
  async function find(event: FormEvent) {
    event.preventDefault(); setFound(undefined);
    await action(async () => { const result = await api.socialFind(phone.trim()); setFound({ ...result, acceptsRequests: true, enabled: true }); }, "");
  }
  async function give() {
    if (!confirmation) return;
    const gift = confirmation;
    await action(async () => {
      if (gift.kind === "coins") await api.giftCoins(gift.to, gift.coins, gift.reference);
      else await api.giftItem(gift.to, gift.item, 1, gift.reference);
      setConfirmation(undefined); await onChanged?.();
    }, gift.kind === "coins" ? "Moedas entregues! O saldo já está atualizado." : "Presente entregue! Seu inventário já está atualizado.");
  }
  async function readNotifications() {
    const ids = notifications?.notifications.filter(item => !item.readAt).map(item => item.id) ?? [];
    if (ids.length) await action(() => api.socialRead(ids), "Notificações marcadas como lidas.");
  }
  const friendActions = (person: PublicProfile, location = "profile") => {
    if (!person.user || person.user.id === currentUserId || person.interactionBlocked || person.relationship.status === "BLOCKED") return null;
    const relation = person.relationship;
    if (relation.status === "FRIEND") return <span className="social-friend-state"><UserCheck size={16}/> Vocês são amigos</span>;
    if (relation.status === "REQUEST_SENT") return <button type="button" className="social-quiet-button" disabled={busy} onClick={() => relation.invitationId && void respond(relation.invitationId, "CANCEL")}>Convite enviado · cancelar</button>;
    if (relation.status === "REQUEST_RECEIVED") return <div className="social-inline-actions"><button type="button" className="primary compact" disabled={busy || !social?.enabled} onClick={() => relation.invitationId && void respond(relation.invitationId, "ACCEPT")}><Check size={16}/> Aceitar amizade</button><button type="button" className="secondary compact" disabled={busy} onClick={() => relation.invitationId && void respond(relation.invitationId, "DECLINE")}>Agora não</button></div>;
    if (relation.status === "DISABLED" || !person.acceptsRequests || !social?.enabled) return <span className="social-friend-state">Convites indisponíveis no momento.</span>;
    return <button type="button" className={location === "search" ? "primary compact" : "social-quiet-button"} disabled={busy} onClick={() => setInviteFriend({id:person.user!.id,name:person.user!.name})}><UserPlus size={16}/> Adicionar · {requestCost} moeda</button>;
  };

  return <div className="modal-backdrop social-backdrop" onMouseDown={() => { if (!confirmation && !removeFriend && !inviteFriend && !blockPerson) close(); }}>
    <section ref={ref} className="modal community-modal social-hub" role="dialog" aria-modal="true" aria-label="Mensagens e inventário" onMouseDown={event => event.stopPropagation()}>
      <header className="social-hub-header">
        <div><span className="social-eyebrow">SUA COMUNIDADE</span><h2>Um lugar para se aproximar.</h2><p>Conversas, amizades e pequenos gestos que fazem a diferença.</p></div>
        <img src={import.meta.env.BASE_URL + "assets/user/messages-editorial-v3.webp"} alt=""/>
        <button type="button" className="social-close" aria-label="Fechar mensagens e inventário" disabled={busy} onClick={close}><X size={21}/></button>
      </header>
      <nav className="social-hub-tabs" aria-label="Seu espaço na comunidade">
        <button type="button" aria-current={tab === "messages" ? "page" : undefined} onClick={() => chooseTab("messages")}><Inbox size={18}/><span>Conversas</span>{(threads.some(thread => thread.unread > 0) || incomingConversations.length > 0) && <i aria-label="Há mensagens não lidas"/>}</button>
        <button type="button" aria-current={tab === "friends" ? "page" : undefined} onClick={() => chooseTab("friends")}><Users size={18}/><span>Amigos</span>{Boolean(social?.incoming.length) && <b>{social!.incoming.length}</b>}</button>
        <button type="button" aria-current={tab === "notifications" ? "page" : undefined} onClick={() => chooseTab("notifications")}><Bell size={18}/><span>Novidades</span>{Boolean(notifications?.unread) && <b>{notifications!.unread > 99 ? "99+" : notifications!.unread}</b>}</button>
        <button type="button" aria-current={tab === "inventory" ? "page" : undefined} onClick={() => chooseTab("inventory")}><Package size={18}/><span>Inventário</span></button>
      </nav>
      <div className="social-hub-content" aria-busy={!loaded}>
        {!loaded && !error && <div className="social-loading" role="status"><span/> Estamos preparando seu espaço…</div>}
        {tab === "inventory" && <div className="social-inventory-page">{wallet && <InventoryOverview wallet={wallet} skipsAvailable={inventoryCounts?.skipsAvailable} passesAvailable={inventoryCounts?.passesAvailable} subscription={subscription}/>}<p className="social-help">Você pode presentear alguém abrindo uma conversa e escolhendo <strong>Enviar um presente</strong>.</p></div>}
        {tab === "messages" && <div className={"social-messenger" + (selected ? " has-selection" : "")}>
          <aside className="social-sidebar" aria-label="Conversas e amigos">
            <div className="social-section-heading"><h3>Suas conversas</h3><span>{visibleThreads.length}</span></div>
            {visibleThreads.length === 0 && <p className="social-help">Seu primeiro olá pode começar pelo avatar de alguém no chat.</p>}
            {incomingConversations.length > 0 && <section className="social-message-requests" aria-label="Pedidos de conversa"><h3>Querem conversar com você</h3>{incomingConversations.map(request => <article key={request.id}>{request.user && <Person user={request.user} compact onClick={() => choose(request.user!.id)}/>}<div className="social-inline-actions"><button type="button" className="primary compact" disabled={busy} onClick={() => void action(() => api.socialMessageRespond(request.id, true), "Conversa aceita. Vocês já podem trocar mensagens.")}>Aceitar conversa</button><button type="button" className="secondary compact" disabled={busy} onClick={() => void action(() => api.socialMessageRespond(request.id, false), "Pedido de conversa recusado.")}>Recusar</button></div></article>)}</section>}
            <div className="social-thread-list">{visibleThreads.map(thread => <button key={thread.key} type="button" className="social-thread" aria-pressed={selected === (thread.withId ?? "broadcast")} disabled={busy || Boolean(confirmation || removeFriend || inviteFriend || blockPerson)} onClick={() => choose(thread.withId ?? "broadcast")}>
              <UserAvatarView name={thread.with?.name ?? "Equipe SOS YouTuber"} avatar={thread.with?.avatar ?? undefined} presentation={thread.with?.presentation}/>
              <span><strong>{thread.with?.name ?? "Equipe SOS YouTuber"}</strong><small>{thread.lastBody}</small></span>{thread.unread > 0 && <b aria-label={thread.unread + " mensagens não lidas"}>{thread.unread > 99 ? "99+" : thread.unread}</b>}
            </button>)}</div>
            <div className="social-section-heading"><h3>Amigos</h3><button type="button" aria-label="Encontrar amigos" onClick={() => chooseTab("friends")}><UserPlus size={17}/></button></div>
            {social?.friends.length ? social.friends.map(friend => friend.user && <Person key={friend.id} user={friend.user} compact onClick={() => choose(friend.user!.id)}/>) : <p className="social-help">Seus amigos ficam por perto aqui.</p>}
            {Boolean(social?.incoming.length) && <button type="button" className="social-pending-link" onClick={() => chooseTab("friends")}><UserPlus size={17}/>{social!.incoming.length} convite{social!.incoming.length === 1 ? "" : "s"} de amizade</button>}
          </aside>
          <section className="social-conversation" aria-label="Conversa selecionada">
            {selected ? <>
              <header className="social-conversation-heading"><button type="button" className="social-mobile-back" aria-label="Voltar às conversas" onClick={() => setSelected(undefined)}><ArrowLeft size={20}/></button>
                {who && !interactionBlocked ? <Person user={who} compact/> : <div className="social-system-title"><MessageCircle size={23}/><strong>{selected === "broadcast" ? "Avisos da equipe" : selected === "system" ? "Suas conquistas" : "Participante"}</strong></div>}
                {canInteract && <button type="button" className="social-gift-toggle" aria-expanded={giftOpen} onClick={() => setGiftOpen(value => !value)} disabled={busy}><Gift size={18}/><span>Enviar um presente</span></button>}
              </header>
              {profile?.user && canInteract && <div className="social-profile-actions">{friendActions(profile)}<button type="button" className="social-block-link" disabled={busy} onClick={()=>setBlockPerson({id:profile.user!.id,name:profile.user!.name})}><ShieldBan size={15}/>Bloquear</button>
                {activeFriend && <button type="button" className="social-remove-link" disabled={busy} onClick={() => setRemoveFriend({ id: activeFriend.id, name: activeFriend.user!.name })}>Remover amizade</button>}
              </div>}
              {interactionBlocked&&<div className="social-blocked-note" role="status"><ShieldBan size={23}/><div><strong>Interações indisponíveis entre vocês.</strong><p>Mensagens, presentes e convites ficam bloqueados. Filas, ranking e os grupos de WhatsApp continuam com suas próprias regras.</p>{blockedByMe&&selected&&<button type="button" className="secondary compact" disabled={busy} onClick={()=>void block(selected,false)}>Desbloquear pessoa</button>}</div></div>}
              {giftOpen && who && canInteract && <section className="social-gift-tray" aria-label="Enviar um presente">
                <div><strong>Um gesto para {who.name}.</strong><p>Escolha o presente. Você confirma antes de enviar.</p></div>
                <form onSubmit={event => { event.preventDefault(); setConfirmation({ kind: "coins", to: who.id, name: who.name, coins: coinAmount, reference: crypto.randomUUID() }); }}>
                  <label>Moedas<input aria-label="Moedas para presentear" type="number" step="1" min="1" max={Math.floor(transferable)} value={coinAmount} onChange={event => setCoinAmount(Number(event.target.value))}/></label>
                  <button type="submit" className="primary compact" disabled={busy || !Number.isInteger(coinAmount) || coinAmount < 1 || coinAmount > transferable}><Gift size={16}/>Presentear moedas</button>
                  <small>{number(transferable)} disponíveis para presentear.</small>
                </form>
                {items.some(item => item.quantity > 0) && <div className="social-item-gifts">{items.filter(item => item.quantity > 0).map(item => <button key={item.itemCode} type="button" className="secondary compact" disabled={busy} onClick={() => setConfirmation({ kind: "item", item: item.itemCode, to: who.id, name: who.name, reference: crypto.randomUUID() })}><Gift size={16}/>1 {itemName(item.itemCode)}</button>)}</div>}
                {transferable < 1 && <p className="social-help">Quando tiver moedas disponíveis para presentes, poderá compartilhar por aqui.</p>}
              </section>}
              <div className="social-message-stream" role="log" aria-label="Mensagens da conversa" aria-live="polite" aria-relevant="additions" onScroll={event => { const node = event.currentTarget; scrollToEnd.current = node.scrollHeight - node.scrollTop - node.clientHeight < 60; }}>
                {!interactionBlocked && messages.length === 0 && <div className="social-conversation-empty"><img src={import.meta.env.BASE_URL + "assets/user/messages-editorial-v3.webp"} alt=""/><strong>Uma boa conversa começa com um olá.</strong><p>Depois da amizade aceita, seus recados ficam salvos para a pessoa ler quando puder.</p></div>}
                {!interactionBlocked && messages.map(message => <article key={message.id} className={"social-message" + (message.mine ? " is-mine" : "") + (message.sender?.presentation?.badge === "SUPER" ? " is-super" : message.sender?.presentation?.badge === "ADMIN" ? " is-admin" : "") + ((message.sender?.presentation?.progress?.level ?? 0) >= 30 ? " is-level30" : "")}>
                  {message.sender && <div className="social-message-author"><button type="button" onClick={() => choose(message.sender!.id)} aria-label={"Ver perfil de " + message.sender.name}><UserAvatarView name={message.sender.name} avatar={message.sender.avatar ?? undefined} presentation={message.sender.presentation}/></button>
                    <span>{message.sender.presentation?.progress && <LevelBadge progress={message.sender.presentation.progress} compact/>}<button type="button" onClick={() => choose(message.sender!.id)}>{message.sender.name}</button>{message.sender.presentation?.badge && <b className={"social-message-role is-" + message.sender.presentation.badge.toLowerCase()}>{message.sender.presentation.badge}</b>}</span>
                  </div>}
                  <p>{message.body}</p><time dateTime={message.createdAt}>{stamp(message.createdAt)}</time>
                </article>)}
                <div ref={messageEnd}/>
              </div>
              {canInteract && !canMessage && <div className="social-consent-note" role="status"><MessageCircle size={19}/><div><p><strong>Uma conversa começa com permissão.</strong>{pendingConversation ? pendingConversation.incoming ? "Esta pessoa quer conversar com você. Aceite ou recuse o pedido na lista de conversas." : "Seu pedido foi enviado. Aguarde a pessoa aceitar para começar a conversar." : "Peça para conversar, sem custo. A pessoa escolhe se deseja aceitar. Uma amizade aceita também libera as mensagens."}</p>{!pendingConversation && selected && <button type="button" className="social-quiet-button" disabled={busy} onClick={() => void action(() => api.socialMessageRequest(selected), "Pedido de conversa enviado. Você será avisado quando for aceito.")}>Pedir para conversar · grátis</button>}</div></div>}
              {canMessage && <form className="social-compose" onSubmit={send}><label className="sr-only" htmlFor="social-message-draft">Seu recado</label><textarea id="social-message-draft" rows={2} value={draft} onChange={event => setDraft(event.target.value)} maxLength={2000} placeholder="Escreva uma mensagem gentil…" disabled={busy}/><button type="submit" className="primary" disabled={busy || !draft.trim()}><Send size={18}/><span>Enviar</span></button></form>}
            </> : <div className="social-conversation-empty"><img src={import.meta.env.BASE_URL + "assets/user/messages-editorial-v3.webp"} alt=""/><h3>Quem você quer conhecer hoje?</h3><p>Escolha uma conversa ou convide alguém para seus amigos.</p><button type="button" className="secondary" onClick={() => chooseTab("friends")}><UserPlus size={17}/>Encontrar amigos</button></div>}
          </section>
        </div>}
        {tab === "friends" && <section className="social-friends-page" aria-label="Seus amigos">
          <div className="social-friends-intro"><div><h3>Gente que faz parte da sua jornada.</h3><p>Adicione pelo WhatsApp ou pelo nome e avatar de alguém na comunidade. Enviar um convite custa {requestCost} moeda. Quem recebe pode aceitar sem custo.</p></div><Users size={38} aria-hidden="true"/></div>
          {!social?.enabled && <p className="social-help">Os novos convites estão pausados. Seus amigos e conversas continuam aqui.</p>}
          <form className="social-find-form" onSubmit={find}><label htmlFor="social-friend-phone">WhatsApp completo<span>Inclua DDI, DDD e número. Não mostramos o telefone no perfil.</span></label><div><input id="social-friend-phone" type="tel" inputMode="tel" autoComplete="off" maxLength={24} placeholder="+55 71 9…" value={phone} onChange={event => setPhone(event.target.value)} disabled={busy || !social?.enabled}/><button type="submit" className="primary" disabled={busy || !phone.trim() || !social?.enabled}><Search size={17}/>Encontrar</button></div></form>
          {found?.user && <div className="social-found"><Person user={found.user} onClick={() => choose(found.user!.id)}/>{friendActions(found, "search")}</div>}
          {social && <label className="social-preference"><input type="checkbox" checked={social.preferences.acceptFriendRequests} disabled={busy} onChange={event => void action(() => api.socialPreferences(event.target.checked), event.target.checked ? "Você está recebendo convites de amizade." : "Novos convites foram pausados para você.")}/><span>Receber convites de amizade<small>Você escolhe quem pode se aproximar.</small></span></label>}
          {Boolean(social?.incoming.length) && <div className="social-friend-section"><h3>Convites para você <span>{social!.incoming.length}</span></h3>{social!.incoming.map(invitation => invitation.user && <article key={invitation.id} className="social-invitation"><Person user={invitation.user} onClick={() => choose(invitation.user!.id)}/><div className="social-inline-actions"><button type="button" className="primary compact" disabled={busy || !social?.enabled} onClick={() => void respond(invitation.id, "ACCEPT")}><Check size={16}/>Aceitar grátis</button><button type="button" className="secondary compact" disabled={busy} onClick={() => void respond(invitation.id, "DECLINE")}>Agora não</button></div></article>)}</div>}
          <div className="social-friend-section"><h3>Seus amigos <span>{social?.friends.length ?? 0}</span></h3>{social?.friends.length ? <div className="social-friend-grid">{social.friends.map(friend => friend.user && <article key={friend.id}><Person user={friend.user} onClick={() => choose(friend.user!.id)}/><div className="social-friend-controls"><button type="button" className="social-quiet-button" onClick={() => choose(friend.user!.id)}><MessageCircle size={16}/>Conversar</button><button type="button" className="social-quiet-button" disabled={busy} onClick={()=>setRemoveFriend({id:friend.id,name:friend.user!.name})}><UserMinus size={16}/>Remover</button><button type="button" className="social-block-link" disabled={busy} onClick={()=>setBlockPerson({id:friend.user!.id,name:friend.user!.name})}><ShieldBan size={16}/>Bloquear</button></div></article>)}</div> : <div className="social-soft-empty"><UserPlus size={26}/><p>Seu círculo começa com o primeiro convite.</p></div>}</div>
          {Boolean(social?.blocked?.length)&&<div className="social-friend-section"><h3>Pessoas bloqueadas <span>{social!.blocked!.length}</span></h3><p className="social-help">Desbloquear permite novas interações; não restaura uma amizade removida.</p>{social!.blocked!.map(person=><article key={person.userId} className="social-blocked-person">{person.user?<Person user={person.user} compact/>:<strong>Participante indisponível</strong>}<button type="button" className="secondary compact" disabled={busy} onClick={()=>void block(person.userId,false)}>Desbloquear</button></article>)}</div>}
          {Boolean(social?.outgoing.length) && <div className="social-friend-section"><h3>Convites enviados <span>{social!.outgoing.length}</span></h3><p className="social-help">Aguardando resposta. Aceitar é gratuito para quem recebeu.</p>{social!.outgoing.map(invitation => invitation.user && <article key={invitation.id} className="social-invitation"><Person user={invitation.user} compact onClick={() => choose(invitation.user!.id)}/><button type="button" className="social-quiet-button" disabled={busy} onClick={() => void respond(invitation.id, "CANCEL")}>Cancelar convite</button></article>)}</div>}
        </section>}
        {tab === "notifications" && <section className="social-notifications-page" aria-label="Suas notificações"><div className="social-section-heading"><h3>Novidades para você</h3><button type="button" className="social-quiet-button" disabled={busy || !notifications?.unread} onClick={() => void readNotifications()}><CheckCheck size={17}/>Marcar como lidas</button></div>
          {notifications?.notifications.length ? notifications.notifications.map(notification => <article key={notification.id} className={"social-notification" + (!notification.readAt ? " is-unread" : "")}>
            {notification.actor ? <button type="button" className="social-notification-avatar" onClick={() => choose(notification.actor!.id)} aria-label={"Ver " + notification.actor.name}><UserAvatarView name={notification.actor.name} avatar={notification.actor.avatar ?? undefined} presentation={notification.actor.presentation}/></button> : <Bell size={23}/>}
            <div><p>{notificationText(notification)}</p><time dateTime={notification.createdAt}>{stamp(notification.createdAt)}</time>
              {notification.kind === "FRIEND_REQUEST" && social?.incoming.some(invitation => invitation.id === notification.referenceId) && <div className="social-inline-actions"><button type="button" className="primary compact" disabled={busy || !social?.enabled} onClick={() => void respond(notification.referenceId, "ACCEPT")}>Aceitar grátis</button><button type="button" className="secondary compact" disabled={busy} onClick={() => void respond(notification.referenceId, "DECLINE")}>Agora não</button></div>}
            </div>{!notification.readAt && <i aria-label="Não lida"/>}
          </article>) : <div className="social-soft-empty"><Bell size={30}/><h3>Tudo em dia por aqui.</h3><p>Convites e presentes vão aparecer neste espaço.</p></div>}
        </section>}
        {notice && <p className="social-notice" role="status"><Check size={17}/>{notice}</p>}
        {error && <div className="social-error" role="alert"><p>{error}</p><button type="button" className="social-quiet-button" onClick={() => { setError(""); void load(); }}>Tentar atualizar</button></div>}
      </div>
      {(confirmation || removeFriend || inviteFriend || blockPerson) && <div className="social-confirm-layer" role="group" aria-label={inviteFriend ? "Confirmar convite de amizade" : blockPerson ? "Confirmar bloqueio" : confirmation ? "Confirmar presente" : "Confirmar remoção de amizade"}>
        <section ref={confirmationRef} className="social-confirm-card" role="dialog" aria-modal="true" aria-label={inviteFriend ? "Confirmar convite de amizade" : blockPerson ? "Confirmar bloqueio" : confirmation ? "Confirmar presente" : "Confirmar remoção de amizade"}>
          {inviteFriend ? <><span className="social-confirm-symbol"><UserPlus size={30}/></span><h3>Convidar {inviteFriend.name}?</h3><p>O envio custa <strong>{requestCost} moeda</strong>, debitada uma única vez ao confirmar.</p><small>A pessoa receberá uma notificação e poderá aceitar sem pagar. O convite ficará pendente até a resposta; cancelar ou receber uma recusa não devolve a moeda.</small><div><button type="button" className="secondary" disabled={busy} onClick={()=>setInviteFriend(undefined)}>Voltar</button><button type="button" className="primary" disabled={busy} onClick={()=>void requestFriend(inviteFriend.id)}>{busy?"Enviando…":`Enviar por ${requestCost} moeda`}</button></div></> : blockPerson ? <><span className="social-confirm-symbol"><ShieldBan size={30}/></span><h3>Bloquear {blockPerson.name}?</h3><p>A amizade e os convites serão encerrados. Vocês deixam de trocar mensagens e presentes e de ver as mensagens um do outro no chat global.</p><small>Filas, ranking e grupos de WhatsApp continuam seguindo suas próprias regras. Você pode desfazer o bloqueio em Amigos.</small><div><button type="button" className="secondary" disabled={busy} onClick={()=>setBlockPerson(undefined)}>Voltar</button><button type="button" className="primary" disabled={busy} onClick={()=>void block(blockPerson.id,true)}>{busy?"Bloqueando…":"Confirmar bloqueio"}</button></div></> : confirmation ? <><span className="social-confirm-symbol"><Gift size={30}/></span><h3>Um presente para {confirmation.name}.</h3><p>Enviar <strong>{confirmation.kind === "coins" ? number(confirmation.coins) + " moedas" : "1 " + itemName(confirmation.item)}</strong>?</p><small>{confirmation.kind === "coins" ? "Esse valor sai das suas moedas disponíveis para presentes. Depois de confirmar, a entrega é imediata." : isRoot ? "O item será concedido pela sua conta ADMIN." : "O item sai do seu inventário e entra na conta dessa pessoa."}</small><div><button type="button" className="secondary" disabled={busy} onClick={() => setConfirmation(undefined)}>Voltar</button><button type="button" className="primary" disabled={busy} onClick={() => void give()}>{busy ? "Entregando…" : confirmation.kind === "coins" ? "Confirmar moedas" : "Confirmar presente"}</button></div></>
            : <><h3>Remover {removeFriend!.name} dos amigos?</h3><p>As mensagens anteriores continuam salvas e a conversa já aceita continua liberada. Para impedir mensagens e outras interações, use Bloquear.</p><div><button type="button" className="secondary" disabled={busy} onClick={() => setRemoveFriend(undefined)}>Voltar</button><button type="button" className="primary" disabled={busy} onClick={() => void respond(removeFriend!.id, "REMOVE")}>Remover amizade</button></div></>}
        </section>
      </div>}
    </section>
  </div>;
}
