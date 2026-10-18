import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MessageSquareText, RefreshCw, RotateCcw, Save, History, Eye } from "lucide-react";
import {
  ownerApi,
  type AutomationAuditEntry, type AutomationCategory, type AutomationMeta,
  type AutomationSettings, type AutomationsState, type BotAutomationRuntime, type SupportAvailability, type SupportAvailabilityState,
} from "./api";

/**
 * AUDITORIA / HYBRID+ — as ATITUDES do bot, editáveis pelo Owner.
 *
 * Aqui o dono escreve cada fala, liga e desliga cada evento, escolhe o alvo e a
 * frequência. O servidor valida antes de aceitar; esta tela mostra o motivo em
 * português quando recusa — identificação pessoal em grupo, campo inexistente,
 * acento num `{campo}`.
 *
 * A pré-visualização é deliberada: a reauditoria pediu "ver antes de ativar",
 * porque uma fala errada vai para a comunidade inteira e não volta.
 *
 * HIERARQUIA: a tela só existe para ROOT_OWNER (o servidor também exige).
 */

const CATEGORY_LABEL: Record<AutomationCategory, string> = {
  ONBOARDING: "Acolhimento",
  QUEUES: "Filas e atividade",
  REWARDS: "Recompensas",
  RETENTION: "Reengajamento e cuidado",
  SUPPORT: "Suporte",
  BROADCAST: "Recado global",
};

const TARGET_LABEL: Record<string, string> = {
  MEMBER: "No privado, para o participante",
  OWNERS: "No privado, para os Owners",
  GROUP: "No grupo do participante",
  ALL_GROUPS: "Em todos os grupos",
};

/** Valores de exemplo para a prévia — mesma ideia do render do servidor. */
const SAMPLE: Record<string, string> = {
  nome: "Ana", grupo: "7", sala: "7", posicao: "3", aba: "2", fila: "12",
  link: "https://sosyoutuber.app", abertas: "3", vagas: "5", moedas: "5", total: "42",
  nivel: "8", dias: "3", semana: "13/10 a 19/10", mes: "outubro",
  ranking: "🥇 Ana — 320 XP\n🥈 Bia — 210 XP\n🥉 Caio — 150 XP",
  mensagem: "Amanhã tem live da comunidade às 20h!",
};

function preview(text: string): string {
  return text.replace(/\{(\w+)\}/g, (match, key: string) => SAMPLE[key] ?? match);
}

