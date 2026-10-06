import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Bot, Check, ChevronLeft, ChevronRight, Download, HelpCircle, LogOut, RefreshCw, Settings2, ShieldCheck, Users, Youtube } from "lucide-react";
import { ApiError, ownerApi, type OwnerOverview } from "./api";
import { WhatsAppIntegrationModal } from "./WhatsAppIntegrationModal";
import { ParticipantAdminModal } from "./ParticipantAdminModal";
import { PhoneField, isCompletePhoneField } from "./PhoneField";

function localMonth() {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bahia", year: "numeric", month: "2-digit" }).formatToParts(new Date());
  return `${parts.find((p) => p.type === "year")!.value}-${parts.find((p) => p.type === "month")!.value}`;
}
const date = (value?: string) => value ? new Date(value).toLocaleString("pt-BR") : "—";
const money = (cents: number) => (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const coins = (millis: number) => (millis / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 3 });
const GROUP_PAGE_SIZE=12;
const MANUAL_GROUP_PAGE_SIZE=12;
const ALL_GROUP_CODES=Array.from({length:999},(_,index)=>String(index+1));

function AdminHelpModal({ topic, onClose }: { topic: "groups" | "manual"; onClose: () => void }) {
  return <div className="modal-backdrop admin-help-backdrop" onMouseDown={onClose}>
    <section className="modal admin-help-modal" role="dialog" aria-modal="true" aria-label={topic === "groups" ? "Ajuda sobre grupos e acesso" : "Ajuda sobre autorização manual"} onMouseDown={(e)=>e.stopPropagation()}>
      <button className="close" aria-label="Fechar ajuda" onClick={onClose}>×</button>
      <p className="eyebrow dark">AJUDA ADMINISTRATIVA</p>
      {topic === "groups" ? <>
        <h2>Para que servem estes grupos?</h2>
        <p>Os cards representam os grupos <strong>SOS YOUTUBER</strong> aceitos pelo sistema. Eles não são filas de vídeos: são grupos de acesso dos participantes.</p>
        <div className="help-points">
          <p><strong>Ativo</strong> permite login e novas aprovações naquele grupo. <strong>Pausado</strong> suspende novos acessos sem apagar usuários, saldos ou histórico.</p>
          <p><strong>Validação Owner</strong> significa que a autorização é feita manualmente pelos Owners. Quando uma integração externa de grupo estiver realmente validada, o card indicará esse modo separadamente.</p>
          <p>Os grupos aparecem em carrossel porque podem crescer de 1 até 999 sem transformar a tela em uma lista longa. A tela mostra apenas controles administrativos; nenhum participante vê este painel.</p>
        </div>
      </> : <>
        <h2>O que é autorização manual?</h2>
        <p>É uma rota administrativa excepcional para um participante que você já conferiu fora da fila normal de solicitações.</p>
        <div className="help-points">
          <p>O Owner informa <strong>nome + WhatsApp + grupo</strong>. O sistema cria um registro administrativo com data, origem <code>OWNER_MANUAL</code> e nome do Owner responsável.</p>
          <p>Use a aba <strong>Solicitações</strong> como caminho padrão. A autorização manual existe para correções, migrações ou casos já validados por você.</p>
          <p>Se o grupo estiver usando uma verificação externa obrigatória, a aprovação manual fica registrada, mas o acesso só é liberado quando as demais provas exigidas estiverem presentes.</p>
        </div>
      </>}
      <button className="secondary" onClick={onClose}>Entendi</button>
    </section>
  </div>;
}

