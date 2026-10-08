import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Bot, Check, ChevronLeft, ChevronRight, Download, HelpCircle, Menu, RefreshCw, Settings2, ShieldCheck, Users, Youtube } from "lucide-react";
import { GoogleIdentityRequests } from "./GoogleIdentityRequests";
import { ApiError, ownerApi, type OwnerOverview } from "./api";
import { WhatsAppIntegrationModal } from "./WhatsAppIntegrationModal";
import { ParticipantAdminModal } from "./ParticipantAdminModal";
import { PaymentIntegrationModal } from "./PaymentIntegrationModal";
import { PhoneField, isCompletePhoneField } from "./PhoneField";
import { OwnerDeskMenu, type OwnerMenuTarget } from "./OwnerDeskMenu";
import { AvatarModal, UserAvatarView } from "./AvatarModal";
import { OwnerTeamModal } from "./OwnerTeamModal";
import { useModalLifecycle } from "./useModalLifecycle";

function localMonth() {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bahia", year: "numeric", month: "2-digit" }).formatToParts(new Date());
  return `${parts.find((p) => p.type === "year")!.value}-${parts.find((p) => p.type === "month")!.value}`;
}
const date = (value?: string) => value ? new Date(value).toLocaleString("pt-BR") : "—";
const monthLabel = (value:string) => {
  const [year,month]=value.split("-").map(Number);
  if(!year || !month) return value;
  const label=new Intl.DateTimeFormat("pt-BR",{month:"long",year:"numeric",timeZone:"UTC"}).format(new Date(Date.UTC(year,month-1,1)));
  return label.charAt(0).toUpperCase()+label.slice(1);
};
const money = (cents: number) => (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const coins = (millis: number) => (millis / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 3 });
const paymentProviderName = (provider:string) => provider==="MERCADO_PAGO" ? "Mercado Pago" : provider==="ASAAS" ? "Asaas" : provider==="PAGBANK" ? "PagBank" : provider==="DEMO" ? "Simulação" : "Desativado";
const paymentProductName = (code:string) => code==="COINS_LAUNCH" ? "10 moedas + 1 passe bônus" : code==="PASS_SINGLE" ? "1 passe" : "Compra anterior";
const GROUP_PAGE_SIZE=12;
const MANUAL_GROUP_PAGE_SIZE=12;
const ALL_GROUP_CODES=Array.from({length:999},(_,index)=>String(index+1));

function GroupAdminModal({ group, busy, onClose, onToggle, onSaveLink }: {
  group: OwnerOverview["groups"][number];
  busy: boolean;
  onClose: () => void;
  onToggle: () => Promise<void>;
  onSaveLink: (joinUrl: string) => Promise<void>;
}) {
  const [joinUrl,setJoinUrl]=useState(group.joinUrl ?? "");
  const modalRef=useModalLifecycle(onClose);
  const externallyConfirmed=Boolean(group.whatsappGroupId || group.verificationProvider);
  return <div className="modal-backdrop" onMouseDown={onClose}>
    <section ref={modalRef} className="modal group-admin-modal" role="dialog" aria-modal="true" aria-label={`Gerenciar SOS YOUTUBER ${group.code}`} onMouseDown={(event)=>event.stopPropagation()}>
      <button className="close" aria-label="Fechar gerenciamento do grupo" onClick={onClose}>×</button>
      <p className="eyebrow dark">GRUPO SOS YOUTUBER {group.code}</p>
      <h2>Estado real do grupo</h2>
      <p className="muted">“Habilitado no SOS” controla acesso interno. “Vínculo externo” só fica confirmado quando uma integração registra prova do grupo fora do sistema.</p>
      <div className="group-reality-grid">
        <article><span>Habilitado no SOS</span><strong>{group.enabled ? "SIM" : "NÃO"}</strong><small>{group.enabled ? "Pode receber acessos e aprovações." : "Novos acessos ficam pausados; dados são preservados."}</small></article>
        <article><span>Vínculo externo</span><strong>{externallyConfirmed ? "CONFIRMADO" : "NÃO CONFIRMADO"}</strong><small>{group.whatsappGroupId ? "Há um identificador externo salvo por integração." : "Nenhuma integração comprovou este grupo ainda."}</small></article>
        <article><span>Verificação</span><strong>{group.verificationProvider ?? "OWNER / INTERNA"}</strong><small>{group.ownerAdminCount ? `${group.ownerAdminCount} Owner/admin confirmado(s) na última prova.` : "Sem prova externa de Owner/admin."}</small></article>
        <article><span>Última prova</span><strong>{group.verifiedAt ? date(group.verifiedAt) : "—"}</strong><small>{group.lastSyncedAt ? `Última sincronização: ${date(group.lastSyncedAt)}` : "Nunca sincronizado externamente."}</small></article>
      </div>
      {group.whatsappGroupId && <label>ID externo do grupo<input value={group.whatsappGroupId} readOnly aria-readonly="true"/><small className="field-help-copy">Somente leitura: este ID vem da integração e não pode ser inventado manualmente.</small></label>}
      <label>Link de entrada do grupo
        <input type="url" value={joinUrl} onChange={(event)=>setJoinUrl(event.target.value)} placeholder="https://chat.whatsapp.com/..."/>
        <small className="field-help-copy">Opcional. Salvo no servidor. Deixe vazio para remover. O link não prova sozinho que o grupo existe.</small>
      </label>
      <div className="modal-actions">
        <button className="secondary" disabled={busy} onClick={()=>void onToggle()}>{group.enabled ? "Pausar no SOS" : "Habilitar no SOS"}</button>
        <button className="primary" disabled={busy} onClick={()=>void onSaveLink(joinUrl.trim())}>Salvar link</button>
      </div>
    </section>
  </div>;
}

