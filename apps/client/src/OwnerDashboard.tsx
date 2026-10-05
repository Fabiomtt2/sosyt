import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Check, Download, LogOut, RefreshCw, ShieldCheck, Users, Youtube } from "lucide-react";
import { ApiError, ownerApi, type OwnerOverview } from "./api";
import { INTERNATIONAL_PHONE_PATTERN, formatInternationalPhoneInput } from "./phone";

function localMonth() {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bahia", year: "numeric", month: "2-digit" }).formatToParts(new Date());
  return `${parts.find((p) => p.type === "year")!.value}-${parts.find((p) => p.type === "month")!.value}`;
}
const date = (value?: string) => value ? new Date(value).toLocaleString("pt-BR") : "Ainda não acessou";
const money = (cents: number) => (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export function OwnerDashboard({ onLogout }: { onLogout: () => void }) {
  const [month, setMonth] = useState(localMonth);
  const [data, setData] = useState<OwnerOverview>();
  const [tab, setTab] = useState<"requests" | "users" | "purchases" | "groups">("requests");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [phone, setPhone] = useState("");
  const [group, setGroup] = useState("1");
  const [newGroup, setNewGroup] = useState("");
  const [selections, setSelections] = useState<Record<string, string>>({});
  const load = useCallback(async () => {
    try { setData(await ownerApi.overview(month)); setError(""); }
    catch (cause) { if (cause instanceof ApiError && cause.status === 401) onLogout(); else setError(cause instanceof Error ? cause.message : "Falha ao carregar painel."); }
  }, [month, onLogout]);
  useEffect(() => { void load(); const timer = window.setInterval(() => void load(), 30_000); return () => window.clearInterval(timer); }, [load]);
  async function act(work: () => Promise<unknown>, message: string) {
    setBusy(true); setError(""); setNotice("");
    try { await work(); setNotice(message); await load(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível concluir."); }
    finally { setBusy(false); }
  }
  async function addMember(event: FormEvent) { event.preventDefault(); await act(() => ownerApi.approveMember(phone, group), "Número autorizado no grupo selecionado."); setPhone(""); }
  async function addGroup(event: FormEvent) { event.preventDefault(); await act(() => ownerApi.group(newGroup, true), "Grupo adicionado."); setNewGroup(""); }
  if (!data) return <main className="loading"><ShieldCheck /><span>Carregando painel do Owner…</span>{error && <p className="error">{error}</p>}</main>;
  const m = data.metrics;
  const activeGroups = data.groups.filter((item) => item.enabled);
  return <div className="app-shell owner-shell">
    <header><div className="logo"><span><Youtube size={21} fill="currentColor" /></span>Conexão <strong>Youtube</strong></div><div className="header-actions"><button className="icon-button" onClick={() => void load()} aria-label="Atualizar painel"><RefreshCw size={18} /></button><button className="profile" onClick={onLogout} aria-label={`Sair da conta de ${data.owner.name}`}><span><ShieldCheck size={19} /></span><div><strong>{data.owner.name}</strong><small>Owner · #</small></div><LogOut size={16} /></button></div></header>
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
      <section className="owner-panel" style={{marginBottom:24}} aria-label="Integração WhatsApp"><h2>Bot SOS YouTube</h2><p className="muted">{data.whatsapp.configured ? "Cloud API configurada no servidor; entrega real depende da conexão Meta." : "Aguardando credenciais Meta e número de atendimento."} {data.whatsapp.queued} mensagens na fila · {data.whatsapp.failed} falhas · {data.whatsapp.sent} envios aceitos pela Meta.</p><p className="muted">{data.whatsapp.ownerAlertsConfigured ? "Alertas aos Owners preparados." : "Configure telefones dos Owners e template aprovado para receber alertas."} {data.whatsapp.decisionTemplateConfigured ? "Decisões tardias podem ser notificadas por template aprovado." : "Dentro da janela ativa o bot responde à decisão; fora dela, configure o template de decisão."}</p><p className="muted">{data.whatsapp.groupsLinked > 0 ? `${data.whatsapp.groupsLinked} grupo(s) SOS vinculado(s) à Groups API · ${data.whatsapp.automaticMemberships} associação(ões) automática(s) ativa(s).` : "Nenhum grupo SOS oficial sincronizado ainda. Enquanto a Meta não devolver grupos elegíveis, a conferência manual continua disponível."}</p><div className="ready-actions">{data.whatsapp.groupsSyncEnabled && <button className="secondary" disabled={busy || !data.whatsapp.configured} onClick={() => void act(() => ownerApi.syncWhatsAppGroups(),"Sincronização dos grupos SOS concluída.")}>Sincronizar grupos agora</button>}{data.whatsapp.failed>0 && <button className="secondary" disabled={busy} onClick={() => void act(() => ownerApi.retryWhatsApp(),"Mensagens elegíveis recolocadas na fila.")}>Repetir envios com falha</button>}</div></section>
      {error && <p className="error banner" role="alert">{error}</p>}
      {notice && <div className="notice" role="status"><Check size={19} /><span>{notice}</span></div>}
      <nav className="owner-tabs" aria-label="Seções administrativas">
        {([["requests", `Solicitações (${m.pendingRequests})`], ["users", "Participantes"], ["purchases", "Compras"], ["groups", "Grupos e acesso"]] as const).map(([key, title]) => <button key={key} className={tab === key ? "active" : ""} aria-pressed={tab === key} onClick={() => setTab(key)}>{title}</button>)}
      </nav>
      {tab === "requests" && <section className="owner-panel"><h2>Quero participar!</h2><p className="muted">Quando o grupo SOS está sincronizado pela Meta, entrada/saída atualiza o acesso automaticamente. Pendências de grupos ainda não sincronizados podem ser conferidas pelos Owners.</p>
        {data.requests.length === 0 ? <div className="empty-state"><Users /><p>As novas solicitações aparecerão aqui.</p></div> : <div className="request-list">{data.requests.map((item) => <article className="request-card" key={item.id}><div>{item.status === "PENDING" && <span className="pending-user-badge">Novo Usuário! Registro pendente 📨 · aguarda registro ▶️</span>}<strong>{item.name}</strong><span>{item.phone} · {date(item.createdAt)} · {item.source === "WHATSAPP" ? "Recebido pelo WhatsApp" : "Solicitação web"}</span><small>{item.status === "PENDING" ? "Aguardando aprovação" : item.status === "APPROVED" ? "Aprovado" : "Não aprovado"}</small></div>{item.status === "PENDING" && <div className="request-actions"><label>Grupo<select aria-label={`Grupo para ${item.name}`} value={selections[item.id] ?? item.preferredGroup ?? activeGroups[0]?.code ?? ""} onChange={(e) => setSelections({ ...selections, [item.id]: e.target.value })}>{activeGroups.map((g) => <option key={g.code} value={g.code}>SOS YOUTUBER {g.code}</option>)}</select></label><button className="primary compact" disabled={busy || !activeGroups.length} onClick={() => void act(() => ownerApi.decide(item.id, "APPROVED", selections[item.id] ?? item.preferredGroup ?? activeGroups[0]?.code), "Solicitação aprovada. O participante já pode entrar.")}>Aprovar</button><button className="secondary" disabled={busy} onClick={() => void act(() => ownerApi.decide(item.id, "DECLINED"), "Solicitação não aprovada.")}>Recusar</button></div>}</article>)}</div>}
      </section>}
      {tab === "users" && <section className="owner-panel"><div className="section-title"><h2>Participantes cadastrados</h2><button className="secondary" disabled={busy} onClick={() => void act(() => ownerApi.exportUsers(), "Exportação de usuários concluída.")}><Download size={16} /> Exportar CSV</button></div><div className="table-scroll"><table><thead><tr><th>Nome / WhatsApp</th><th>Grupo</th><th>Último acesso</th><th>Créditos / passes</th><th>Carteira</th></tr></thead><tbody>{data.users.map((u) => <tr key={u.id}><td><strong>{u.name}</strong><small>{u.phone}</small></td><td>SOS {u.groupCode}</td><td>{date(u.lastSeenAt)}</td><td>{(u.balanceMillis / 1000).toLocaleString("pt-BR")} / {u.extraPasses}</td><td>{u.paymentHold ? "Em revisão" : "Disponível"}</td></tr>)}</tbody></table>{!data.users.length && <p className="muted">Nenhum participante completou o cadastro.</p>}</div><p className="muted table-note">Até 200 registros recentes na tela. O CSV inclui todos os usuários cadastrados.</p></section>}
      {tab === "purchases" && <section className="owner-panel"><h2>Pacotes de moedas</h2><div className="table-scroll"><table><thead><tr><th>Participante</th><th>Valor</th><th>Tipo</th><th>Status</th><th>Criado em</th></tr></thead><tbody>{data.purchases.map((p) => <tr key={p.id}><td><strong>{p.name}</strong><small>{p.phone}</small></td><td>{money(p.amountCents)}</td><td>{p.provider === "DEMO" ? "Simulação" : "Pix"}</td><td>{p.status}</td><td>{date(p.createdAt)}</td></tr>)}</tbody></table>{!data.purchases.length && <p className="muted">Nenhum pacote solicitado.</p>}</div></section>}
      {tab === "groups" && <section className="owner-panel"><h2>Grupos e números autorizados</h2><p className="muted">Os grupos de participantes vão de 1 a 99. Contas Owner são reconhecidas automaticamente pelo cadastro e não usam marcador visível na interface.</p><div className="group-chips">{data.groups.map((g) => <button className={g.enabled ? "group-chip enabled" : "group-chip"} key={g.code} disabled={busy} onClick={() => void act(() => ownerApi.group(g.code, !g.enabled), g.enabled ? "Grupo desativado; acessos suspensos." : "Grupo ativado.")}>SOS YOUTUBER {g.code} · {g.enabled ? "Ativo" : "Inativo"} · {g.membershipMode === "META_GROUPS_API" ? "Meta automático" : "Owner"}</button>)}</div><form className="owner-inline-form" onSubmit={addGroup}><label>Novo grupo<input inputMode="numeric" pattern="[1-9]|[1-9][0-9]" maxLength={2} value={newGroup} onChange={(e) => setNewGroup(e.target.value.replace(/[^0-9]/g, "").slice(0, 2))} placeholder="1 a 99" required /></label><button className="secondary" disabled={busy}>Adicionar grupo</button></form><h3>Autorizar participante já conferido</h3><form className="owner-inline-form" onSubmit={addMember}><label>WhatsApp<input inputMode="tel" value={phone} onChange={(e) => setPhone(formatInternationalPhoneInput(e.target.value))} pattern={INTERNATIONAL_PHONE_PATTERN} placeholder="+ código do país + número" required /></label><label>Grupo<select value={group} onChange={(e) => setGroup(e.target.value)}>{activeGroups.map((g) => <option key={g.code} value={g.code}>SOS YOUTUBER {g.code}</option>)}</select></label><button className="primary compact" disabled={busy || !activeGroups.length}>Autorizar número</button></form><div className="table-scroll"><table><thead><tr><th>WhatsApp</th><th>Grupo</th><th>Acesso</th><th>Ação</th></tr></thead><tbody>{data.members.map((m) => <tr key={m.phone}><td>{m.phone}</td><td>SOS {m.groupCode}</td><td>{m.revokedAt ? "Revogado" : m.source === "META_GROUPS_API" ? "Automático Meta" : "Autorizado"}</td><td>{!m.revokedAt && <button className="secondary" disabled={busy} onClick={() => void act(() => ownerApi.revoke(m.phone), "Acesso revogado; dados e saldo preservados.")}>Revogar</button>}</td></tr>)}</tbody></table></div></section>}
      <footer><ShieldCheck size={17} /><span>Dados de contato disponíveis apenas ao Owner. Indicadores mensais usam o fuso de Salvador.</span></footer>
    </main>
  </div>;
}