export function OwnerDashboard({ onLogout }: { onLogout: () => void }) {
  const [month, setMonth] = useState(localMonth);
  const [data, setData] = useState<OwnerOverview>();
  const [tab, setTab] = useState<"requests" | "users" | "purchases" | "groups">("requests");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [manualName,setManualName] = useState("");
  const [phone, setPhone] = useState("");
  const [group, setGroup] = useState("1");
  const [selections, setSelections] = useState<Record<string, string>>({});
  const [showWhatsAppConfig,setShowWhatsAppConfig] = useState(false);
  const [participantPhone,setParticipantPhone] = useState<string>();
  const [helpTopic,setHelpTopic] = useState<"groups"|"manual">();
  const [groupPage,setGroupPage]=useState(0);
  const [groupJump,setGroupJump]=useState("");
  const [manualGroupPage,setManualGroupPage]=useState(0);

  const load = useCallback(async () => {
    try { setData(await ownerApi.overview(month)); setError(""); }
    catch (cause) { if (cause instanceof ApiError && cause.status === 401) onLogout(); else setError(cause instanceof Error ? cause.message : "Falha ao carregar painel."); }
  }, [month, onLogout]);
  useEffect(() => { void load(); const timer = window.setInterval(() => void load(), 10_000); return () => window.clearInterval(timer); }, [load]);

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
        ? `Você já está na versão Git ${latest.gitSha}${latest.dirty ? " · há WIP local ainda não commitado." : "."}`
        : `O servidor está na versão Git ${latest.gitSha}. Recarregue o painel para usar a versão mais recente.`);
    } catch(cause) { setError(cause instanceof Error ? cause.message : "Não foi possível verificar a versão."); }
    finally { setBusy(false); }
  }

  if (!data) return <main className="loading"><ShieldCheck /><span>Carregando painel do Owner…</span>{error && <p className="error">{error}</p>}</main>;
  const m = data.metrics;
  const activeGroups = data.groups.filter((item) => item.enabled);
  const groupMap=new Map(data.groups.map((item)=>[item.code,item]));
  const groupPageCount=Math.ceil(ALL_GROUP_CODES.length/GROUP_PAGE_SIZE);
  const groupStart=groupPage*GROUP_PAGE_SIZE;
  const visibleGroupCodes=ALL_GROUP_CODES.slice(groupStart,groupStart+GROUP_PAGE_SIZE);
  const manualPageCount=Math.ceil(ALL_GROUP_CODES.length/MANUAL_GROUP_PAGE_SIZE);
  const manualStart=manualGroupPage*MANUAL_GROUP_PAGE_SIZE;
  const manualGroupCodes=ALL_GROUP_CODES.slice(manualStart,manualStart+MANUAL_GROUP_PAGE_SIZE);

  return <div className="app-shell owner-shell">
    <header><div className="logo"><span><Youtube size={21} fill="currentColor" /></span>Conexão <strong>Youtube</strong></div><div className="header-actions"><button className="icon-button" onClick={() => void load()} aria-label="Atualizar painel"><RefreshCw size={18} /></button><button className="profile" onClick={onLogout} aria-label={`Sair da conta de ${data.owner.name}`}><span><ShieldCheck size={19} /></span><div><strong>{data.owner.name}</strong><small>Painel administrativo</small></div><LogOut size={16} /></button></div></header>
    <main className="dashboard">
      <section className="owner-heading"><div><p className="eyebrow dark">GESTÃO DA COMUNIDADE</p><h1>Sua conexão, em números.</h1><p className="muted">Acompanhe adesões, aprove participantes e confira a atividade da plataforma.</p></div><label>Mês de referência<input type="month" value={month} onChange={(e) => { if (e.target.value) setMonth(e.target.value); }} /></label></section>
      <section className="metrics-grid" aria-label="Indicadores">
        <article><Users /><span>Usuários cadastrados</span><strong>{m.registeredUsers}</strong><small>{m.approvedMembers} números autorizados</small></article>
        <article><Check /><span>Ativos nos últimos 30 dias</span><strong>{m.activeUsers30d}</strong><small>Números com acesso autenticado</small></article>
        <article><Users /><span>Solicitações no mês</span><strong>{m.requestsMonth}</strong><small>{m.requestsTotal} pessoas solicitaram · {m.pendingRequests} pendentes</small></article>
        <article><Youtube /><span>Playlists criadas no mês</span><strong>{m.playlistsCreatedMonth}</strong><small>{m.completedCyclesMonth} ciclos concluídos</small></article>
        <article><Check /><span>Pacotes Pix aprovados</span><strong>{m.approvedPurchasesMonth}</strong><small>{m.demoPurchasesMonth} simulações, contadas separadamente</small></article>
        <article><ShieldCheck /><span>Receita Pix do mês</span><strong>{money(m.revenueCentsMonth)}</strong><small>Aprovados; simulações excluídas</small></article>
      </section>

      <section className="owner-panel integration-overview" aria-label="Integração WhatsApp">
        <div className="integration-overview-head"><div><p className="eyebrow dark">AUTOMAÇÃO E VALIDAÇÃO</p><h2 className="bot-config-title"><Bot size={22}/>CONFIGURAR BOT SOS YOUTUBE</h2></div><button className="primary compact integration-config-button" onClick={()=>setShowWhatsAppConfig(true)}><Settings2 size={17}/>{data.whatsapp.integration.businessAccountId || data.whatsapp.integration.phoneNumberId || data.whatsapp.integration.accessTokenConfigured || data.whatsapp.integration.evolutionUrl || data.whatsapp.integration.evolutionApiKeyConfigured ? "Modificar integração" : "Configurar integração"}</button></div>
        <div className="integration-summary-grid">
          <div className={`integration-mode-card mode-${data.whatsapp.integration.mode.toLowerCase()}`}><span>Modo</span><strong>{data.whatsapp.integration.mode === "META_GROUPS" ? <><b className="summary-mode-symbol summary-hybrid-icons" aria-hidden="true"><span>∞</span><Youtube size={14} fill="currentColor"/></b> Meta + Grupos</> : data.whatsapp.integration.mode === "EVOLUTION" ? <><b className="summary-mode-symbol">E</b> Evolution Gateway</> : data.whatsapp.integration.mode === "DISABLED" ? "Desativado" : <><b className="summary-mode-symbol">∞</b> Meta oficial</>}</strong><small>{data.whatsapp.integration.mode === "META_GROUPS" ? "Meta para mensagens + WPPConnect para grupos tradicionais." : data.whatsapp.integration.mode === "EVOLUTION" ? "Gateway independente configurado pelo Owner." : data.whatsapp.integration.mode === "DISABLED" ? "Automação externa pausada; gestão manual continua disponível." : "WhatsApp Business Platform como canal principal."}</small></div>
          <div><span>{data.whatsapp.integration.mode === "EVOLUTION" ? "Evolution Gateway" : "Credenciais Meta"}</span><strong>{data.whatsapp.integration.mode === "EVOLUTION" ? (data.whatsapp.integration.evolutionUrl && data.whatsapp.integration.evolutionInstance && data.whatsapp.integration.evolutionApiKeyConfigured ? "Configurado" : "Configurar") : data.whatsapp.integration.tokenValidatedAt ? "Validadas" : data.whatsapp.integration.accessTokenConfigured ? "Salvas · validar" : "Token necessário"}</strong><small>{data.whatsapp.integration.mode === "EVOLUTION" ? (data.whatsapp.integration.evolutionApiKeyConfigured ? "API key protegida no servidor; endpoint e instância persistidos." : "Informe endpoint, instância e API key no modal.") : data.whatsapp.integration.tokenValidatedAt ? `Última validação: ${date(data.whatsapp.integration.tokenValidatedAt)}` : "Enquanto não houver token validado, envio real pela API oficial permanece indisponível."}</small></div>
          <div className={`transport-status-card ${data.whatsapp.configured ? "active" : "inactive"}`}><span>Transporte nesta execução</span><strong>{data.whatsapp.configured ? "ATIVO ✅" : "AINDA INATIVO"}</strong><small>{data.whatsapp.queued} na fila · {data.whatsapp.failed} falhas · {data.whatsapp.sent} aceitas pelo provedor.</small></div>
        </div>
        <p className="muted">{data.whatsapp.groupsLinked > 0 ? `${data.whatsapp.groupsLinked} grupo(s) SOS oficial(is) vinculado(s) · ${data.whatsapp.automaticMemberships} associação(ões) automática(s).` : "Nenhum grupo SOS oficial sincronizado ainda. A conferência Owner permanece disponível e Meta + Grupos pode complementar grupos tradicionais."}</p>
        <div className="ready-actions">{data.whatsapp.groupsSyncEnabled && <button className="secondary" disabled={busy || !data.whatsapp.configured} onClick={() => void act(() => ownerApi.syncWhatsAppGroups(),"Sincronização dos grupos SOS concluída.")}>Sincronizar grupos agora</button>}{data.whatsapp.failed>0 && <button className="secondary" disabled={busy} onClick={() => void act(() => ownerApi.retryWhatsApp(),"Mensagens elegíveis recolocadas na fila.")}>Repetir envios com falha</button>}</div>
      </section>

      <div className="owner-version"><span>Sistema <strong>v{data.version.appVersion}</strong> · Git <code>{data.version.gitSha}</code>{data.version.dirty ? " · WIP local" : ""} · atualização automática a cada 10 s</span><button className="text-button" disabled={busy} onClick={()=>void checkVersion()}><RefreshCw size={14}/>Verificar atualização</button></div>
      {error && <p className="error banner" role="alert">{error}</p>}
      {notice && <div className="notice" role="status"><Check size={19} /><span>{notice}</span></div>}

      <nav className="owner-tabs" aria-label="Seções administrativas">
        {([["requests", `Solicitações (${m.pendingRequests})`], ["users", "Participantes"], ["purchases", "Compras"], ["groups", "Grupos e acesso"]] as const).map(([key, title]) => <button key={key} className={tab === key ? "active" : ""} aria-pressed={tab === key} onClick={() => setTab(key)}>{title}</button>)}
      </nav>

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
          {item.status === "PENDING" && <div className="request-actions"><label>Grupo<select aria-label={`Grupo para ${item.name}`} value={selections[item.id] ?? item.preferredGroup ?? activeGroups[0]?.code ?? ""} onChange={(e) => setSelections({ ...selections, [item.id]: e.target.value })}>{activeGroups.map((g) => <option key={g.code} value={g.code}>SOS YOUTUBER {g.code}</option>)}</select></label><button className="primary compact" disabled={busy || !activeGroups.length} onClick={() => void act(() => ownerApi.decide(item.id, "APPROVED", selections[item.id] ?? item.preferredGroup ?? activeGroups[0]?.code), "Aprovação do Owner registrada.")}>Aprovar</button><button className="secondary" disabled={busy} onClick={() => void act(() => ownerApi.decide(item.id, "DECLINED"), "Solicitação marcada como não aprovada.")}>Recusar</button></div>}
        </article>)}</div>}
      </section>}

      {tab === "users" && <section className="owner-panel">
        <div className="section-title"><div><h2>Participantes</h2><p className="muted">Clique no nome para abrir o painel administrativo individual.</p></div><button className="secondary" disabled={busy} onClick={() => void act(() => ownerApi.exportUsers(), "Exportação de usuários concluída.")}><Download size={16} /> Exportar CSV</button></div>
        <div className="table-scroll"><table><thead><tr><th>Nome / WhatsApp</th><th>Grupo</th><th>Aprovação</th><th>Último acesso</th><th>Saldo</th><th>Estado</th></tr></thead><tbody>
          {data.users.map((u) => <tr key={u.id}><td><button className="participant-link" onClick={()=>setParticipantPhone(u.phone)}>{u.name}</button><small>{u.phone}</small></td><td>SOS {u.groupCode}</td><td><strong>{date(u.approvedAt)}</strong><small>por {u.approvedByOwnerName ?? "Owner não identificado"}</small></td><td>{u.lastSeenAt ? date(u.lastSeenAt) : "Ainda não acessou"}</td><td><strong>{coins(u.balanceMillis)} moedas</strong><small>{u.extraPasses} passe{u.extraPasses===1?"":"s"}</small></td><td>{u.revokedAt ? <span className="table-status off">Revogado</span> : u.paymentHold ? <span className="table-status warn">Em revisão</span> : <span className="table-status on">Ativo</span>}</td></tr>)}
        </tbody></table>{!data.users.length && <p className="muted">Nenhum participante aprovado ainda.</p>}</div>
      </section>}

      {tab === "purchases" && <section className="owner-panel"><h2>Pacotes de moedas</h2><p className="muted">Transações de provedor são trilha de auditoria. Para administrar uma carteira, abra o participante pelo nome.</p><div className="table-scroll"><table><thead><tr><th>Participante</th><th>Valor</th><th>Tipo</th><th>Status</th><th>Criado em</th></tr></thead><tbody>{data.purchases.map((p) => <tr key={p.id}><td><button className="participant-link" onClick={()=>setParticipantPhone(p.phone)}>{p.name}</button><small>{p.phone}</small></td><td>{money(p.amountCents)}</td><td>{p.provider === "DEMO" ? "Simulação" : "Pix"}</td><td>{p.status}</td><td>{date(p.createdAt)}</td></tr>)}</tbody></table>{!data.purchases.length && <p className="muted">Nenhum pacote solicitado.</p>}</div></section>}

      {tab === "groups" && <section className="owner-panel groups-admin-panel">
        <div className="groups-heading"><div><div className="heading-with-help"><h2>Grupos e acesso</h2><button className="help-icon" aria-label="Explicar grupos e acesso" onClick={()=>setHelpTopic("groups")}><HelpCircle size={18}/></button></div><p className="muted">Controle quais grupos SOS YOUTUBER podem autenticar e receber novas aprovações.</p></div><span className="live-chip"><RefreshCw size={13}/>Atualiza a cada 10 s</span></div>
        <div className="group-carousel-meta"><strong>Grupos {groupStart+1}–{Math.min(groupStart+GROUP_PAGE_SIZE,999)} de 999</strong><span>Todos os números podem ser ativados e administrados.</span></div>
        <div className="group-carousel-shell">
          <button className="carousel-arrow" aria-label="Grupos anteriores" disabled={groupPage===0} onClick={()=>setGroupPage((page)=>Math.max(0,page-1))}><ChevronLeft/></button>
          <div className="group-carousel">{visibleGroupCodes.map((code) => {
            const stored=groupMap.get(code);
            const enabled=Boolean(stored?.enabled);
            const members=data.members.filter((m)=>m.groupCode===code && !m.revokedAt).length;
            return <article className={`group-admin-card ${enabled ? "enabled":"disabled"}`} key={code}>
              <div className="group-card-top"><span className="group-index">SOS YOUTUBER {code}</span><span className={enabled ? "table-status on":"table-status off"}>{enabled ? "Ativo":stored ? "Pausado":"Disponível"}</span></div>
              <strong>{members} participante{members===1?"":"s"} com acesso</strong>
              <small>Validação: {stored?.membershipMode === "META_GROUPS_API" ? "Meta / prova externa" : "Owner"}</small>
              <small>{stored?.lastSyncedAt ? `Última sincronização: ${date(stored.lastSyncedAt)}` : "Sem sincronização externa"}</small>
              <button className={enabled ? "secondary":"primary compact"} disabled={busy} onClick={() => void act(() => ownerApi.group(code,!enabled), enabled ? `SOS YOUTUBER ${code} pausado; dados preservados.` : `SOS YOUTUBER ${code} ativado.`)}>{enabled ? "Pausar grupo":"Ativar grupo"}</button>
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

      <footer><ShieldCheck size={17} /><span>Dados de contato e controles desta área são exclusivos do Owner. Indicadores mensais usam o fuso de Salvador.</span></footer>
    </main>

    {showWhatsAppConfig && <WhatsAppIntegrationModal initial={data.whatsapp.integration} onClose={()=>setShowWhatsAppConfig(false)} onSaved={(_state,message)=>{ setNotice(message); void load(); }} />}
    {participantPhone && <ParticipantAdminModal phone={participantPhone} groups={data.groups} onClose={()=>setParticipantPhone(undefined)} onChanged={(next)=>{ if(next) setParticipantPhone(next); void load(); }} />}
    {helpTopic && <AdminHelpModal topic={helpTopic} onClose={()=>setHelpTopic(undefined)} />}
  </div>;
}