type AdminHelpTopic = "groups" | "manual" | "bot" | "version" | "payments";

function AdminHelpModal({ topic, onClose }: { topic: AdminHelpTopic; onClose: () => void }) {
  const modalRef=useModalLifecycle(onClose);
  const labels: Record<AdminHelpTopic,string> = {
    groups:"Ajuda sobre grupos e acesso",
    manual:"Ajuda sobre autorização manual",
    bot:"Ajuda sobre o bot SOS YouTube",
    version:"Ajuda sobre versão e sincronização",
    payments:"Ajuda sobre pagamentos e moedas"
  };
  return <div className="modal-backdrop admin-help-backdrop" onMouseDown={onClose}>
    <section ref={modalRef} className="modal admin-help-modal" role="dialog" aria-modal="true" aria-label={labels[topic]} onMouseDown={(e)=>e.stopPropagation()}>
      <button className="close" aria-label="Fechar ajuda" onClick={onClose}>×</button>
      <p className="eyebrow dark">AJUDA ADMINISTRATIVA</p>
      {topic === "groups" ? <>
        <h2>Para que servem estes grupos?</h2>
        <p>Os cards representam os grupos <strong>SOS YOUTUBER</strong> aceitos pelo sistema. Eles não são filas de vídeos: são grupos de acesso dos participantes.</p>
        <div className="help-points">
          <p><strong>Habilitado no SOS</strong> permite login e novas aprovações naquele número de grupo. Isso não significa, por si só, que exista um grupo WhatsApp externo. <strong>Pausado</strong> suspende novos acessos sem apagar usuários, saldos ou histórico.</p>
          <p><strong>Vínculo externo confirmado</strong> só aparece quando uma integração realmente reconhece o grupo fora do sistema.</p>
          <p><strong>Validação Owner</strong> significa que a autorização é feita manualmente pelos Owners. Quando uma integração externa de grupo estiver realmente validada, o card indicará esse modo separadamente.</p>
        </div>
      </> : topic === "manual" ? <>
        <h2>O que é autorização manual?</h2>
        <p>É uma rota administrativa excepcional para um participante que você já conferiu fora da fila normal de solicitações.</p>
        <div className="help-points">
          <p>O Owner informa <strong>nome + WhatsApp + grupo</strong>. O sistema registra data, origem e qual Owner tomou a decisão.</p>
          <p>Use a aba <strong>Solicitações</strong> como caminho padrão. A autorização manual existe para correções, migrações ou casos já validados por você.</p>
          <p>Se o grupo exigir uma prova externa, a aprovação manual fica registrada, mas não finge que o WhatsApp confirmou algo que ainda não confirmou.</p>
        </div>
      </> : topic === "bot" ? <>
        <h2>O que estes três cartões querem dizer?</h2>
        <div className="help-points">
          <p><strong>Como o bot está conectado</strong> mostra qual tecnologia o Owner escolheu para conversar com WhatsApp e grupos.</p>
          <p><strong>Acesso ao provedor</strong> mostra se as credenciais necessárias já foram salvas e, quando aplicável, validadas.</p>
          <p><strong>Bot enviando mensagens agora?</strong> mostra se o servidor tem configuração suficiente para tentar entregas reais nesta execução. Isso é diferente de apenas ter escolhido um modo.</p>
          <p>Configurar aqui altera o estado salvo no servidor. Não é uma tela ilustrativa.</p>
        </div>
      </> : topic === "version" ? <>
        <h2>O painel está “se atualizando” sozinho?</h2>
        <p>Ele atualiza <strong>os dados que aparecem na tela</strong> a cada 10 segundos. Isso não instala uma nova versão e não atualiza APIs externas.</p>
        <div className="help-points">
          <p><strong>Git</strong> é o identificador da versão de código que o servidor está executando.</p>
          <p><strong>Consultar versão do servidor</strong> apenas pergunta qual versão está online naquele momento. Não faz deploy, não reinicia nada e não altera dados.</p>
          <p>Quando houver uma nova publicação real, ela precisa ser feita pelo fluxo de deploy. Depois disso, este indicador passa a mostrar o novo código.</p>
        </div>
      </> : <>
        <h2>Como funcionam moedas, pacotes e Pix?</h2>
        <p>O usuário compra um <strong>pacote de moedas</strong>. O provedor Pix processa o pagamento e avisa o SOS YouTuber quando ele foi confirmado.</p>
        <div className="help-points">
          <p><strong>Moedas e passes</strong> continuam na carteira do próprio SOS YouTuber. Trocar o provedor não apaga nem converte saldos.</p>
          <p><strong>Provedor ativo</strong> vale apenas para novas compras. Pagamentos antigos continuam ligados ao serviço que os criou.</p>
          <p><strong>Ambiente do provedor</strong> pode ser teste ou produção. Isso não é a mesma coisa que o servidor do SOS estar online.</p>
          <p><strong>Receita Pix do mês</strong> soma pagamentos reais aprovados e exclui simulações.</p>
        </div>
      </>}
      <button className="secondary" onClick={onClose}>Entendi</button>
    </section>
  </div>;
}

