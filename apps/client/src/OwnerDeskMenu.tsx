import { Bot, CheckCircle2, Coins, CreditCard, LogOut, Play, RefreshCw, Settings2, ShieldCheck, UserCog, Users, X } from "lucide-react";
import { ownerApi, type OwnerOverview, type UserAvatar } from "./api";
import { UserAvatarView } from "./AvatarModal";
import { ProfilePhotoActions } from "./ProfilePhotoActions";
import { useModalLifecycle } from "./useModalLifecycle";

const money=(cents=0)=>(cents/100).toLocaleString("pt-BR",{style:"currency",currency:"BRL"});

export type OwnerMenuTarget="requests"|"users"|"purchases"|"groups"|"removed";

export function OwnerDeskMenu({data,onClose,onNavigate,onWhatsApp,onPayments,onRefresh,onVersion,onLogout,onAvatarChanged,onParticipate,onManageOwners}:{
  data:OwnerOverview;onClose:()=>void;onNavigate:(target:OwnerMenuTarget)=>void;onWhatsApp:()=>void;onPayments:()=>void;onRefresh:()=>void;onVersion:()=>void;onLogout:()=>void;onAvatarChanged:(avatar?:UserAvatar)=>void;
  onParticipate:()=>void;onManageOwners:()=>void;
}) {
  const modalRef=useModalLifecycle(onClose);
  const go=(target:OwnerMenuTarget)=>{onNavigate(target);onClose();};
  return <div className="desk-menu-layer owner-desk-layer" onMouseDown={onClose}>
    <aside ref={modalRef} className="desk-menu owner-desk-menu" role="dialog" aria-modal="true" aria-label="Menu do Owner" onMouseDown={(event)=>event.stopPropagation()}>
      <div className="desk-menu-head">
        <div className="owner-menu-identity"><UserAvatarView avatar={data.owner.avatar} name={data.owner.name} className="owner-menu-avatar"/><div><small>{data.owner.role==="ROOT_OWNER"?"OWNER PRINCIPAL":"ADMINISTRADOR"}</small><strong>{data.owner.name}</strong><em>{data.owner.role==="ROOT_OWNER"?"Controle completo do SOS YouTuber":"Operação da comunidade · configurações protegidas"}</em></div></div>
        <button className="desk-close" aria-label="Fechar menu" onClick={onClose}><X size={18}/></button>
      </div>

      <section className="desk-section owner-queue-menu">
        <div className="desk-section-title"><Play size={17}/><strong>Filas</strong></div>
        {data.activeRounds.map((round)=><article className={"owner-round-row "+round.status.toLowerCase()} key={round.id}>
          <div className="owner-round-copy"><strong>Fila {round.sequence}</strong><span className="owner-round-progress">{round.status==="OPEN" ? <><b>{Math.min(10,Math.max(0,round.submissions))}/10</b> vídeos · recebendo contribuições</> : "Fila completa · disponível para visualizar"}</span></div>
          {round.status==="OPEN"&&<button className="primary compact owner-participate-button" disabled={!data.owner.permissions.canParticipate} onClick={()=>{onParticipate();onClose();}}>Participar da fila</button>}
        </article>)}
        {!data.owner.permissions.canParticipate&&<small className="owner-menu-hint">Para participar como Admin, este Owner precisa ter um cadastro de participante com o mesmo WhatsApp.</small>}
      </section>

      <div className="owner-menu-pulse">
        <article><strong>{data.metrics.pendingRequests}</strong><span>solicitações pendentes</span></article>
        <article><strong>{data.metrics.registeredUsers}</strong><span>participantes ativos</span></article>
        <article><strong>{money(data.metrics.revenueCentsMonth)}</strong><span>receita Pix no mês</span></article>
        <article><strong>{data.whatsapp.groupsLinked}</strong><span>grupos vinculados</span></article>
      </div>

      <section className="desk-section">
        <div className="desk-section-title"><CheckCircle2 size={17}/><strong>Comunidade</strong></div>
        <button className="owner-menu-link" onClick={()=>go("requests")}><span><Users size={17}/><b>Solicitações</b></span><small>{data.metrics.pendingRequests} aguardando decisão</small></button>
        <button className="owner-menu-link" onClick={()=>go("users")}><span><Users size={17}/><b>Participantes</b></span><small>Perfis, avatares, atividade, carteiras e acessos</small></button>
        <button className="owner-menu-link" onClick={()=>go("groups")}><span><ShieldCheck size={17}/><b>Grupos e acesso</b></span><small>Grupos 1–999, membros e verificação externa</small></button>
        <button className="owner-menu-link" onClick={()=>go("removed")}><span><ShieldCheck size={17}/><b>Contas removidas</b></span><small>{data.metrics.deletedUsers} ID(s) preservados apenas para auditoria</small></button>
      </section>

      <section className="desk-section">
        <div className="desk-section-title"><Coins size={17}/><strong>Financeiro</strong></div>
        <button className="owner-menu-link" onClick={()=>go("purchases")}><span><CreditCard size={17}/><b>Compras e receita</b></span><small>{data.metrics.coinsPackagePurchasesMonth} pacote(s) de moedas · {data.metrics.passPurchasesMonth} passe(s)</small></button>
        {data.owner.permissions.canConfigure&&<button className="owner-menu-link" onClick={()=>{onPayments();onClose();}}><span><Settings2 size={17}/><b>Configurar Pix</b></span><small>Provedor, ambiente e webhooks de confirmação</small></button>}
      </section>

      <section className="desk-section">
        <div className="desk-section-title"><Bot size={17}/><strong>Integrações e operação</strong></div>
        {data.owner.permissions.canConfigure&&<button className="owner-menu-link" onClick={()=>{onWhatsApp();onClose();}}><span><Bot size={17}/><b>WhatsApp e validação</b></span><small>{data.whatsapp.configured?"Transporte configurado":"Integração ainda incompleta"} · {data.whatsapp.groupsLinked} grupo(s) confirmado(s)</small></button>}
        {data.owner.permissions.canManageOwners&&<button className="owner-menu-link" onClick={()=>{onManageOwners();onClose();}}><span><UserCog size={17}/><b>Equipe administrativa</b></span><small>Adicionar ou revogar Administradores vinculados a usuários verificados.</small></button>}
        <button className="owner-menu-link" onClick={()=>{onRefresh();onClose();}}><span><RefreshCw size={17}/><b>Atualizar dados agora</b></span><small>Recarrega o painel sem sair da sessão</small></button>
        <button className="owner-menu-link" onClick={()=>{onVersion();onClose();}}><span><RefreshCw size={17}/><b>Conferir versão online</b></span><small>{data.version.gitSha}{data.version.dirty?" · mudanças locais pendentes":""}</small></button>
      </section>

      <section className="desk-section desk-account-section">
        <div className="desk-section-title"><Settings2 size={17}/><strong>Meu perfil</strong></div>
        <ProfilePhotoActions saveAvatar={ownerApi.saveAvatar} clearAvatar={ownerApi.clearAvatar} onChanged={onAvatarChanged}/>
        <button className="desk-action" onClick={onLogout}><LogOut size={17}/><span><strong>Sair do painel Owner</strong><small>Encerra somente esta sessão administrativa.</small></span></button>
      </section>
    </aside>
  </div>;
}
