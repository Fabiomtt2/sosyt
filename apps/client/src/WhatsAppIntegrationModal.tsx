import { useModalLifecycle } from "./useModalLifecycle";
import { useEffect, useState, type FormEvent } from "react";
import { Bot, CheckCircle2, CircleHelp, ExternalLink, KeyRound, LoaderCircle, MessageCircleMore, Settings2, Smartphone } from "lucide-react";
import { ownerApi, type WhatsAppIntegrationState, type WhatsAppRuntimeState } from "./api";

type HelpTopic = "businessPhone" | "mode" | "hybrid" | "evolution" | "meta" | "waba" | "phoneId" | "token" | "secret" | "verify" | "webhook" | "wppUrl" | "wppSession" | "wppToken" | "evolutionUrl" | "evolutionInstance" | "evolutionApiKey" | "humanSupportPhone" | "evolutionPhone" | "evolutionWebhookSecret";

const HELP: Record<HelpTopic,{title:string;body:string}> = {
  humanSupportPhone:{title:"Pessoa que assume o atendimento",body:"Este telefone recebe o aviso quando alguém pede atendimento humano. É um destinatário de suporte; não é a identidade da sessão do bot. Trocar este campo não muda o número que envia mensagens automáticas."},
  evolutionPhone:{title:"Número que atende automaticamente",body:"Informe DDI, DDD e número da conta pareada à instância Evolution. O servidor confere se a sessão pertence a esse telefone. Ao trocar o chip, atualize o número e faça o pareamento da instância correspondente."},
  evolutionWebhookSecret:{title:"Proteção dos eventos Evolution",body:"Segredo compartilhado entre Evolution e SOS para autenticar os eventos recebidos. Deixe vazio para manter o segredo salvo. A chave da API autoriza chamadas ao Evolution; este segredo protege o caminho de volta."},
  businessPhone:{title:"Número público do SOS YouTuber",body:"Este é o telefone Business para receber pedidos de participação. Ao salvar, links e configurações passam a usar o novo número a partir do servidor, inclusive após reiniciar. Se você trocar o número usado pelo bot, atualize também o ID fornecido pela Meta e use Validar integração. O número do telefone sozinho não ativa o envio automático nem altera os contatos pessoais dos Owners."},
  mode:{title:"Qual modo devo usar?",body:"Meta Oficial usa somente a plataforma oficial do WhatsApp Business. Meta + Grupos mantém a Meta para mensagens e acrescenta o WPPConnect apenas para grupos, membros e administradores. Evolution envia e recebe mensagens pela sessão pareada e sincroniza grupos. Híbrido+ usa Meta para mensagens e Evolution para grupos. Desativado pausa automações externas sem apagar os dados salvos."},
  hybrid:{title:"O que muda em Meta + Grupos?",body:"A Meta continua responsável por mensagens e webhooks. O complemento WPPConnect entra apenas para consultar grupos tradicionais, membros e administradores quando a API oficial não expõe esses dados. A sessão complementar é separada e pode exigir novo pareamento após mudanças no WhatsApp."},
  evolution:{title:"Como funciona o Evolution Gateway?",body:"É um gateway independente configurado pelo Owner. URL, instância e API key ficam no servidor; a chave é protegida e não volta para a tela depois de salva. Conexões baseadas em WhatsApp Web/Baileys podem exigir novo pareamento e têm risco operacional diferente da Cloud API oficial."},
  meta:{title:"Onde encontro esses dados?",body:"Entre no Meta for Developers com a conta responsável pelo negócio, abra ou crie o aplicativo e adicione o produto WhatsApp. Depois, no WhatsApp Manager, você verá a conta do WhatsApp Business, o número comercial e as credenciais necessárias. Se algum item não aparecer, a conta pode precisar de verificação ou permissão adicional."},
  waba:{title:"ID da conta do WhatsApp Business",body:"É o identificador numérico da sua conta empresarial do WhatsApp na Meta. O termo técnico usado pela Meta é “WABA ID”. Ele identifica a conta Business, não o número de telefone."},
  phoneId:{title:"ID do número do WhatsApp",body:"É o identificador que a Meta atribui ao número comercial dentro do WhatsApp Business Platform. O termo técnico é “Phone Number ID”. Ele é diferente do número de telefone escrito com +55."},
  token:{title:"Credencial de acesso da Meta",body:"Para o sistema conversar com a Meta sem depender de uma sessão temporária, é necessário um token permanente ou de longa duração de um usuário do sistema. A Meta chama essa credencial de “System User Access Token”. Depois de colado aqui, ele fica criptografado no servidor e não é exibido novamente."},
  secret:{title:"Chave secreta do aplicativo",body:"É a chave privada do aplicativo criado no Meta for Developers, chamada tecnicamente de “App Secret”. Ela permite conferir se os webhooks recebidos vieram realmente da Meta. Não compartilhe essa chave fora da administração."},
  verify:{title:"Token de verificação",body:"É uma senha criada por nós para confirmar à Meta que este endereço de webhook pertence ao SOS YouTube. O termo técnico é “Verify Token”. Você pode gerar uma nova aqui e copiá-la uma única vez para o painel da Meta."},
  webhook:{title:"Endereço de retorno da Meta",body:"É o endereço público HTTPS para onde a Meta envia eventos do WhatsApp. O termo técnico é “webhook”. A página pública pode ficar no GitHub Pages, mas este endereço precisa apontar para o backend online, porque é o servidor que recebe mensagens, confirma eventos e acessa o banco."},
  wppUrl:{title:"Endereço do servidor complementar",body:"É o endereço onde o complemento WPPConnect ficará disponível. Ele é usado apenas no modo Meta + Grupos para consultar grupos tradicionais, participantes e administradores. Quando rodar neste computador, costuma apontar para o próprio Xubuntu; quando for publicado, pode usar outro servidor protegido."},
  wppSession:{title:"Nome da sessão complementar",body:"É apenas um nome interno para identificar a sessão pareada do WhatsApp Web, por exemplo “sos-youtube”. Não é seu número de telefone e não aparece para os participantes."},
  wppToken:{title:"Credencial do complemento",body:"É a senha usada para impedir que outras pessoas chamem o servidor complementar. Ela fica protegida no servidor do SOS YouTube e é necessária quando o WPPConnect exigir autenticação."},
  evolutionUrl:{title:"Endereço da Evolution API",body:"É a URL HTTPS do servidor Evolution que o SOS YouTuber chamará quando este modo estiver ativo."},
  evolutionInstance:{title:"Instância Evolution",body:"É o nome da instância configurada na Evolution API. Ele identifica qual conexão do WhatsApp pertence ao SOS YouTuber."},
  evolutionApiKey:{title:"API key da Evolution",body:"É a chave secreta usada para autenticar chamadas na Evolution API. Ela é salva criptografada no servidor e nunca é devolvida ao navegador depois do salvamento."}
};

