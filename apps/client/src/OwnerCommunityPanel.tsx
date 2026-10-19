import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Coins, Gift, HelpCircle, RefreshCw, Save, ShieldCheck, Users, X } from "lucide-react";
import { ownerApi, type ChatSender, type OwnerCommunityConfig, type OwnerCommunityData, type OwnerCommunityRelationship } from "./api";
import { UserAvatarView } from "./AvatarModal";
import { useModalLifecycle } from "./useModalLifecycle";
import "./owner-community.css";

const date = (value:string) => new Date(value).toLocaleString("pt-BR");
const coins = (millis:number) => (millis/1000).toLocaleString("pt-BR",{maximumFractionDigits:3});
const errorText = (cause:unknown) => cause instanceof Error ? cause.message : "Não foi possível concluir. Tente novamente.";

function Help({text}:{text:string}) {
  return <details className="owner-community-help"><summary aria-label="Saiba mais"><HelpCircle size={16}/></summary><p>{text}</p></details>;
}
function Person({user,id,onOpen}:{user?:ChatSender|null;id:string;onOpen:(id:string)=>void}) {
  return <button type="button" className="owner-community-person" onClick={()=>onOpen(id)} disabled={!user}>
    <UserAvatarView name={user?.name??"Conta indisponível"} avatar={user?.avatar??undefined} presentation={user?.presentation} />
    <span><strong>{user?.name??"Conta indisponível"}</strong><small>Ver participante</small></span>
  </button>;
}
function RevokeDialog({relationship,busy,onClose,onConfirm}:{relationship:OwnerCommunityRelationship;busy:boolean;onClose:()=>void;onConfirm:(reason:string)=>void}) {
  const [reason,setReason]=useState("");
  const ref=useModalLifecycle(()=>{if(!busy)onClose();});
  return <div className="owner-community-overlay" onMouseDown={()=>{if(!busy)onClose();}}>
    <section ref={ref} role="dialog" aria-modal="true" aria-labelledby="community-revoke-title" className="owner-community-dialog" onMouseDown={event=>event.stopPropagation()}>
      <button type="button" className="owner-community-close" disabled={busy} onClick={onClose} aria-label="Fechar"><X size={20}/></button>
      <ShieldCheck size={26}/><h2 id="community-revoke-title">Encerrar este vínculo?</h2>
      <p>{relationship.sender?.name??"Participante"} e {relationship.recipient?.name??"participante"} deixarão de ter este convite ou amizade ativa. As conversas e o histórico serão preservados.</p>
      <form onSubmit={event=>{event.preventDefault();onConfirm(reason.trim());}}>
        <label>Motivo da moderação<textarea autoFocus required minLength={5} maxLength={240} value={reason} onChange={event=>setReason(event.target.value)} placeholder="Explique o motivo para o registro administrativo."/></label>
        <small>De 5 a 240 caracteres. Sua decisão fica registrada com data e responsável.</small>
        <div className="owner-community-actions"><button type="button" className="secondary" disabled={busy} onClick={onClose}>Cancelar</button><button className="primary" disabled={busy||reason.trim().length<5}>{busy?"Registrando…":"Confirmar encerramento"}</button></div>
      </form>
    </section>
  </div>;
}
function AuditDetail({payload,action}:{payload:string;action:string}) {
  let value:Record<string,unknown>={};
  try { value=JSON.parse(payload) as Record<string,unknown>; } catch { return <p>Registro preservado.</p>; }
  if(typeof value.reason==="string")return <p>{value.reason}</p>;
  if(action==="CONFIG_UPDATED"||action==="COMMUNITY_CONFIG_UPDATED")return <p>Preferências da comunidade atualizadas.</p>;
  return <details><summary>Ver detalhes do registro</summary><pre>{JSON.stringify(value,null,2)}</pre></details>;
}
export function OwnerCommunityPanel({onOpenParticipant}:{onOpenParticipant:(id:string)=>void}) {
  const [data,setData]=useState<OwnerCommunityData|null>(null);
  const [draft,setDraft]=useState<OwnerCommunityConfig|null>(null);
  const [busy,setBusy]=useState(false);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState("");
  const [notice,setNotice]=useState("");
  const [section,setSection]=useState<"relationships"|"gifts"|"audit">("relationships");
  const [selected,setSelected]=useState<OwnerCommunityRelationship|null>(null);
  const [query,setQuery]=useState("");
  const load=useCallback(async()=>{
    setLoading(true);
    try {const next=await ownerApi.community();setData(next);setDraft(next.config);setError("");}
    catch(cause){setError(errorText(cause));}
    finally {setLoading(false);}
  },[]);
  useEffect(()=>{void load();},[load]);
  const changed=Boolean(data&&draft&&JSON.stringify(data.config)!==JSON.stringify(draft));
  async function save(event:FormEvent) {
    event.preventDefault();
    if(!draft)return;
    setBusy(true);setError("");setNotice("");
    try {await ownerApi.saveCommunity(draft);await load();setNotice("Preferências salvas. As novas regras já estão valendo.");}
    catch(cause){setError(errorText(cause));}
    finally {setBusy(false);}
  }
  async function revoke(reason:string) {
    if(!selected)return;
    setBusy(true);setError("");setNotice("");
    try {await ownerApi.revokeCommunityRelationship(selected.id,reason);setSelected(null);await load();setNotice("Vínculo encerrado e motivo registrado na auditoria.");}
    catch(cause){setError(errorText(cause));}
    finally {setBusy(false);}
  }
  const filter=query.trim().toLocaleLowerCase("pt-BR");
  const relationships=data?.relationships.filter(row=>[row.sender?.name,row.recipient?.name].some(name=>name?.toLocaleLowerCase("pt-BR").includes(filter)))??[];
  const transfers=data?.coinTransfers.transfers.filter(row=>[row.fromName,row.toName].some(name=>name.toLocaleLowerCase("pt-BR").includes(filter)))??[];
  return <section className="owner-panel owner-community-panel" aria-busy={loading||busy}>
    <header className="owner-community-heading"><div><p className="eyebrow dark">CUIDADO COM A COMUNIDADE</p><h2><Users size={23}/> Amigos e presentes</h2><p>Controle os convites, acompanhe as moedas presenteadas e registre decisões com clareza.</p></div><button type="button" className="secondary" disabled={busy||loading||changed} onClick={()=>void load()}><RefreshCw size={16}/> Atualizar</button></header>
    {error&&<p role="alert" className="error">{error}</p>}
    {notice&&<p role="status" className="owner-community-notice">{notice}</p>}
    {loading&&!data&&<p role="status">Carregando a comunidade…</p>}
    {data&&draft&&<>
      <div className="owner-community-metrics">
        <article><Users size={20}/><strong>{data.stats.friendships}</strong><span>amizades aceitas</span></article>
        <article><Users size={20}/><strong>{data.stats.pendingInvitations}</strong><span>convites aguardando resposta</span></article>
        <article><Gift size={20}/><strong>{data.coinTransfers.totals.count}</strong><span>presentes enviados</span></article>
        <article><Coins size={20}/><strong>{coins(data.coinTransfers.totals.amountMillis)}</strong><span>moedas transferidas</span></article>
      </div>
      <form className="owner-community-config" onSubmit={save}>
        <div className="owner-community-subheading"><div><h3>Preferências da comunidade</h3><p>{data.stats.participantsReceivingInvites} participantes permitem receber convites. Cada pessoa também controla essa preferência no correio.</p></div><Help text="Pausar convites impede novas amizades enquanto a opção estiver desligada. Pausar presentes impede novas transferências. Os vínculos, saldos e registros anteriores são preservados."/></div>
        <div className="owner-community-fields">
          <label className="owner-community-toggle"><input type="checkbox" checked={draft.friendsEnabled} disabled={busy} onChange={event=>setDraft({...draft,friendsEnabled:event.target.checked})}/><span><strong>Permitir convites de amizade</strong><small>{draft.friendsEnabled?"Convites liberados":"Novos convites pausados"}</small></span></label>
          <label className="owner-community-toggle"><input type="checkbox" checked={draft.coinGiftsEnabled} disabled={busy} onChange={event=>setDraft({...draft,coinGiftsEnabled:event.target.checked})}/><span><strong>Permitir presentes de moedas</strong><small>{draft.coinGiftsEnabled?"Presentes liberados":"Novos presentes pausados"}</small></span></label>
          <label>Máximo de moedas por presente<input type="number" min={1} max={10000} step={1} required disabled={busy} value={draft.maxGiftCoins} onChange={event=>setDraft({...draft,maxGiftCoins:Number(event.target.value)})}/><small>Entre 1 e 10.000 moedas em cada envio.</small></label>
          <label>Espera após convite recusado (horas)<input type="number" min={0} max={720} step={1} required disabled={busy} value={draft.declinedInviteCooldownHours} onChange={event=>setDraft({...draft,declinedInviteCooldownHours:Number(event.target.value)})}/><small>De 0 a 720 horas para enviar outro convite à mesma pessoa.</small></label>
        </div>
        <div className="owner-community-actions">{changed&&<small>Há alterações ainda não salvas.</small>}<button className="primary" disabled={busy||!changed}><Save size={16}/>{busy?"Salvando…":"Salvar preferências"}</button></div>
      </form>
      <nav className="owner-community-tabs" aria-label="Gestão da comunidade">{([["relationships","Amizades e convites"],["gifts","Presentes e origem"],["audit","Histórico de decisões"]] as const).map(([key,label])=><button type="button" key={key} aria-pressed={section===key} className={section===key?"active":""} onClick={()=>setSection(key)}>{label}</button>)}</nav>
      {section!=="audit"&&<label className="owner-community-search">Buscar participante<input type="search" value={query} onChange={event=>setQuery(event.target.value)} placeholder="Nome de quem enviou ou recebeu"/></label>}
      {section==="relationships"&&<div className="owner-community-list">
        <p className="muted">Até 100 vínculos ativos mais recentes. A amizade depende do aceite das duas pessoas; a administração pode encerrá-la com justificativa.</p>
        {relationships.map(row=><article key={row.id} className="owner-community-record"><div className="owner-community-pair"><Person user={row.sender} id={row.senderId} onOpen={onOpenParticipant}/><span aria-hidden="true">→</span><Person user={row.recipient} id={row.recipientId} onOpen={onOpenParticipant}/></div><div className="owner-community-record-meta"><span className={"owner-community-status "+(row.status==="ACCEPTED"?"accepted":"pending")}>{row.status==="ACCEPTED"?"Amizade aceita":"Convite pendente"}</span><small>Atualizado em {date(row.updatedAt)}</small><button type="button" className="secondary" disabled={busy} onClick={()=>setSelected(row)}>Moderar vínculo</button></div></article>)}
        {!relationships.length&&<p className="owner-community-empty">Nenhum vínculo encontrado{filter?" para esta busca":" por enquanto"}.</p>}
      </div>}
      {section==="gifts"&&<div className="owner-community-list">
        <div className="owner-community-explainer"><ShieldCheck size={22}/><div><strong>Presentear movimenta moedas; não cria uma nova venda.</strong><p>A receita adicional dessas transferências é R$ 0,00. A origem é preservada e aparece apenas para o Owner: {coins(data.coinTransfers.totals.purchasedMillis)} compradas e {coins(data.coinTransfers.totals.rewardMillis)} de recompensas, no total histórico.</p></div></div>
        <p className="muted">Últimos 100 presentes. O participante escolhe uma quantidade única.</p>
        {transfers.map(row=><article className="owner-community-record" key={row.id}><div className="owner-community-transfer"><Gift size={22}/><div><strong><button type="button" className="participant-link" onClick={()=>onOpenParticipant(row.fromUserId)}>{row.fromName}</button> → <button type="button" className="participant-link" onClick={()=>onOpenParticipant(row.toUserId)}>{row.toName}</button></strong><small>{date(row.createdAt)}</small><details><summary>Identificação do presente</summary><code>{row.id}</code></details></div></div><div className="owner-community-provenance"><strong>{coins(row.amountMillis)} moedas</strong><span>Compradas: {coins(row.purchasedMillis)}</span><span>Recompensas: {coins(row.rewardMillis)}</span><small>Receita adicional: R$ 0,00</small></div></article>)}
        {!transfers.length&&<p className="owner-community-empty">Nenhum presente encontrado{filter?" para esta busca":" por enquanto"}.</p>}
      </div>}
      {section==="audit"&&<div className="owner-community-list"><p className="muted">Últimas 100 decisões. Os registros anteriores são preservados e não podem ser alterados por este painel.</p>{data.audit.map(row=><article className="owner-community-audit" key={row.id}><ShieldCheck size={19}/><div><strong>{row.action==="ADMIN_FRIENDSHIP_REVOKED"?"Vínculo encerrado pela administração":row.action==="COMMUNITY_CONFIG_UPDATED"||row.action==="CONFIG_UPDATED"?"Preferências atualizadas":row.action}</strong><small>{date(row.createdAt)} · Responsável: {row.actorId}</small><AuditDetail payload={row.payload} action={row.action}/></div></article>)}{!data.audit.length&&<p className="owner-community-empty">Nenhuma decisão administrativa registrada nesta área.</p>}</div>}
    </>}
    {selected&&<RevokeDialog relationship={selected} busy={busy} onClose={()=>setSelected(null)} onConfirm={reason=>void revoke(reason)}/>}
  </section>;
}