export function OwnerDashboard({ onLogout,onParticipate }: { onLogout:()=>void;onParticipate:()=>Promise<void> }) {
  const [month, setMonth] = useState(localMonth);
  const [data, setData] = useState<OwnerOverview>();
  const [tab, setTab] = useState<OwnerMenuTarget>("requests");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [manualName,setManualName] = useState("");
  const [phone, setPhone] = useState("");
  const [group, setGroup] = useState("1");
  const [showWhatsAppConfig,setShowWhatsAppConfig] = useState(false);
  const [showPaymentConfig,setShowPaymentConfig] = useState(false);
  const [participantPhone,setParticipantPhone] = useState<string>();
  const [helpTopic,setHelpTopic] = useState<AdminHelpTopic>();
  const [groupPage,setGroupPage]=useState(0);
  const [groupJump,setGroupJump]=useState("");
  const [manualGroupPage,setManualGroupPage]=useState(0);
  const [managedGroupCode,setManagedGroupCode]=useState<string>();
  const [showOwnerMenu,setShowOwnerMenu]=useState(false);
  const [showOwnerAvatar,setShowOwnerAvatar]=useState(false);
  const [showOwnerTeam,setShowOwnerTeam]=useState(false);

  const load = useCallback(async () => {
    try { setData(await ownerApi.overview(month)); setError(""); }
    catch (cause) { if (cause instanceof ApiError && cause.status === 401) onLogout(); else setError(cause instanceof Error ? cause.message : "Falha ao carregar painel."); }
  }, [month, onLogout]);
  useEffect(() => { void load(); const timer = window.setInterval(() => void load(), 10_000); return () => window.clearInterval(timer); }, [load]);

  async function participate(){
    setBusy(true);setError("");setNotice("");
    try{await onParticipate();}
    catch(cause){setError(cause instanceof Error?cause.message:"Não foi possível abrir a fila como administrador.");}
    finally{setBusy(false);}
  }

  async function act(work: () => Promise<unknown>, message: string) {
    setBusy(true); setError(""); setNotice("");
    try { await work(); setNotice(message); await load(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível concluir."); }
    finally { setBusy(false); }
  }
  async function addMember(event: FormEvent) {
    event.preventDefault();
    await act(async () => {
      await ownerApi.group(group,true);
      return ownerApi.approveMember(phone, group, manualName);
    }, "Autorização manual registrada com auditoria.");
    setManualName(""); setPhone("");
  }
  function jumpToGroup(event:FormEvent) {
    event.preventDefault();
    const code=Number(groupJump);
    if(!Number.isInteger(code) || code<1 || code>999) return;
    setGroupPage(Math.floor((code-1)/GROUP_PAGE_SIZE));
  }
  async function checkVersion() {
    setBusy(true); setError(""); setNotice("");
    try {
      const latest=await ownerApi.version();
      setNotice(latest.gitSha === data?.version.gitSha
        ? (latest.dirty ? "Você está vendo a mesma versão do servidor, mas existem mudanças locais ainda não publicadas." : "Você já está vendo a versão online mais recente.")
        : "O servidor está executando uma versão diferente. Recarregue o painel para atualizar os dados exibidos.");
    } catch(cause) { setError(cause instanceof Error ? cause.message : "Não foi possível verificar a versão."); }
    finally { setBusy(false); }
  }

  if (!data) return <main className="loading"><ShieldCheck /><span>Carregando painel do Owner…</span>{error && <p className="error">{error}</p>}</main>;
  const m = data.metrics;
  const groupMap=new Map(data.groups.map((item)=>[item.code,item]));
  const managedGroup=managedGroupCode ? groupMap.get(managedGroupCode) : undefined;
  const groupPageCount=Math.ceil(ALL_GROUP_CODES.length/GROUP_PAGE_SIZE);
  const groupStart=groupPage*GROUP_PAGE_SIZE;
  const visibleGroupCodes=ALL_GROUP_CODES.slice(groupStart,groupStart+GROUP_PAGE_SIZE);
  const manualPageCount=Math.ceil(ALL_GROUP_CODES.length/MANUAL_GROUP_PAGE_SIZE);
  const manualStart=manualGroupPage*MANUAL_GROUP_PAGE_SIZE;
  const manualGroupCodes=ALL_GROUP_CODES.slice(manualStart,manualStart+MANUAL_GROUP_PAGE_SIZE);

  return <div className="app-shell owner-shell">
    <header><div className="logo"><span><Youtube size={21} fill="currentColor" /></span>SOS <strong>YouTuber</strong></div><div className="header-actions"><button className="icon-button" onClick={() => void load()} aria-label="Atualizar painel" title="Atualizar"><RefreshCw size={18} /></button><button className="icon-button" onClick={()=>setShowOwnerMenu(true)} aria-label="Abrir menu do Owner" title="Menu"><Menu size={18}/></button><button className="avatar-header-button" onClick={()=>setShowOwnerAvatar(true)} aria-label={`Trocar avatar de ${data.owner.name}`} title="Trocar avatar"><UserAvatarView avatar={data.owner.avatar} name={data.owner.name} className="header-avatar"/><span className="header-admin-badge">{data.owner.role==="ROOT_OWNER"?"OWNER":"ADMIN"}</span></button><button className="profile profile-text-only" onClick={()=>setShowOwnerMenu(true)} aria-label={`Abrir menu do Owner ${data.owner.name}`}><div><strong>{data.owner.name}</strong><small>Painel administrativo</small></div></button></div></header>
    <main className="dashboard">
      <section className="owner-heading"><div><p className="eyebrow dark">GESTÃO DA COMUNIDADE</p><h1>Sua conexão, em números.</h1><p className="muted">Acompanhe adesões, aprove participantes e confira a atividade da plataforma.</p></div><label className="owner-month-label">Mês de referência<div className="owner-month-picker"><span>{monthLabel(month)}</span><input aria-label="Selecionar mês de referência" type="month" value={month} onChange={(e) => { if (e.target.value) setMonth(e.target.value); }} /></div></label></section>
      <section className="metrics-grid" aria-label="Indicadores">
        <article><Users /><span>Usuários cadastrados</span><strong>{m.registeredUsers}</strong><small>{m.approvedMembers} números autorizados</small></article>
        <article><Check /><span>Ativos nos últimos 30 dias</span><strong>{m.activeUsers30d}</strong><small>Números com acesso autenticado</small></article>
        <article><Users /><span>Solicitações no mês</span><strong>{m.requestsMonth}</strong><small>{m.requestsTotal} pessoas solicitaram · {m.pendingRequests} pendentes</small></article>
        <article><Youtube /><span>Playlists criadas no mês</span><strong>{m.playlistsCreatedMonth}</strong><small>{m.completedCyclesMonth} ciclos concluídos</small></article>
        {data.owner.permissions.canViewSensitive&&<>
          <article><Check /><span>Compras Pix aprovadas</span><strong>{m.approvedPurchasesMonth}</strong><small>{m.coinsPackagePurchasesMonth} pacote(s) de moedas · {m.passPurchasesMonth} passe(s) · {m.demoPurchasesMonth} simulações</small></article>
          <article><ShieldCheck /><span>Receita Pix do mês</span><strong>{money(m.revenueCentsMonth)}</strong><small>Moedas {money(m.coinsPackageRevenueCentsMonth)} · Passes {money(m.passRevenueCentsMonth)}{m.legacyRevenueCentsMonth ? ` · Legado ${money(m.legacyRevenueCentsMonth)}` : ""}</small></article>
        </>}
      </section>

      <section className="owner-panel integration-overview" aria-label="Integração WhatsApp">
        <div className="integration-overview-head"><div><p className="eyebrow dark">AUTOMAÇÃO E VALIDAÇÃO</p><div className="heading-with-help"><h2 className="bot-config-title"><Bot size={22}/>{data.owner.permissions.canConfigure?"Configurar bot SOS YouTuber":"Bot SOS YouTuber"}</h2><button className="help-icon" aria-label="Explicar o painel do bot" onClick={()=>setHelpTopic("bot")}><HelpCircle size={18}/></button></div></div>{data.owner.permissions.canConfigure&&<button className="primary compact integration-config-button" onClick={()=>setShowWhatsAppConfig(true)}><Settings2 size={17}/>{data.whatsapp.integration.businessAccountId || data.whatsapp.integration.phoneNumberId || data.whatsapp.integration.accessTokenConfigured || data.whatsapp.integration.evolutionUrl || data.whatsapp.integration.evolutionApiKeyConfigured ? "Modificar integração" : "Configurar integração"}</button>}</div>
        <div className="integration-summary-grid">
          <div className={`integration-mode-card mode-${data.whatsapp.integration.mode.toLowerCase()}`}><span>Modo escolhido para o bot</span><strong>{data.whatsapp.integration.mode === "META_GROUPS" ? <><b className="summary-mode-symbol summary-hybrid-icons" aria-hidden="true"><span>∞</span><Youtube size={14} fill="currentColor"/></b> Meta + Grupos</> : data.whatsapp.integration.mode === "EVOLUTION" ? <><b className="summary-mode-symbol">E</b> Evolution Gateway</> : data.whatsapp.integration.mode === "DISABLED" ? "Desativado" : <><b className="summary-mode-symbol">∞</b> Meta oficial</>}</strong><small>{data.whatsapp.integration.mode === "META_GROUPS" ? "Meta envia mensagens; o complemento ajuda a conferir grupos." : data.whatsapp.integration.mode === "EVOLUTION" ? "Usa o gateway Evolution configurado pelo Owner." : data.whatsapp.integration.mode === "DISABLED" ? "Envios externos pausados; administração manual continua disponível." : "Usa o WhatsApp oficial da Meta para mensagens."}</small></div>
          <div><span>{data.whatsapp.integration.mode === "EVOLUTION" ? "Chaves do Evolution" : "Chave de acesso"}</span><strong>{data.whatsapp.integration.mode === "EVOLUTION" ? (data.whatsapp.integration.evolutionUrl && data.whatsapp.integration.evolutionInstance && data.whatsapp.integration.evolutionApiKeyConfigured ? "PRONTA" : "FALTAM DADOS") : data.whatsapp.integration.tokenValidatedAt ? "PRONTA" : data.whatsapp.integration.accessTokenConfigured ? "SALVA · FALTA VALIDAR" : "FALTA CONFIGURAR"}</strong><small>{data.whatsapp.integration.mode === "EVOLUTION" ? (data.whatsapp.integration.evolutionApiKeyConfigured ? "Credenciais protegidas e salvas no servidor." : "Abra “Configurar integração” e preencha os dados do Evolution.") : data.whatsapp.integration.tokenValidatedAt ? `Credencial confirmada pela Meta em ${date(data.whatsapp.integration.tokenValidatedAt)}.` : data.whatsapp.integration.accessTokenConfigured ? "A chave foi salva, mas ainda precisa ser validada com a Meta." : "Abra “Configurar integração” e informe a chave fornecida pela Meta."}</small></div>
          <div className={`transport-status-card ${data.whatsapp.configured ? "active" : "inactive"}`}><span>Envio automático</span><strong>{data.whatsapp.configured ? "FUNCIONANDO" : "PARADO"}</strong><small>{data.whatsapp.queued} aguardando · {data.whatsapp.failed} com erro · {data.whatsapp.sent} aceitas pelo serviço escolhido.</small></div>
        </div>
        <p className="muted">{data.whatsapp.groupsLinked > 0 ? `${data.whatsapp.groupsLinked} grupo(s) confirmado(s) pela integração · ${data.whatsapp.automaticMemberships} associação(ões) feitas automaticamente.` : "Nenhum grupo externo foi confirmado pela integração ainda. Os Owners continuam podendo conferir e administrar os grupos pelo painel."}</p>
        {data.owner.permissions.canConfigure&&<div className="ready-actions">{data.whatsapp.groupsSyncEnabled && <button className="secondary" disabled={busy || !data.whatsapp.configured} onClick={() => void act(() => ownerApi.syncWhatsAppGroups(),"Consulta dos grupos concluída.")}>Atualizar grupos agora</button>}{data.whatsapp.failed>0 && <button className="secondary" disabled={busy} onClick={() => void act(() => ownerApi.retryWhatsApp(),"Mensagens com erro foram recolocadas na fila.")}>Tentar novamente mensagens com erro</button>}</div>}
      </section>

      <div className="owner-version"><span><strong>Painel sincronizado com o servidor</strong> · dados desta tela atualizados a cada 10 s{data.version.dirty ? " · há mudanças locais ainda não publicadas" : ""}</span><button className="field-help-button owner-version-help" aria-label="Explicar versão e sincronização do painel" onClick={()=>setHelpTopic("version")}><HelpCircle size={14}/></button><button className="text-button" disabled={busy} onClick={()=>void checkVersion()}><RefreshCw size={14}/>Conferir versão online</button></div>
      {error && <p className="error banner" role="alert">{error}</p>}
      {notice && <div className="notice" role="status"><Check size={19} /><span>{notice}</span></div>}

      <nav className="owner-tabs" aria-label="Seções administrativas">
        {([["requests", "Solicitações ("+m.pendingRequests+")"], ["users", "Participantes"], ...(data.owner.permissions.canViewSensitive ? [["purchases","Compras"] as const] : []), ["groups", "Grupos e acesso"], ["removed", "Removidas ("+m.deletedUsers+")"]] as const).map(([key, title]) => <button key={key} className={tab === key ? "active" : ""} aria-pressed={tab === key} onClick={(event) => { setTab(key); event.currentTarget.scrollIntoView({behavior:"smooth",block:"nearest",inline:"center"}); }}>{title}</button>)}
      </nav>

      {tab==="requests" && data.owner.permissions.canManageOwners && <GoogleIdentityRequests/>}
      {tab === "requests" && <section className="owner-panel">
        <h2>Solicitações de cadastro</h2>
        <p className="muted">A decisão do Owner é preservada com data e autoria. Registros aprovados permanecem visíveis, mas deixam de mostrar qualquer texto de pendência.</p>
        {data.requests.length === 0 ? <div className="empty-state"><Users /><p>As novas solicitações aparecerão aqui.</p></div> : <div className="request-list">{data.requests.map((item) => <article className={`request-card request-card-${item.status.toLowerCase()}`} key={item.id}>
          <div>
            {item.status === "PENDING" ? <div className="request-badges"><span className="new-user-badge">Novo Usuário!</span><span className="request-state pending">🔴 Registro pendente</span></div> : item.status === "APPROVED" ? <span className="request-state approved">🟢 Usuário aprovado!</span> : <span className="request-state declined">⚪ Solicitação não aprovada</span>}
            <strong>{item.name}</strong>
            <span>{item.phone} · {date(item.createdAt)} · {item.source === "WHATSAPP" ? "Recebido pelo WhatsApp" : item.source === "OWNER_MANUAL" ? "Cadastro manual Owner" : "Solicitação web"}</span>
            {item.status === "APPROVED" && <small>Aprovado em {date(item.approvedAt)} por {item.approvedByOwnerName ?? "Owner não identificado (registro legado)"}</small>}
          </div>
          {item.status === "PENDING" && <div className="request-actions auto-group-actions">
            <div className={item.preferredGroup ? "detected-group ok":"detected-group pending"}><ShieldCheck size={16}/><div><strong>{item.preferredGroup ? `SOS YOUTUBER ${item.preferredGroup}` : "Grupo ainda não confirmado"}</strong><span>{item.preferredGroup ? "Detectado pelo vínculo/verificação do número." : "Sincronize a integração para localizar este WhatsApp no grupo correto."}</span></div></div>
            <button className="primary compact" disabled={busy || !item.preferredGroup} onClick={() => void act(() => ownerApi.decide(item.id, "APPROVED"), "Aprovação do Owner registrada.")}>Aprovar</button>
            <button className="secondary" disabled={busy} onClick={() => void act(() => ownerApi.decide(item.id, "DECLINED"), "Solicitação marcada como não aprovada.")}>Recusar</button>
            {!item.preferredGroup && <button className="text-button request-sync-button" disabled={busy} onClick={() => void act(() => ownerApi.syncWhatsAppGroups(), "Grupos e participantes sincronizados; a solicitação será reavaliada.")}><RefreshCw size={15}/>Sincronizar grupos</button>}
          </div>}
        </article>)}</div>}
      </section>}

      {tab === "users" && <section className="owner-panel">
        <div className="section-title"><div><h2>Participantes</h2><p className="muted">Clique no nome para abrir o painel administrativo individual.</p></div>{data.owner.permissions.canExport&&<button className="secondary" disabled={busy} onClick={() => void act(() => ownerApi.exportUsers(), "Exportação de usuários concluída.")}><Download size={16} /> Exportar CSV</button>}</div>
        <div className="table-scroll"><table><thead><tr><th>Nome / WhatsApp</th><th>Grupo</th><th>Aprovação</th><th>Último acesso</th><th>Saldo</th><th>Estado</th></tr></thead><tbody>
          {data.users.map((u) => <tr key={u.id}><td><div className="owner-user-cell"><button className="participant-link" onClick={()=>setParticipantPhone(u.phone)}>{u.name}</button>{u.youtubeChannelTitle&&<span className="owner-channel-identity">{u.youtubeChannelThumbnailUrl?<img src={u.youtubeChannelThumbnailUrl} alt=""/>:<Youtube size={15}/>}<b>{u.youtubeChannelTitle}</b></span>}<small>{u.phone}</small></div></td><td>SOS {u.groupCode}</td><td><strong>{date(u.approvedAt)}</strong><small>por {u.approvedByOwnerName ?? "Owner não identificado"}</small></td><td>{u.lastSeenAt ? date(u.lastSeenAt) : "Ainda não acessou"}</td><td><strong>{coins(u.balanceMillis)} moedas</strong><small>{u.extraPasses} passe{u.extraPasses===1?"":"s"}</small></td><td>{u.revokedAt ? <span className="table-status off">Revogado</span> : u.paymentHold ? <span className="table-status warn">Em revisão</span> : <span className="table-status on">Ativo</span>}</td></tr>)}
        </tbody></table>{!data.users.length && <p className="muted">Nenhum participante aprovado ainda.</p>}</div>
        <div className="deleted-accounts-section">
          <div className="section-title admin-subtitle"><div><p className="eyebrow dark">CONTAS REMOVIDAS</p><h3>Histórico mínimo de auditoria</h3></div><span>{m.deletedUsers} remoção(ões)</span></div>
          <p className="muted">Quando uma pessoa exclui a própria conta, dados pessoais e acessos são removidos. Mantemos apenas o ID e totais mínimos necessários para integridade financeira e auditoria.</p>
          {!data.deletedAccounts.length ? <p className="muted">Nenhuma conta removida.</p> : <div className="table-scroll"><table><thead><tr><th>ID removido</th><th>Grupo</th><th>Data</th><th>Atividade anterior</th><th>Compras preservadas</th></tr></thead><tbody>
            {data.deletedAccounts.map((item)=><tr key={item.userId}><td><code>{item.userId}</code></td><td>SOS {item.groupCode ?? "—"}</td><td>{date(item.deletedAt)}</td><td>{item.submissionsCount} URL(s) · {item.roundsCount} fila(s)</td><td>{money(item.approvedPaymentCents)} · {coins(item.coinsPurchasedMillis)} moedas · {item.passesPurchased} passe(s)</td></tr>)}
          </tbody></table></div>}
        </div>
      </section>}

      {tab === "purchases" && data.owner.permissions.canViewSensitive && <section className="owner-panel purchases-admin-panel">
        <div className="section-title"><div><div className="heading-with-help"><h2>Pacotes de moedas e pagamentos</h2><button className="help-icon" aria-label="Explicar pagamentos e moedas" onClick={()=>setHelpTopic("payments")}><HelpCircle size={18}/></button></div><p className="muted">As moedas e passes continuam na carteira do usuário. {data.owner.permissions.canConfigure?"Aqui você escolhe quem processa novas compras e acompanha a trilha financeira.":"Você pode acompanhar compras e receita; a configuração do provedor fica protegida para o Owner principal."}</p></div>{data.owner.permissions.canConfigure&&<button className="primary compact" onClick={()=>setShowPaymentConfig(true)}><Settings2 size={17}/>Configurar pagamentos</button>}</div>
        <div className="payment-owner-summary">
          <article><span>Provedor ativo</span><strong>{paymentProviderName(data.payments.provider)}</strong><small>{data.payments.provider==="DISABLED" ? "Novas compras reais estão desativadas." : "Usado para novas compras de pacotes."}</small></article>
          <article><span>Conta do provedor</span><strong>{data.payments.provider==="DISABLED" ? "—" : data.payments.environment==="PRODUCTION" ? "PRODUÇÃO" : "TESTE"}</strong><small>{data.payments.provider==="DISABLED" ? "Escolha um provedor para definir teste ou produção." : data.payments.environment==="PRODUCTION" ? "Pode receber pagamentos reais com credenciais válidas." : "Usa credenciais de teste do provedor."}</small></article>
          <article><span>Pronto para receber Pix?</span><strong>{data.payments.provider==="DISABLED" ? "DESLIGADO" : data.payments.ready ? "SIM" : "AINDA NÃO"}</strong><small>{data.payments.provider==="DISABLED" ? "Novas compras reais estão bloqueadas." : data.payments.ready ? "Os dados mínimos necessários estão salvos." : "Abra a configuração para concluir os dados."}</small></article>
        </div>
        <p className="muted">Trocar o provedor ativo afeta somente novas compras. Pagamentos antigos continuam associados ao provedor que os criou e podem ser conciliados normalmente.</p>
        <div className="table-scroll"><table><thead><tr><th>Participante</th><th>Produto</th><th>Valor</th><th>Provedor</th><th>Status</th><th>Data</th></tr></thead><tbody>{data.purchases.map((p) => <tr key={p.id}><td>{p.userDeletedAt ? <><strong>Conta removida</strong><small>ID {p.userId}</small></> : <><button className="participant-link" onClick={()=>setParticipantPhone(p.phone)}>{p.name}</button><small>{p.phone}</small></>}</td><td><strong>{paymentProductName(p.productCode)}</strong><small>{p.creditsMillis/1000} moeda(s) · {p.extraPasses} passe(s)</small></td><td>{money(p.amountCents)}</td><td>{paymentProviderName(p.provider)}</td><td>{p.status}</td><td>{date(p.approvedAt ?? p.createdAt)}</td></tr>)}</tbody></table>{!data.purchases.length && <p className="muted">Nenhuma compra registrada.</p>}</div>
      </section>}

      {tab === "groups" && <section className="owner-panel groups-admin-panel">
        <div className="groups-heading"><div><div className="heading-with-help"><h2>Grupos e acesso</h2><button className="help-icon" aria-label="Explicar grupos e acesso" onClick={()=>setHelpTopic("groups")}><HelpCircle size={18}/></button></div><p className="muted">{data.owner.permissions.canConfigure?"Controle habilitação interna, vínculo externo confirmado, verificação e link de entrada de cada grupo.":"Visualização operacional dos grupos. Alterações de vínculo, ativação e configuração são exclusivas de um Owner principal."}</p></div><span className="live-chip"><RefreshCw size={13}/>Painel sincroniza a cada 10 s</span></div>
        <div className="group-carousel-meta"><strong>Grupos {groupStart+1}–{Math.min(groupStart+GROUP_PAGE_SIZE,999)} de 999</strong><span>{data.owner.permissions.canConfigure?"Todos os números podem ser ativados e administrados.":"Modo somente leitura para Administrador delegado."}</span></div>
        <div className="group-carousel-shell">
          <button className="carousel-arrow" aria-label="Grupos anteriores" disabled={groupPage===0} onClick={()=>setGroupPage((page)=>Math.max(0,page-1))}><ChevronLeft/></button>
          <div className="group-carousel">{visibleGroupCodes.map((code) => {
            const stored=groupMap.get(code);
            const enabled=Boolean(stored?.enabled);
            const members=data.members.filter((m)=>m.groupCode===code && !m.revokedAt).length;
            return <article className={`group-admin-card ${enabled ? "enabled":"disabled"}`} key={code}>
              <div className="group-card-top"><span className="group-index">SOS YOUTUBER {code}</span><span className={enabled ? "table-status on":"table-status off"}>{enabled ? "Habilitado no SOS":stored ? "Pausado":"Não configurado"}</span></div>
              <strong>{members} participante{members===1?"":"s"} com acesso</strong>
              <small>Vínculo externo: {stored?.whatsappGroupId || stored?.verificationProvider ? "confirmado por integração" : "não confirmado"}</small>
              <small>Verificação: {stored?.verificationProvider ?? (stored?.membershipMode === "META_GROUPS_API" ? "Meta / prova externa" : "Owner / interna")}</small>
              {data.owner.permissions.canConfigure
                ? <div className="group-card-actions">
                    <button className="secondary" disabled={busy} onClick={()=>setManagedGroupCode(code)}>Gerenciar</button>
                    <button className={enabled ? "secondary":"primary compact"} disabled={busy} onClick={() => void act(() => ownerApi.group(code,!enabled), enabled ? `SOS YOUTUBER ${code} pausado; dados preservados.` : `SOS YOUTUBER ${code} habilitado no SOS.`)}>{enabled ? "Pausar":"Habilitar"}</button>
                  </div>
                : <small className="group-readonly-note"><ShieldCheck size={13}/>Configuração protegida</small>}
            </article>;
          })}</div>
          <button className="carousel-arrow" aria-label="Próximos grupos" disabled={groupPage>=groupPageCount-1} onClick={()=>setGroupPage((page)=>Math.min(groupPageCount-1,page+1))}><ChevronRight/></button>
        </div>

        <form className="group-jump-form" onSubmit={jumpToGroup}><label>Ir para o grupo<input inputMode="numeric" pattern="[1-9][0-9]{0,2}" maxLength={3} value={groupJump} onChange={(e)=>setGroupJump(e.target.value.replace(/\D/g,"").slice(0,3))} placeholder="Ex.: 347"/></label><button className="secondary">Localizar no carrossel</button></form>

        <div className="manual-access-section">
          <div className="heading-with-help"><h3>Autorização manual excepcional</h3><button className="help-icon" aria-label="Explicar autorização manual" onClick={()=>setHelpTopic("manual")}><HelpCircle size={18}/></button></div>
          <p className="muted">Use quando você já conferiu a pessoa fora do fluxo normal de solicitações. O registro fica associado ao Owner responsável.</p>
          <form className="manual-access-form modern-manual-form" onSubmit={addMember}>
            <div className="field-block"><label htmlFor="manual-name">Nome</label><input id="manual-name" value={manualName} onChange={(e)=>setManualName(e.target.value)} placeholder="Nome do participante" required /></div>
            <div className="field-block"><label htmlFor="manual-whatsapp">WhatsApp</label><PhoneField id="manual-whatsapp" value={phone} onChange={setPhone} required/><small className="field-help-copy">Código do país + DDD + Número do WhatsApp.</small></div>
            <div className="manual-group-field">
              <div className="manual-group-heading"><strong>Grupo</strong><span>SOS YOUTUBER {group}</span></div>
              <div className="manual-group-picker">
                <button type="button" className="carousel-arrow" aria-label="Grupos manuais anteriores" disabled={manualGroupPage===0} onClick={()=>setManualGroupPage((page)=>Math.max(0,page-1))}><ChevronLeft/></button>
                <div className="manual-group-rail">{manualGroupCodes.map((code)=><button type="button" className={code===group ? "selected":""} key={code} onClick={()=>setGroup(code)}>{code}</button>)}</div>
                <button type="button" className="carousel-arrow" aria-label="Próximos grupos manuais" disabled={manualGroupPage>=manualPageCount-1} onClick={()=>setManualGroupPage((page)=>Math.min(manualPageCount-1,page+1))}><ChevronRight/></button>
              </div>
              <small className="field-help-copy">Escolha de 1 a 999. Se o grupo ainda não estiver ativo, ele será ativado antes da autorização.</small>
            </div>
            <button className="primary compact" disabled={busy || !manualName.trim() || !isCompletePhoneField(phone)}>Registrar autorização</button>
          </form>
        </div>

        <div className="table-scroll compact-access-table"><table><thead><tr><th>WhatsApp</th><th>Grupo</th><th>Aprovado em</th><th>Owner</th><th>Estado</th></tr></thead><tbody>{data.members.map((m) => <tr key={m.phone}><td><button className="participant-link" onClick={()=>setParticipantPhone(m.phone)}>{m.phone}</button></td><td>SOS {m.groupCode}</td><td>{date(m.approvedAt)}</td><td>{m.approvedByOwnerName ?? "Registro legado"}</td><td>{m.revokedAt ? "Revogado" : "Autorizado"}</td></tr>)}</tbody></table></div>
      </section>}

      {tab === "removed" && <section className="owner-panel removed-accounts-panel">
        <div className="section-title"><div><h2>Contas removidas</h2><p className="muted">Quando o próprio usuário apaga a conta, o SOS remove os dados operacionais e mantém somente um tombstone anônimo para auditoria e integridade financeira.</p></div><span>{data.deletedAccounts.length} registro{data.deletedAccounts.length===1?"":"s"}</span></div>
        <div className="table-scroll"><table><thead><tr><th>ID removido</th><th>Grupo anterior</th><th>Removido em</th><th>Atividade histórica</th><th>Compras confirmadas</th></tr></thead><tbody>
          {data.deletedAccounts.map((item)=><tr key={item.userId}><td><code>{item.userId}</code><small>{item.source==="USER_SELF_SERVICE"?"Exclusão solicitada pelo usuário":item.source}</small></td><td>{item.groupCode ? "SOS "+item.groupCode : "—"}</td><td>{date(item.deletedAt)}</td><td><strong>{item.submissionsCount} URLs</strong><small>{item.roundsCount} fila{item.roundsCount===1?"":"s"}</small></td><td><strong>{money(item.approvedPaymentCents)}</strong><small>{item.coinsPurchasedMillis/1000} moedas · {item.passesPurchased} passe{item.passesPurchased===1?"":"s"}</small></td></tr>)}
        </tbody></table>{!data.deletedAccounts.length&&<p className="muted">Nenhuma conta foi removida até agora.</p>}</div>
      </section>}

      <footer><ShieldCheck size={17} /><span>Dados de contato e controles desta área são exclusivos do Owner. Indicadores mensais usam o fuso de Salvador.</span></footer>
    </main>

    {showOwnerMenu && <OwnerDeskMenu data={data} onClose={()=>setShowOwnerMenu(false)} onNavigate={(target:OwnerMenuTarget)=>setTab(target)} onWhatsApp={()=>setShowWhatsAppConfig(true)} onPayments={()=>setShowPaymentConfig(true)} onRefresh={()=>void load()} onVersion={()=>void checkVersion()} onLogout={onLogout} onParticipate={()=>void participate()} onManageOwners={()=>setShowOwnerTeam(true)} onAvatarChanged={(avatar)=>{setData((current)=>current?{...current,owner:{...current.owner,avatar}}:current);void load();}}/>}
    {showOwnerTeam&&<OwnerTeamModal onClose={()=>setShowOwnerTeam(false)}/>}
    {showOwnerAvatar && <AvatarModal name={data.owner.name} current={data.owner.avatar} onClose={()=>setShowOwnerAvatar(false)} onChanged={(avatar)=>{setData((current)=>current?{...current,owner:{...current.owner,avatar}}:current);void load();}} saveAvatar={ownerApi.saveAvatar} title="Escolha seu avatar"/>}
    {showWhatsAppConfig && <WhatsAppIntegrationModal initial={data.whatsapp.integration} onClose={()=>setShowWhatsAppConfig(false)} onSaved={(_state,message)=>{ setNotice(message); void load(); }} />}
    {showPaymentConfig && <PaymentIntegrationModal initial={data.payments} onClose={()=>setShowPaymentConfig(false)} onSaved={(_state,message)=>{ setNotice(message); void load(); }} />}
    {participantPhone && <ParticipantAdminModal phone={participantPhone} groups={data.groups} onClose={()=>setParticipantPhone(undefined)} onChanged={(next)=>{ if(next) setParticipantPhone(next); void load(); }} />}
    {managedGroup && <GroupAdminModal
      key={managedGroup.code}
      group={managedGroup}
      busy={busy}
      onClose={()=>setManagedGroupCode(undefined)}
      onToggle={()=>act(()=>ownerApi.group(managedGroup.code,!Boolean(managedGroup.enabled)),Boolean(managedGroup.enabled) ? "Grupo pausado; dados preservados." : "Grupo habilitado no SOS.")}
      onSaveLink={(joinUrl)=>act(()=>ownerApi.groupSettings(managedGroup.code,joinUrl),joinUrl ? "Link do grupo salvo no servidor." : "Link do grupo removido.")}
    />}
    {helpTopic && <AdminHelpModal topic={helpTopic} onClose={()=>setHelpTopic(undefined)} />}
  </div>;
}