export function WhatsAppIntegrationModal({ initial, onClose, onSaved }: {
  initial: WhatsAppIntegrationState;
  onClose: () => void;
  onSaved: (state: WhatsAppIntegrationState, message: string) => void;
}) {
  const [state,setState]=useState(initial);
  const [runtime,setRuntime]=useState<WhatsAppRuntimeState>();
  const [runtimeBusy,setRuntimeBusy]=useState(false);
  const [runtimeError,setRuntimeError]=useState("");
  async function refreshRuntime() {
    setRuntimeBusy(true); setRuntimeError("");
    try { setRuntime(await ownerApi.whatsappRuntime()); }
    catch(cause) { setRuntimeError(cause instanceof Error ? cause.message : "Não foi possível consultar a sessão."); }
    finally { setRuntimeBusy(false); }
  }
  useEffect(()=>{ void refreshRuntime(); },[]);

  const [form,setForm]=useState({
    mode:initial.mode,
    businessAccountId:initial.businessAccountId,
    phoneNumberId:initial.phoneNumberId,
    humanSupportPhone:initial.humanSupportPhone? `+${initial.humanSupportPhone}`:"",
    businessPhone:initial.businessPhone?`+${initial.businessPhone}`:"",
    graphVersion:initial.graphVersion,
    otpTemplate:initial.otpTemplate,
    ownerAlertTemplate:initial.ownerAlertTemplate,
    decisionTemplate:initial.decisionTemplate,
    templateLanguage:initial.templateLanguage,
    accessToken:"",
    appSecret:"",
    verifyToken:"",
    wppUrl:initial.wppUrl,
    wppSession:initial.wppSession,
    wppToken:"",
    evolutionUrl:initial.evolutionUrl,
    evolutionInstance:initial.evolutionInstance,
    evolutionPhone:initial.evolutionPhone? `+${initial.evolutionPhone}`:"",
    evolutionWebhookSecret:"",
    evolutionApiKey:""
  });
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const [notice,setNotice]=useState("");
  const [generatedVerifyToken,setGeneratedVerifyToken]=useState("");
  const [help,setHelp]=useState<HelpTopic>();

  const modalRef=useModalLifecycle(()=>{if(help)setHelp(undefined);else onClose();});

  const metaMode=form.mode==="OFFICIAL" || form.mode==="META_GROUPS" || form.mode==="HYBRID_PLUS";
  const evolutionReady=Boolean(form.evolutionUrl && form.evolutionInstance && form.evolutionPhone && (form.evolutionApiKey || state.evolutionApiKeyConfigured) && (form.evolutionWebhookSecret || state.evolutionWebhookSecretConfigured));
  const modeCopy = form.mode==="HYBRID_PLUS" ? "Meta para mensagens; Evolution para grupos. Os dados são salvos juntos. A conexão de grupos depende da sessão Evolution pareada." : form.mode==="OFFICIAL"
    ? "Usa somente a plataforma oficial da Meta para mensagens, respostas automáticas e webhooks. É o modo recomendado para produção."
    : form.mode==="META_GROUPS"
      ? "Mantém a Meta como canal oficial e acrescenta o WPPConnect somente para grupos, membros e administradores."
      : form.mode==="EVOLUTION"
        ? "Envia e recebe mensagens pela sessão Evolution pareada e sincroniza os grupos vinculados. O envio respeita os limites e a cadência do número."
        : "Pausa o envio e a leitura por provedores externos. Nenhum dado salvo é apagado e a administração manual continua disponível.";
  const selectedModeHelp = form.mode==="HYBRID_PLUS" ? {title:"Híbrido+ · Meta e Evolution",body:"Combina a Meta para mensagens e a Evolution para grupos. Salvar atualiza também a aba Bot. Credenciais configuradas não significam grupos sincronizados: a execução depende da conexão real de cada motor."} : form.mode==="OFFICIAL"
    ? { title:"Como funciona o modo Meta Oficial?", body:"É o caminho mais estável: o SOS YouTube envia e recebe mensagens pela plataforma oficial da Meta. Ele exige a conta Business, o número cadastrado, as credenciais e o endereço de retorno configurados. É o modo recomendado para produção." }
    : form.mode==="META_GROUPS"
      ? { title:"O que muda em Meta + Grupos?", body:"O canal de mensagens continua sendo a Meta, mas acrescentamos o WPPConnect para consultar grupos tradicionais que a integração oficial pode não enxergar. Ele pode verificar membros e administradores, porém precisa de pareamento próprio e pode exigir reconexão após mudanças no WhatsApp." }
      : form.mode==="EVOLUTION"
        ? { title:"Como funciona o Evolution Gateway?", body:"O Evolution envia e recebe mensagens e consulta grupos pela instância pareada. Salvar credenciais não comprova conexão: confira o estado real da sessão. Códigos de autenticação oficiais da Meta continuam separados." }
        : { title:"O que acontece ao desativar?", body:"As automações externas ficam pausadas, mas nenhuma configuração, usuário, grupo, fila ou histórico é apagado. O dashboard continua disponível para administração manual e você pode reativar outro modo quando quiser." };

  async function save(event:FormEvent) {
    event.preventDefault(); setBusy(true); setError(""); setNotice("");
    try {
      const saved=await ownerApi.saveWhatsAppIntegration({
        mode:form.mode,
        businessAccountId:form.businessAccountId || undefined,
        phoneNumberId:form.phoneNumberId || undefined,
        businessPhone:form.businessPhone,
        humanSupportPhone:form.humanSupportPhone || undefined,
        graphVersion:form.graphVersion,
        otpTemplate:form.otpTemplate || undefined,
        ownerAlertTemplate:form.ownerAlertTemplate || undefined,
        decisionTemplate:form.decisionTemplate || undefined,
        templateLanguage:form.templateLanguage,
        accessToken:form.accessToken || undefined,
        appSecret:form.appSecret || undefined,
        verifyToken:form.verifyToken || undefined,
        wppUrl:form.wppUrl || undefined,
        wppSession:form.wppSession || undefined,
        wppToken:form.wppToken || undefined,
        evolutionUrl:form.evolutionUrl || undefined,
        evolutionInstance:form.evolutionInstance || undefined,
        evolutionPhone:form.evolutionPhone || undefined,
        evolutionWebhookSecret:form.evolutionWebhookSecret || undefined,
        evolutionApiKey:form.evolutionApiKey || undefined
      });
      setState(saved);
      setForm((current)=>({...current,businessPhone:saved.businessPhone?`+${saved.businessPhone}`:"",humanSupportPhone:saved.humanSupportPhone?`+${saved.humanSupportPhone}`:"",evolutionPhone:saved.evolutionPhone?`+${saved.evolutionPhone}`:"",accessToken:"",appSecret:"",verifyToken:"",wppToken:"",evolutionWebhookSecret:"",evolutionApiKey:""}));
      setNotice(saved.mode==="EVOLUTION"
        ? (saved.evolutionApiKeyConfigured ? "Evolution Gateway salvo no servidor." : "Evolution Gateway salvo. Ainda falta a API key.")
        : saved.mode==="DISABLED"
          ? "Integrações externas pausadas sem apagar a configuração."
          : saved.accessTokenConfigured
            ? "Configuração salva no servidor. Agora você pode validar a conexão com a Meta."
            : "Configuração salva. Para ativar o canal Meta ainda falta a credencial de acesso.");
      onSaved(saved,"Configuração WhatsApp salva.");
      await refreshRuntime();
    } catch(cause) { setError(cause instanceof Error ? cause.message : "Não foi possível salvar a integração."); }
    finally { setBusy(false); }
  }

  async function generateVerifyToken() {
    setBusy(true); setError(""); setNotice("");
    try {
      const result=await ownerApi.generateWhatsAppVerifyToken();
      setGeneratedVerifyToken(result.verifyToken);
      setState(result.state);
      setNotice("Token de verificação criado e salvo. Copie o valor abaixo para o painel da Meta.");
    } catch(cause) { setError(cause instanceof Error ? cause.message : "Não foi possível gerar o token de verificação."); }
    finally { setBusy(false); }
  }

  async function validate() {
    setBusy(true); setError(""); setNotice("");
    try {
      const result=await ownerApi.validateWhatsApp();
      const fresh=await ownerApi.whatsappIntegration();
      setState(fresh);
      setForm(current=>({...current,phoneNumberId:fresh.phoneNumberId,businessPhone:fresh.businessPhone?`+${fresh.businessPhone}`:""}));
      setNotice(`Conexão oficial validada com a Meta${result.phone.display_phone_number ? ` para ${result.phone.display_phone_number}` : ""}.`);
      onSaved(fresh,"Integração oficial validada.");
    } catch(cause) { setError(cause instanceof Error ? cause.message : "Não foi possível validar a conexão com a Meta."); }
    finally { setBusy(false); }
  }

  const HelpButton=({topic,label}:{topic:HelpTopic;label:string}) =>
    <button className="field-help" type="button" aria-label={label} onClick={()=>setHelp(topic)}><CircleHelp size={15}/></button>;

  return <div className="modal-backdrop integration-backdrop" onMouseDown={onClose}>
    <section ref={modalRef} className="modal integration-modal astra-integration-modal" role="dialog" aria-modal="true" aria-label="Configurar integração WhatsApp" onMouseDown={(e)=>e.stopPropagation()}>
      <button className="close" aria-label="Fechar configuração" onClick={onClose}>×</button>

      <div className="integration-title astra-modal-title">
        <span><Bot size={25}/></span>
        <div><p className="eyebrow dark">OWNER · AUTOMAÇÃO</p><h2>Configurar integração</h2><p className="muted">Os dados ficam salvos no servidor e permanecem disponíveis para os Owners mesmo após fechar o navegador.</p></div>
      </div>

      <div className="astra-status-grid">
        <article><span>Modo em edição</span><strong>{form.mode==="HYBRID_PLUS" ? "HÍBRIDO+" : form.mode==="META_GROUPS" ? "META + GRUPOS" : form.mode==="EVOLUTION" ? "EVOLUTION" : form.mode==="DISABLED" ? "DESATIVADO" : "OFICIAL"}</strong><small>{form.mode==="HYBRID_PLUS" ? "Meta + Evolution" : form.mode==="META_GROUPS" ? "Meta + WPPConnect para grupos" : form.mode==="EVOLUTION" ? "Gateway independente Evolution API" : form.mode==="DISABLED" ? "Automação externa pausada" : "Meta WhatsApp Business"}</small></article>
        <article><span>{form.mode==="EVOLUTION" ? "Gateway Evolution" : form.mode==="DISABLED" ? "Automação externa" : "Conexão Meta"}</span><strong>{form.mode==="EVOLUTION" ? (evolutionReady ? "CONFIGURADO" : "PENDENTE") : form.mode==="DISABLED" ? "PAUSADA" : state.tokenValidatedAt ? "VALIDADA" : "PENDENTE"}</strong><small>{form.mode==="EVOLUTION" ? (evolutionReady ? "Dados preenchidos. Consulte abaixo a sessão real." : "Preencha URL, instância, número, API key e segredo de retorno.") : form.mode==="DISABLED" ? "Nenhum provedor externo será usado." : state.tokenValidatedAt ? `Validada em ${new Date(state.tokenValidatedAt).toLocaleString("pt-BR")}` : "A Meta ainda não confirmou a credencial."}</small></article>
      </div>

      <section className="integration-section" aria-label="Estado real da conexão">
        <div className="integration-section-title"><div><p className="eyebrow dark">CONEXÃO NO SERVIDOR</p><h3>Sessão do WhatsApp</h3></div><button type="button" className="secondary compact" disabled={runtimeBusy} onClick={()=>void refreshRuntime()}>{runtimeBusy ? <LoaderCircle className="spin" size={16}/> : "Atualizar estado"}</button></div>
        {runtime ? <div role="status">
          <p><strong>{runtime.connected === true ? "Conectada" : runtime.connected === false ? "Desconectada" : "Conexão ainda não confirmada"}</strong> · Modo salvo: {runtime.mode}</p>
          {(runtime.mode==="EVOLUTION" || runtime.mode==="HYBRID_PLUS") && <p>Evolution: {runtime.evolution.connected ? "pareada e conectada" : runtime.evolution.state || "sem conexão confirmada"} · Instância {runtime.evolution.instance || "não configurada"}{runtime.evolution.phone ? ` · +${runtime.evolution.phone}` : ""}</p>}
          <small>Consulta em {new Date(runtime.checkedAt).toLocaleString("pt-BR")}. Este estado confirma a sessão, sem simular entrega de mensagens ou aprovação em grupos.</small>
          {runtime.otpBlockedReason && <p className="muted">{runtime.otpBlockedReason}</p>}
        </div> : !runtimeBusy && !runtimeError ? <p>Estado ainda não consultado.</p> : runtimeBusy ? <p>Consultando a conexão salva…</p> : null}
        {runtimeError && <p className="error" role="alert">{runtimeError}</p>}
      </section>

      {metaMode && !state.accessTokenConfigured && <div className="soft-token-message">
        <MessageCircleMore size={22}/>
        <p>Para ativar mensagens reais pela Meta ainda falta uma credencial de acesso chamada <strong>“System User Access Token”</strong>. Ela autoriza o SOS YouTube a conversar com sua conta Business sem depender de um login temporário. <HelpButton topic="token" label="Explicar a credencial de acesso da Meta"/></p>
      </div>}

      <form className="integration-form astra-integration-form" onSubmit={save}>
        <section className="integration-section">
          <div className="integration-section-title"><div><p className="eyebrow dark">MODO DE OPERAÇÃO</p><h3>Como o bot deve funcionar?</h3></div><HelpButton topic="mode" label="Explicar os modos de operação"/></div>
          <div className="mode-choice-grid" role="radiogroup" aria-label="Modo de operação">
            <button type="button" role="radio" aria-checked={form.mode==="OFFICIAL"} className={`mode-choice official ${form.mode==="OFFICIAL" ? "selected":""}`} onClick={()=>setForm({...form,mode:"OFFICIAL"})}>
              <span className="mode-symbol meta">∞</span><span><strong>Meta Oficial</strong><small>Mensagens, respostas e webhooks pela plataforma oficial.</small></span>
            </button>
            <button type="button" role="radio" aria-checked={form.mode==="META_GROUPS"} className={`mode-choice hybrid ${form.mode==="META_GROUPS" ? "selected":""}`} onClick={()=>setForm({...form,mode:"META_GROUPS"})}>
              <span className="mode-symbol hybrid" aria-hidden="true"><span className="meta-half">∞</span><span className="wpp-half">W</span></span><span><strong>Meta + Grupos</strong><small>Meta oficial + WPPConnect apenas para grupos, membros e admins.</small></span>
            </button>
            <button type="button" role="radio" aria-checked={form.mode==="HYBRID_PLUS"} className={"mode-choice hybrid-plus "+(form.mode==="HYBRID_PLUS"?"selected":"")} onClick={()=>setForm({...form,mode:"HYBRID_PLUS"})}>
              <span className="mode-symbol hybrid-fusion" aria-hidden="true"><span>∞</span><span>E</span></span><span><strong>Híbrido+</strong><small>Meta para mensagens + Evolution para grupos.</small></span>
            </button>
            <button type="button" role="radio" aria-checked={form.mode==="EVOLUTION"} className={`mode-choice evolution ${form.mode==="EVOLUTION" ? "selected":""}`} onClick={()=>setForm({...form,mode:"EVOLUTION"})}>
              <span className="mode-symbol evolution" aria-hidden="true">E</span><span><strong>Evolution Gateway</strong><small>Mensagens, atendimento e grupos pela sessão pareada.</small></span>
            </button>
            <button type="button" role="radio" aria-checked={form.mode==="DISABLED"} className={`mode-choice disabled ${form.mode==="DISABLED" ? "selected":""}`} onClick={()=>setForm({...form,mode:"DISABLED"})}>
              <span className="mode-symbol off">—</span><span><strong>Desativado</strong><small>Pausa automações sem apagar a configuração salva.</small></span>
            </button>
          </div>
          <p className="mode-explanation">{modeCopy} <HelpButton topic={form.mode==="META_GROUPS" ? "hybrid" : form.mode==="EVOLUTION" ? "evolution" : "mode"} label="Explicar o modo selecionado"/></p>
        </section>

        <section className="integration-section"><div className="integration-section-title"><div><p className="eyebrow dark">CONTATO DA COMUNIDADE</p><h3>WhatsApp do projeto</h3></div></div><label><span className="label-with-help"><MessageCircleMore size={15}/>Número do WhatsApp Business <HelpButton topic="businessPhone" label="Explicar número Business e atualização dos links"/></span><input aria-label="Número do WhatsApp Business" type="tel" inputMode="tel" autoComplete="tel" value={form.businessPhone} onChange={(e)=>setForm({...form,businessPhone:e.target.value})} placeholder="DDI, DDD e número"/><small>Salvo no servidor e compartilhado pelos links de participação. Pode ser alterado aqui.</small></label></section>

        <section className="integration-section"><div className="integration-section-title"><div><p className="eyebrow dark">ATENDIMENTO HUMANO</p><h3>Quem recebe o pedido de ajuda?</h3></div></div><label><span className="label-with-help">Número da pessoa que assume o atendimento <HelpButton topic="humanSupportPhone" label="Explicar destinatário do atendimento humano"/></span><input aria-label="Número da pessoa que assume o atendimento" type="tel" inputMode="tel" value={form.humanSupportPhone} onChange={e=>setForm({...form,humanSupportPhone:e.target.value})} placeholder="DDI, DDD e número"/><small>Recebe o aviso de pedido de ajuda. Este telefone é independente do número que atende automaticamente.</small></label></section>

        {metaMode && <section className="integration-section">
          <div className="integration-section-title"><div><p className="eyebrow dark">CONTA META</p><h3>Identificação da conta Business</h3></div><button className="help-text-button" type="button" onClick={()=>setHelp("meta")}><CircleHelp size={16}/>Onde encontro?</button></div>
          <div className="integration-grid">
            <label><span className="label-with-help">ID da conta do WhatsApp Business <HelpButton topic="waba" label="Explicar ID da conta do WhatsApp Business"/></span><input inputMode="numeric" value={form.businessAccountId} onChange={(e)=>setForm({...form,businessAccountId:e.target.value.replace(/\D/g,"")})} placeholder="Ex.: 123456789012345"/></label>
            <label><span className="label-with-help">ID do número do WhatsApp <HelpButton topic="phoneId" label="Explicar ID do número do WhatsApp"/></span><input inputMode="numeric" value={form.phoneNumberId} onChange={(e)=>setForm({...form,phoneNumberId:e.target.value.replace(/\D/g,"")})} placeholder="Identificador numérico fornecido pela Meta"/></label>

            <label>Versão da API<select value={form.graphVersion} onChange={(e)=>setForm({...form,graphVersion:e.target.value})}><option>v23.0</option><option>v24.0</option><option>v25.0</option></select></label>
          </div>
        </section>}

        {metaMode&&state.senderValidationRequired&&<p className="notice" role="status">O número ou as credenciais mudaram. Valide a integração com a Meta para liberar os envios pelo número correto.</p>}
        {metaMode && <section className="integration-section">
          <div className="integration-section-title"><div><p className="eyebrow dark">CREDENCIAIS</p><h3>Autorizar a comunicação com a Meta</h3></div><KeyRound size={20}/></div>
          <label><span className="label-with-help">Credencial de acesso da Meta <HelpButton topic="token" label="Explicar credencial de acesso da Meta"/></span><input aria-label="Credencial de acesso da Meta" type="password" value={form.accessToken} onChange={(e)=>setForm({...form,accessToken:e.target.value})} placeholder={state.accessTokenConfigured ? "Já configurada · deixe vazio para manter" : "Cole aqui a credencial quando estiver disponível"}/></label>
          <label><span className="label-with-help">Chave secreta do aplicativo <HelpButton topic="secret" label="Explicar chave secreta do aplicativo"/></span><input type="password" value={form.appSecret} onChange={(e)=>setForm({...form,appSecret:e.target.value})} placeholder={state.appSecretConfigured ? "Já configurada · deixe vazio para manter" : "Informe a chave fornecida pela Meta"}/></label>
          <div className="verify-token-row"><label><span className="label-with-help">Token de verificação <HelpButton topic="verify" label="Explicar token de verificação"/></span><input type="password" value={form.verifyToken} onChange={(e)=>setForm({...form,verifyToken:e.target.value})} placeholder={state.verifyTokenConfigured ? "Já configurado · deixe vazio para manter" : "Você pode gerar um token abaixo"}/></label><button className="secondary" type="button" disabled={busy} onClick={()=>void generateVerifyToken()}>Gerar token</button></div>
          {generatedVerifyToken && <div className="generated-token"><strong>Copie este valor agora</strong><code>{generatedVerifyToken}</code><small>Ele já está salvo de forma protegida no servidor e não será exibido novamente depois que esta janela for fechada.</small></div>}
        </section>}

        {metaMode && <section className="integration-section">
          <div className="integration-section-title"><div><p className="eyebrow dark">TEMPLATES META</p><h3>Mensagens aprovadas para o bot</h3></div><MessageCircleMore size={20}/></div>
          <p className="mode-explanation">Informe os nomes exatos dos templates aprovados no WhatsApp Manager. O SOS não cria nem aprova templates sozinho; estes campos apenas dizem ao backend quais modelos usar para cada mensagem transacional.</p>
          <div className="integration-grid">
            <label>Template do código de acesso<input value={form.otpTemplate} onChange={(e)=>setForm({...form,otpTemplate:e.target.value.toLowerCase().replace(/[^a-z0-9_]/g,"")})} placeholder="Ex.: sos_codigo_acesso"/></label>
            <label>Template de alerta aos Owners<input value={form.ownerAlertTemplate} onChange={(e)=>setForm({...form,ownerAlertTemplate:e.target.value.toLowerCase().replace(/[^a-z0-9_]/g,"")})} placeholder="Ex.: sos_novo_participante"/></label>
            <label>Template de decisão ao participante<input value={form.decisionTemplate} onChange={(e)=>setForm({...form,decisionTemplate:e.target.value.toLowerCase().replace(/[^a-z0-9_]/g,"")})} placeholder="Ex.: sos_decisao_cadastro"/></label>
            <label>Idioma dos templates<input value={form.templateLanguage} onChange={(e)=>setForm({...form,templateLanguage:e.target.value.replace(/[^A-Za-z_]/g,"")})} placeholder="pt_BR"/></label>
          </div>
          <div className="notice">
            <CheckCircle2 size={18}/>
            <span>{form.otpTemplate ? "Código de acesso nomeado" : "Falta o template do código"} · {form.ownerAlertTemplate ? "alerta Owner nomeado" : "falta o alerta Owner"} · {form.decisionTemplate ? "decisão nomeada" : "falta o template de decisão"}</span>
          </div>
        </section>}

        {(form.mode==="EVOLUTION" || form.mode==="HYBRID_PLUS") && <section className="integration-section evolution-section">
          <div className="integration-section-title"><div><p className="eyebrow dark">EVOLUTION GATEWAY</p><h3>{form.mode==="HYBRID_PLUS"?"Evolution · motor de grupos":"Instância independente"}</h3></div><Settings2 size={20}/></div>
          <p className="mode-explanation">URL, instância e chave ficam salvas no servidor. Salvar configura a conexão; o estado real depende do pareamento da instância com o número do bot.</p>
          <div className="integration-grid">
            <label><span className="label-with-help">URL do servidor Evolution <HelpButton topic="evolutionUrl" label="Explicar URL da Evolution API"/></span><input value={form.evolutionUrl} onChange={(e)=>setForm({...form,evolutionUrl:e.target.value})} placeholder="https://evolution.seudominio.com"/></label>
            <label><span className="label-with-help">Nome da instância <HelpButton topic="evolutionInstance" label="Explicar instância Evolution"/></span><input value={form.evolutionInstance} onChange={(e)=>setForm({...form,evolutionInstance:e.target.value.replace(/[^A-Za-z0-9_-]/g,"")})} placeholder="sos-youtuber"/></label>
          </div>
          <label><span className="label-with-help">Número que atende automaticamente <HelpButton topic="evolutionPhone" label="Explicar número do bot Evolution"/></span><input aria-label="Número que atende automaticamente" type="tel" inputMode="tel" value={form.evolutionPhone} onChange={e=>setForm({...form,evolutionPhone:e.target.value})} placeholder="DDI, DDD e número"/><small>Deve ser a conta pareada à instância acima. No modo Evolution, este é o contato público do bot.</small></label>
          <label><span className="label-with-help">Segredo de proteção do webhook Evolution <HelpButton topic="evolutionWebhookSecret" label="Explicar proteção do webhook Evolution"/></span><input type="password" autoComplete="new-password" minLength={24} maxLength={256} value={form.evolutionWebhookSecret} onChange={e=>setForm({...form,evolutionWebhookSecret:e.target.value})} placeholder={state.evolutionWebhookSecretConfigured ? "Já configurado · deixe vazio para manter" : "Informe o segredo do webhook"}/></label>
          <div className="webhook-line"><div><span>Endereço de retorno do Evolution</span><code>{state.evolutionWebhookUrl || state.webhookUrl.replace(/\/webhooks\/whatsapp$/, "/webhooks/whatsapp/evolution")}</code><small>Este endereço pertence ao backend e recebe os eventos da instância.</small></div></div>
          <label><span className="label-with-help">API key do Evolution <HelpButton topic="evolutionApiKey" label="Explicar API key Evolution"/></span><input type="password" value={form.evolutionApiKey} onChange={(e)=>setForm({...form,evolutionApiKey:e.target.value})} placeholder={state.evolutionApiKeyConfigured ? "Já configurada · deixe vazio para manter" : "Cole a API key do servidor"}/></label>
        </section>}

        {form.mode==="META_GROUPS" && <section className="integration-section hybrid-section">
          <div className="integration-section-title"><div><p className="eyebrow dark">COMPLEMENTO DE GRUPOS</p><h3>Verificação adicional pelo WhatsApp Web</h3></div><Settings2 size={20}/></div>
          <p className="mode-explanation">Este complemento pode ajudar a conferir grupos tradicionais, membros e administradores que a integração oficial não consiga enxergar. Ele exige pareamento próprio e pode precisar ser reconectado após mudanças no WhatsApp. A Meta continua sendo o canal principal de mensagens.</p>
          <div className="integration-grid">
            <label><span className="label-with-help">Endereço do servidor complementar <HelpButton topic="wppUrl" label="Explicar endereço do servidor complementar"/></span><input value={form.wppUrl} onChange={(e)=>setForm({...form,wppUrl:e.target.value})}/></label>
            <label><span className="label-with-help">Nome da sessão <HelpButton topic="wppSession" label="Explicar nome da sessão complementar"/></span><input value={form.wppSession} onChange={(e)=>setForm({...form,wppSession:e.target.value})}/></label>
          </div>
          <label><span className="label-with-help">Credencial do complemento <HelpButton topic="wppToken" label="Explicar credencial do complemento"/></span><input type="password" value={form.wppToken} onChange={(e)=>setForm({...form,wppToken:e.target.value})} placeholder={state.wppTokenConfigured ? "Já configurada · deixe vazio para manter" : "Opcional até o pareamento"}/></label>
        </section>}

        {metaMode && <div className="webhook-line">
          <div><span>Endereço de retorno da Meta <HelpButton topic="webhook" label="Explicar endereço de retorno da Meta"/></span><code>{state.webhookUrl}</code></div>
        </div>}

        {notice && <div className="notice" role="status"><CheckCircle2 size={18}/><span>{notice}</span></div>}
        {error && <p className="error banner" role="alert">{error}</p>}

        <div className="integration-actions">
          <button className="secondary" type="button" onClick={onClose}>Fechar</button>
          {metaMode && <button className="secondary" type="button" disabled={busy || !state.accessTokenConfigured} onClick={()=>void validate()}>{busy ? <LoaderCircle className="spin"/> : <CheckCircle2 size={17}/>}Validar conexão</button>}
          <button className="primary" disabled={busy}>{busy ? <LoaderCircle className="spin"/> : "Salvar configuração"}</button>
        </div>
      </form>

      {help && <div className="help-popover-backdrop" onMouseDown={()=>setHelp(undefined)}>
        <aside className="help-popover" role="dialog" aria-modal="true" aria-label={help==="mode" ? selectedModeHelp.title : HELP[help].title} onMouseDown={(e)=>e.stopPropagation()}>
          <button className="close" aria-label="Fechar explicação" onClick={()=>setHelp(undefined)}>×</button>
          <CircleHelp size={25}/>
          <h3>{help==="mode" ? selectedModeHelp.title : HELP[help].title}</h3>
          <p>{help==="mode" ? selectedModeHelp.body : HELP[help].body}</p>
          {help==="meta" && <a className="primary compact" href="https://developers.facebook.com/apps/" target="_blank" rel="noreferrer">Abrir Meta for Developers <ExternalLink size={15}/></a>}
        </aside>
      </div>}
    </section>
  </div>;
}