function AutomationCard({ meta, settings, capability, onSaved }: {
  meta: AutomationMeta; settings: AutomationSettings; capability?:string; onSaved: (next: AutomationSettings) => void;
}) {
  const [text, setText] = useState(settings.text);
  const [enabled, setEnabled] = useState(settings.enabled);
  const [interval, setIntervalMinutes] = useState(settings.intervalMinutes ?? meta.defaultIntervalMinutes ?? 360);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [showPreview, setShowPreview] = useState(false);

  useEffect(() => {
    setText(settings.text); setEnabled(settings.enabled);
    setIntervalMinutes(settings.intervalMinutes ?? meta.defaultIntervalMinutes ?? 360);
  }, [settings.text, settings.enabled, settings.intervalMinutes, meta.defaultIntervalMinutes]);

  const dirty = text !== settings.text || enabled !== settings.enabled
    || (meta.periodic && interval !== (settings.intervalMinutes ?? meta.defaultIntervalMinutes));

  function flash(message: string) { setNotice(message); window.setTimeout(() => setNotice(""), 2500); }

  async function save() {
    setBusy(true); setError("");
    try {
      const result = await ownerApi.saveBotAutomation(meta.event, {
        text, enabled, ...(meta.periodic ? { intervalMinutes: interval } : {}),
      });
      onSaved(result.automation);
      flash("Salvo.");
    } catch (cause) {
      // O servidor devolve o motivo em português — mostramos como veio.
      setError(cause instanceof Error ? cause.message : "Não foi possível salvar.");
    } finally { setBusy(false); }
  }

  async function reset() {
    setBusy(true); setError("");
    try { onSaved((await ownerApi.resetBotAutomation(meta.event)).automation); flash("Voltou ao padrão."); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível restaurar."); }
    finally { setBusy(false); }
  }



  return (
    <article className={`automation-card${enabled ? " on" : ""}`}>
      <header>
        <label className="automation-toggle">
          <input type="checkbox" checked={enabled} disabled={busy} onChange={(e) => setEnabled(e.target.checked)} />
          <span><strong>{meta.label}</strong><small>{meta.description}</small></span>
        </label>
        {settings.customized && <em className="automation-tag">editada</em>}
        <em className="automation-tag">{capabilityLabel(capability)}</em>
      </header>

      <p className="automation-route">
        {TARGET_LABEL[settings.target] ?? settings.target}
        {meta.periodic && <> · a cada <input type="number" min={15} step={15} value={interval} disabled={busy}
          onChange={(e) => setIntervalMinutes(Number(e.target.value))} className="automation-interval" /> min</>}
      </p>

      <textarea value={text} disabled={busy} rows={3} onChange={(e) => setText(e.target.value)}
        aria-label={`Mensagem de ${meta.label}`} />

      <p className="automation-fields">
        Campos: {meta.placeholders.map((k) => (
          <button type="button" key={k} className="automation-chip" disabled={busy}
            onClick={() => setText((t) => `${t}{${k}}`)}>{`{${k}}`}</button>
        ))}
        <small>sem acento</small>
      </p>

      {showPreview && <div className="automation-preview"><span>Como a pessoa vê</span><p>{preview(text)}</p></div>}

      <footer>
        <button type="button" className="text-button" onClick={() => setShowPreview((v) => !v)}>
          <Eye size={14} /> {showPreview ? "Ocultar prévia" : "Ver prévia"}
        </button>
        {settings.customized && <button type="button" className="text-button" onClick={() => void reset()} disabled={busy}>
          <RotateCcw size={14} /> Voltar ao padrão
        </button>}
        <button type="button" className="primary" onClick={() => void save()} disabled={busy || !dirty}>
          <Save size={15} /> Salvar
        </button>
      </footer>

      {notice && <p className="bot-notice">{notice}</p>}
      {error && <p className="error" role="alert">{error}</p>}
    </article>
  );
}


function capabilityLabel(status?:string):string {
 if(!status)return "Verificação operacional pendente";
 if(status==="TEXT_ONLY_PIN_UNAVAILABLE")return "Fixação automática indisponível neste transporte";
 if(status==="PENDING_SUPPORT_SCHEDULE")return "Horário de atendimento pendente";
 if(status==="DELEGATED_GAMIFICATION_BOT")return "Integrada à jornada e às recompensas";
 if(status==="DELEGATED_DAILY_SCHEDULER")return "Integrada ao agendamento";
 if(status==="WIRED_ROOT_MANUAL")return "Envio manual pelo Root";
 if(status==="WIRED_WALLET_LEDGER")return "Integrada às moedas da carteira";
 if(status==="DELEGATED_SUPPORT_AVAILABILITY")return "Integrada à agenda de atendimento";
 return status.startsWith("WIRED")||status.startsWith("DELEGATED")?"Integrada ao sistema · aguarda o evento":"Verificação operacional pendente";
}
const DELIVERY_LABEL:Record<string,string>={PENDING:"Aguardando processamento",WAITING:"Aguardando condição de envio",QUEUED:"Na fila de envio",SENT:"Entregue ao provedor",FAILED:"Falha no envio",SKIPPED:"Envio dispensado",DONE:"Processado",SUPPRESSED:"Envio retido pela política",DISPATCHED:"Processado",BLOCKED:"Aguardando liberação",PROCESSING:"Em processamento"};
const REASON_LABEL:Record<string,string>={
 EVENT_DISABLED:"Automação pausada",FEATURE_DISABLED:"Função pausada",MODE_DISABLED:"Bot pausado",PROVIDER_NOT_READY:"Conexão pendente",EVOLUTION_NOT_READY:"Conexão do bot pendente",META_NOT_READY:"Conexão oficial pendente",QUIET_HOURS:"Aguardando o fim do silêncio noturno",BUDGET_EXCEEDED:"Limite diário alcançado",OPTED_OUT:"Pessoa pediu para não receber avisos",NO_GROUPS:"Aguardando grupos disponíveis",NO_TARGETS:"Aguardando destinatários",BOT_DISABLED:"Bot pausado",EVOLUTION_DISCONNECTED:"Aguardando reconexão",TEMPLATE_OR_SERVICE_WINDOW_REQUIRED:"Conversa recente ou modelo aprovado necessário",OUTBOX_FAILED:"O provedor não concluiu o envio"
};
function deliveryLabel(status:string,reason?:string|null):string {
 const label=DELIVERY_LABEL[status]??"Aguardando atualização";
 return reason?label+" · "+(REASON_LABEL[reason]??"Condição de envio ainda pendente"):label;
}


function SupportAvailabilityForm({value,onSaved}:{value:SupportAvailabilityState;onSaved:(next:SupportAvailabilityState)=>void}){
 const [draft,setDraft]=useState<SupportAvailability>({enabled:value.enabled,days:[...value.days],startHour:value.startHour,endHour:value.endHour});
 const [busy,setBusy]=useState(false),[error,setError]=useState(""),[notice,setNotice]=useState("");
 useEffect(()=>{setDraft({enabled:value.enabled,days:[...value.days],startHour:value.startHour,endHour:value.endHour});},[value]);
 const dirty=JSON.stringify(draft)!==JSON.stringify({enabled:value.enabled,days:value.days,startHour:value.startHour,endHour:value.endHour});
 async function save(){
  if(busy)return;setBusy(true);setError("");setNotice("");
  try{onSaved(await ownerApi.saveSupportAvailability(draft));setNotice("Horário salvo.");}
  catch(cause){setError(cause instanceof Error?cause.message:"Não foi possível salvar o horário.");}
  finally{setBusy(false);}
 }
 return <form className="comms-block" onSubmit={e=>{e.preventDefault();void save();}}>
  <div className="comms-block-head"><h3>Horário da pessoa que assume o atendimento</h3></div>
  <p className="muted">O atendimento automático continua funcionando. Fora do período definido, o bot explica a disponibilidade e encaminha o pedido para a pessoa responsável.</p>
  <label className="automation-toggle"><input type="checkbox" checked={draft.enabled} disabled={busy} onChange={e=>setDraft(p=>({...p,enabled:e.target.checked}))}/><span>Definir horário do atendimento humano</span></label>
  {draft.enabled?<><fieldset disabled={busy}><legend>Dias de atendimento</legend>
   {["Domingo","Segunda","Terça","Quarta","Quinta","Sexta","Sábado"].map((day,index)=><label key={day}><input type="checkbox" checked={draft.days.includes(index)} onChange={e=>setDraft(p=>({...p,days:e.target.checked?[...p.days,index].sort():p.days.filter(d=>d!==index)}))}/>{day} </label>)}
  </fieldset><p>
   <label>Início <select aria-label="Hora de início do atendimento humano" value={draft.startHour} disabled={busy} onChange={e=>setDraft(p=>({...p,startHour:Number(e.target.value)}))}>{Array.from({length:24},(_,h)=><option key={h} value={h}>{String(h).padStart(2,"0")}:00</option>)}</select></label>{" "}
   <label>Fim <select aria-label="Hora de fim do atendimento humano" value={draft.endHour} disabled={busy} onChange={e=>setDraft(p=>({...p,endHour:Number(e.target.value)}))}>{Array.from({length:25},(_,h)=><option key={h} value={h}>{String(h).padStart(2,"0")}:00</option>)}</select></label>
  </p><small>Horário de Salvador/Bahia. Se o fim for antes do início, o atendimento atravessa a meia-noite.</small></>:<p className="muted">Nenhuma restrição de horário definida. Isso não indica que uma pessoa esteja online.</p>}
  <p className="bot-notice">{dirty?"Alterações ainda não salvas.":!value.enabled?"Agenda desativada.":value.availableNow?"Dentro do horário configurado agora.":"Fora do horário configurado agora."}</p>
  <button type="submit" className="primary" disabled={busy||!dirty||!draft.days.length}><Save size={15}/>{busy?"Salvando…":"Salvar horário"}</button>
  {notice&&<p role="status" className="bot-notice">{notice}</p>}{error&&<p role="alert" className="error">{error}</p>}
 </form>;
}


function WhatsAppTest(){
 const [busy,setBusy]=useState(false),[outboxId,setOutboxId]=useState(""),[notice,setNotice]=useState(""),[error,setError]=useState("");
 const reference=useRef<string|undefined>(undefined),operation=useRef(false);
 async function check(id:string){
  const receipt=await ownerApi.botTestMessageStatus(id);
  setNotice(receipt.providerConfirmed?"O provedor confirmou o envio do teste. Confira o seu WhatsApp.":deliveryLabel(receipt.status,receipt.reason));
 }
 async function send(){
  if(operation.current||outboxId)return;
  operation.current=true;setBusy(true);setError("");reference.current??=crypto.randomUUID();
  try{const result=await ownerApi.sendBotTestMessage(reference.current);setOutboxId(result.outboxId);setNotice("Teste registrado na fila. Consulte a entrega abaixo.");}
  catch(cause){setError(cause instanceof Error?cause.message:"Não foi possível confirmar o teste. Tentar novamente usa a mesma referência.");}
  finally{operation.current=false;setBusy(false);}
 }
 async function refresh(){
  if(operation.current||!outboxId)return;operation.current=true;setBusy(true);setError("");
  try{await check(outboxId);}catch(cause){setError(cause instanceof Error?cause.message:"Não foi possível consultar a entrega.");}
  finally{operation.current=false;setBusy(false);}
 }
 return <div className="comms-block"><div className="comms-block-head"><h3>Conferir o envio no meu WhatsApp</h3></div>
  <p className="muted">Envie uma mensagem de teste somente para o número da sua conta Root. O teste usa a conexão e os limites do bot.</p>
  <div className="owner-panel-actions"><button type="button" className="primary" disabled={busy||Boolean(outboxId)} onClick={()=>void send()}>{busy?"Aguarde…":"Testar no meu WhatsApp"}</button>
  {outboxId&&<button type="button" className="text-button" disabled={busy} onClick={()=>void refresh()}><RefreshCw size={14}/> Consultar entrega do teste</button>}</div>
  {notice&&<p role="status" className="bot-notice">{notice}</p>}{error&&<p role="alert" className="error">{error}</p>}
 </div>;
}

export function OwnerAutomationsPanel() {
  const [state, setState] = useState<AutomationsState>();
  const [runtime,setRuntime]=useState<BotAutomationRuntime>();
  const [supportAvailability,setSupportAvailability]=useState<SupportAvailabilityState>();
  const [broadcastEnabled,setBroadcastEnabled]=useState(false);
  const [message,setMessage]=useState("");
  const [broadcastPreview,setBroadcastPreview]=useState(false);
  const [sending,setSending]=useState(false);
  const [broadcastNotice,setBroadcastNotice]=useState("");
  const [broadcastError,setBroadcastError]=useState("");
  const broadcastReference=useRef<{message:string;id:string}|undefined>(undefined);
  const broadcastOperation=useRef(false);
  const [audit, setAudit] = useState<AutomationAuditEntry[]>([]);
  const [showAudit, setShowAudit] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const [settings,operational,bot,availability]=await Promise.all([ownerApi.botAutomations(),ownerApi.botAutomationsRuntime(),ownerApi.bot(),ownerApi.supportAvailability()]);
      setState(settings);setRuntime(operational);setSupportAvailability(availability);setBroadcastEnabled(bot.status.features.some(f=>f.code==="BROADCAST"&&f.enabled));setError("");
    }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Falha ao carregar as atitudes do bot."); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function dispatchBroadcast(){
    if(broadcastOperation.current||!broadcastPreview||!broadcastEnabled||!state?.automations.some(a=>a.event==="BROADCAST_GLOBAL"&&a.enabled)||!message.trim())return;
    broadcastOperation.current=true;setSending(true);setBroadcastError("");setBroadcastNotice("");
    const clean=message.trim();
    if(broadcastReference.current?.message!==clean)broadcastReference.current={message:clean,id:crypto.randomUUID()};
    try{
      await ownerApi.dispatchGlobalBroadcast(clean,broadcastReference.current.id);
      setBroadcastNotice("Recado registrado. Acompanhe a entrega abaixo; os limites e o silêncio noturno continuam valendo.");
      setMessage("");setBroadcastPreview(false);broadcastReference.current=undefined;
      await load();
    }catch(cause){setBroadcastError(cause instanceof Error?cause.message:"Não foi possível confirmar. Tente novamente: o mesmo recado será reconhecido sem duplicar.");}
    finally{broadcastOperation.current=false;setSending(false);}
  }

  async function loadAudit() {
    try { setAudit((await ownerApi.botAutomationAudit()).entries); setShowAudit(true); }
    catch { /* a trilha é um extra; a tela continua útil sem ela */ }
  }

  const byEvent = useMemo(
    () => new Map((state?.automations ?? []).map((a) => [a.event, a])),
    [state?.automations],
  );
  const metaByEvent = useMemo(
    () => new Map((state?.catalog ?? []).map((m) => [m.event, m])),
    [state?.catalog],
  );

  function onSaved(next: AutomationSettings) {
    setState((prev) => prev && {
      ...prev,
      automations: prev.automations.map((a) => (a.event === next.event ? next : a)),
    });
  }

  if (error) return <section className="owner-panel"><p className="error" role="alert">{error}</p></section>;
  if (!state) return <section className="owner-panel"><p className="muted">Carregando as atitudes do bot…</p></section>;

  const active = state.automations.filter((a) => a.enabled).length;
  const capabilities=new Map(runtime?.capabilities.map(c=>[c.event,c.status]));
  const broadcast=byEvent.get("BROADCAST_GLOBAL");
  const canBroadcast=Boolean(runtime?.wired&&broadcast?.enabled&&broadcastEnabled);
  const broadcastBody=broadcast?.text.replace(/\{(\w+)\}/g,(token,key:string)=>key==="mensagem"?message.trim():SAMPLE[key]??token)??message.trim();

  return (
    <section className="owner-panel automations-panel">
      <div className="owner-panel-head">
        <div>
          <h2><MessageSquareText size={19} /> Atitudes do bot</h2>
          <p className="muted">
            Cada fala do bot é editável aqui. {active} de {state.automations.length} ligadas.
            O que você escreve chega à comunidade — use a prévia antes de salvar.
          </p>
        </div>
        <div className="owner-panel-actions">
          <button className="text-button" onClick={() => void loadAudit()}><History size={14} /> Histórico</button>
          <button className="text-button" onClick={() => void load()}><RefreshCw size={14} /> Atualizar</button>
        </div>
      </div>


      <div className="comms-block">
        <div className="comms-block-head"><h3>Enviar um recado à comunidade</h3></div>
        <p className="muted">Escreva, confira a prévia e confirme o envio. O bot distribui pelos grupos com cadência e limites de proteção.</p>
        {!canBroadcast&&<p className="bot-notice">Ative a função Recado global e esta atitude antes de enviar.</p>}
        <textarea aria-label="Recado para todos os grupos" rows={4} maxLength={3000} value={message} disabled={sending} onChange={e=>{setMessage(e.target.value);setBroadcastPreview(false);setBroadcastNotice("");setBroadcastError("");broadcastReference.current=undefined;}}/>
        <small>{message.length}/3000 caracteres</small>
        <div className="owner-panel-actions">
          <button type="button" className="text-button" disabled={!canBroadcast||!message.trim()||sending} onClick={()=>setBroadcastPreview(true)}><Eye size={14}/> Conferir recado</button>
          <button type="button" className="primary" disabled={!canBroadcast||!broadcastPreview||!message.trim()||sending} onClick={()=>void dispatchBroadcast()}>{sending?"Registrando…":"Confirmar e enfileirar"}</button>
        </div>
        {broadcastPreview&&<div className="automation-preview"><span>Como o grupo verá</span><p>{broadcastBody}</p></div>}
        {broadcastNotice&&<p className="bot-notice" role="status">{broadcastNotice}</p>}
        {broadcastError&&<p className="error" role="alert">{broadcastError}</p>}
      </div>

      <div className="comms-block">
        <div className="comms-block-head"><h3>Operação e entregas</h3></div>
        <p className="muted">Atitude ligada significa permissão para agir. Cada envio ainda depende da conexão, do horário e dos limites do bot.</p>
        {runtime?.events.length?<ul>{runtime.events.map((entry,index)=><li key={index}><strong>{metaByEvent.get(entry.event)?.label??"Aviso da comunidade"}</strong><span> · {entry.total} · {deliveryLabel(entry.status,entry.reason)}</span></li>)}</ul>:<p className="muted">Nenhum evento registrado nesta operação.</p>}
        <details><summary>Últimas tentativas de entrega</summary>
          {runtime?.deliveries.length?<ul>{runtime.deliveries.slice(0,20).map((delivery,index)=><li key={index}><strong>{metaByEvent.get(delivery.event)?.label??"Aviso da comunidade"}</strong><p>{deliveryLabel(delivery.status,delivery.reason)}</p><small>{new Date(delivery.createdAt).toLocaleString("pt-BR")} · {TARGET_LABEL[delivery.target]??"Destino da comunidade"}</small></li>)}</ul>:<p className="muted">As entregas aparecerão aqui quando houver um envio.</p>}
        </details>
      </div>

      <WhatsAppTest/>

      {supportAvailability&&<SupportAvailabilityForm value={supportAvailability} onSaved={setSupportAvailability}/>}

      {showAudit && (
        <div className="comms-block automation-audit">
          <div className="comms-block-head"><h3>Quem mudou o quê</h3>
            <button className="text-button" onClick={() => setShowAudit(false)}>fechar</button></div>
          {audit.length === 0 ? <p className="muted">Nenhuma alteração registrada ainda.</p> : (
            <ul>{audit.map((entry, index) => (
              <li key={index}>
                <strong>{metaByEvent.get(entry.event)?.label ?? entry.event}</strong>
                <small>{entry.field} · {entry.actorName ?? "—"} · {new Date(entry.createdAt).toLocaleString("pt-BR")}</small>
                {entry.field === "text" && <p className="automation-audit-diff">{entry.after}</p>}
              </li>
            ))}</ul>
          )}
        </div>
      )}

      {state.groups.map(({ category, events }) => events.length > 0 && (
        <div className="comms-block" key={category}>
          <div className="comms-block-head"><h3>{CATEGORY_LABEL[category] ?? category}</h3></div>
          <div className="automation-grid">
            {events.map((event) => {
              const meta = metaByEvent.get(event), settings = byEvent.get(event);
              if (!meta || !settings) return null;
              return <AutomationCard key={event} meta={meta} settings={settings} capability={capabilities.get(event)} onSaved={onSaved} />;
            })}
          </div>
        </div>
      ))}
    </section>
  );
}
