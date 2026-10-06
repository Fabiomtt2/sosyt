import { useEffect, useState, type FormEvent } from "react";
import { Bot, CheckCircle2, CircleHelp, ExternalLink, KeyRound, LoaderCircle, MessageCircleMore, Settings2, Smartphone, Youtube } from "lucide-react";
import { ownerApi, type WhatsAppIntegrationState } from "./api";

type HelpTopic = "mode" | "hybrid" | "meta" | "waba" | "phoneId" | "token" | "secret" | "verify" | "webhook" | "wppUrl" | "wppSession" | "wppToken";

const HELP: Record<HelpTopic,{title:string;body:string}> = {
  mode:{title:"Qual modo devo usar?",body:"Meta oficial usa somente a plataforma oficial do WhatsApp Business para mensagens e webhooks. Híbrido mantém a Meta como canal principal e acrescenta um conector opcional para conferir grupos tradicionais, membros e administradores. Desativado pausa automações externas sem apagar os dados já salvos."},
  hybrid:{title:"O que muda no modo híbrido?",body:"O modo híbrido não substitui a Meta. As mensagens oficiais continuam pela plataforma Business; o complemento entra apenas para conferir grupos tradicionais, membros e administradores quando a API oficial não os expõe. Ele usa uma sessão separada do WhatsApp Web, pode pedir novo QR após mudanças do WhatsApp e deve ser ativado conscientemente."},
  meta:{title:"Onde encontro esses dados?",body:"Entre no Meta for Developers com a conta responsável pelo negócio, abra ou crie o aplicativo e adicione o produto WhatsApp. Depois, no WhatsApp Manager, você verá a conta do WhatsApp Business, o número comercial e as credenciais necessárias. Se algum item não aparecer, a conta pode precisar de verificação ou permissão adicional."},
  waba:{title:"ID da conta do WhatsApp Business",body:"É o identificador numérico da sua conta empresarial do WhatsApp na Meta. O termo técnico usado pela Meta é “WABA ID”. Ele identifica a conta Business, não o número de telefone."},
  phoneId:{title:"ID do número do WhatsApp",body:"É o identificador que a Meta atribui ao número comercial dentro do WhatsApp Business Platform. O termo técnico é “Phone Number ID”. Ele é diferente do número de telefone escrito com +55."},
  token:{title:"Credencial de acesso da Meta",body:"Para o sistema conversar com a Meta sem depender de uma sessão temporária, é necessário um token permanente ou de longa duração de um usuário do sistema. A Meta chama essa credencial de “System User Access Token”. Depois de colado aqui, ele fica criptografado no servidor e não é exibido novamente."},
  secret:{title:"Chave secreta do aplicativo",body:"É a chave privada do aplicativo criado no Meta for Developers, chamada tecnicamente de “App Secret”. Ela permite conferir se os webhooks recebidos vieram realmente da Meta. Não compartilhe essa chave fora da administração."},
  verify:{title:"Token de verificação",body:"É uma senha criada por nós para confirmar à Meta que este endereço de webhook pertence ao SOS YouTube. O termo técnico é “Verify Token”. Você pode gerar uma nova aqui e copiá-la uma única vez para o painel da Meta."},
  webhook:{title:"Endereço de retorno da Meta",body:"É o endereço público HTTPS para onde a Meta envia eventos do WhatsApp. O termo técnico é “webhook”. A página pública pode ficar no GitHub Pages, mas este endereço precisa apontar para o backend online, porque é o servidor que recebe mensagens, confirma eventos e acessa o banco."},
  wppUrl:{title:"Endereço do servidor complementar",body:"É o endereço onde o complemento WPPConnect ficará disponível. Ele é usado apenas no modo Híbrido para consultar grupos tradicionais, participantes e administradores. Quando rodar neste computador, costuma apontar para o próprio Xubuntu; quando for publicado, pode usar outro servidor protegido."},
  wppSession:{title:"Nome da sessão complementar",body:"É apenas um nome interno para identificar a sessão pareada do WhatsApp Web, por exemplo “sos-youtube”. Não é seu número de telefone e não aparece para os participantes."},
  wppToken:{title:"Credencial do complemento",body:"É a senha usada para impedir que outras pessoas chamem o servidor complementar. Ela fica protegida no servidor do SOS YouTube e é necessária quando o WPPConnect exigir autenticação."}
};

export function WhatsAppIntegrationModal({ initial, onClose, onSaved }: {
  initial: WhatsAppIntegrationState;
  onClose: () => void;
  onSaved: (state: WhatsAppIntegrationState, message: string) => void;
}) {
  const [state,setState]=useState(initial);
  const [form,setForm]=useState({
    mode:initial.mode,
    businessAccountId:initial.businessAccountId,
    phoneNumberId:initial.phoneNumberId,
    businessPhone:initial.businessPhone,
    graphVersion:initial.graphVersion,
    accessToken:"",
    appSecret:"",
    verifyToken:"",
    wppUrl:initial.wppUrl,
    wppSession:initial.wppSession,
    wppToken:""
  });
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const [notice,setNotice]=useState("");
  const [generatedVerifyToken,setGeneratedVerifyToken]=useState("");
  const [help,setHelp]=useState<HelpTopic>();

  useEffect(()=>{
    const previousOverflow=document.body.style.overflow;
    document.body.style.overflow="hidden";
    const onKey=(event:KeyboardEvent)=>{
      if (event.key!=="Escape") return;
      if (help) setHelp(undefined); else onClose();
    };
    document.addEventListener("keydown",onKey);
    return ()=>{ document.removeEventListener("keydown",onKey); document.body.style.overflow=previousOverflow; };
  },[help,onClose]);

  const modeCopy = form.mode==="OFFICIAL"
    ? "Usa somente a plataforma oficial da Meta para mensagens, respostas automáticas e webhooks. É o modo recomendado para produção."
    : form.mode==="HYBRID"
      ? "Mantém a Meta como canal oficial e acrescenta, de forma opcional, um complemento para conferir grupos tradicionais, membros e administradores."
      : "Pausa o envio e a leitura por provedores externos. Nenhum dado salvo é apagado e a administração manual continua disponível.";
  const selectedModeHelp = form.mode==="OFFICIAL"
    ? { title:"Como funciona o modo Meta Oficial?", body:"É o caminho mais estável: o SOS YouTube envia e recebe mensagens pela plataforma oficial da Meta. Ele exige a conta Business, o número cadastrado, as credenciais e o endereço de retorno configurados. É o modo recomendado para produção." }
    : form.mode==="HYBRID"
      ? { title:"O que muda no modo híbrido?", body:"O canal de mensagens continua sendo a Meta, mas acrescentamos o WPPConnect para consultar grupos tradicionais que a integração oficial pode não enxergar. Ele pode verificar membros e administradores, porém precisa de pareamento próprio e pode exigir reconexão após mudanças no WhatsApp. Por isso é complementar, não substituto da Meta." }
      : { title:"O que acontece ao desativar?", body:"As automações externas ficam pausadas, mas nenhuma configuração, usuário, grupo, fila ou histórico é apagado. O dashboard continua disponível para administração manual e você pode reativar outro modo quando quiser." };

  async function save(event:FormEvent) {
    event.preventDefault(); setBusy(true); setError(""); setNotice("");
    try {
      const saved=await ownerApi.saveWhatsAppIntegration({
        mode:form.mode,
        businessAccountId:form.businessAccountId || undefined,
        phoneNumberId:form.phoneNumberId || undefined,
        businessPhone:form.businessPhone || undefined,
        graphVersion:form.graphVersion,
        accessToken:form.accessToken || undefined,
        appSecret:form.appSecret || undefined,
        verifyToken:form.verifyToken || undefined,
        wppUrl:form.wppUrl || undefined,
        wppSession:form.wppSession || undefined,
        wppToken:form.wppToken || undefined
      });
      setState(saved);
      setForm((current)=>({...current,accessToken:"",appSecret:"",verifyToken:"",wppToken:""}));
      setNotice(saved.accessTokenConfigured
        ? "Configuração salva no servidor. Agora você pode validar a conexão com a Meta."
        : "Configuração salva. Para ativar o canal oficial ainda falta a credencial de acesso da Meta.");
      onSaved(saved,"Configuração WhatsApp salva.");
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
      setNotice(`Conexão oficial validada com a Meta${result.phone.display_phone_number ? ` para ${result.phone.display_phone_number}` : ""}.`);
      onSaved(fresh,"Integração oficial validada.");
    } catch(cause) { setError(cause instanceof Error ? cause.message : "Não foi possível validar a conexão com a Meta."); }
    finally { setBusy(false); }
  }

  const HelpButton=({topic,label}:{topic:HelpTopic;label:string}) =>
    <button className="field-help" type="button" aria-label={label} onClick={()=>setHelp(topic)}><CircleHelp size={15}/></button>;

  return <div className="modal-backdrop integration-backdrop" onMouseDown={onClose}>
    <section className="modal integration-modal astra-integration-modal" role="dialog" aria-modal="true" aria-label="Configurar integração WhatsApp" onMouseDown={(e)=>e.stopPropagation()}>
      <button className="close" aria-label="Fechar configuração" onClick={onClose}>×</button>

      <div className="integration-title astra-modal-title">
        <span><Bot size={25}/></span>
        <div><p className="eyebrow dark">OWNER · AUTOMAÇÃO</p><h2>Configurar integração</h2><p className="muted">Os dados ficam salvos no servidor e permanecem disponíveis para os Owners mesmo após fechar o navegador.</p></div>
      </div>

      <div className="astra-status-grid">
        <article><span>Canal selecionado</span><strong>{state.mode==="HYBRID" ? "HÍBRIDO" : state.mode==="DISABLED" ? "DESATIVADO" : "OFICIAL"}</strong><small>{state.mode==="HYBRID" ? "Meta + complemento opcional" : state.mode==="DISABLED" ? "Automação externa pausada" : "Meta WhatsApp Business"}</small></article>
        <article><span>Conexão oficial</span><strong>{state.tokenValidatedAt ? "VALIDADA" : "PENDENTE"}</strong><small>{state.tokenValidatedAt ? `Validada em ${new Date(state.tokenValidatedAt).toLocaleString("pt-BR")}` : "A Meta ainda não confirmou a credencial."}</small></article>
      </div>

      {!state.accessTokenConfigured && <div className="soft-token-message">
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
            <button type="button" role="radio" aria-checked={form.mode==="HYBRID"} className={`mode-choice hybrid ${form.mode==="HYBRID" ? "selected":""}`} onClick={()=>setForm({...form,mode:"HYBRID"})}>
              <span className="mode-symbol hybrid" aria-hidden="true"><span className="meta-half">∞</span><span className="youtube-half"><Youtube size={17} fill="currentColor"/></span></span><span><strong>Híbrido</strong><small>Meta oficial + complemento para conferir grupos tradicionais.</small></span>
            </button>
            <button type="button" role="radio" aria-checked={form.mode==="DISABLED"} className={`mode-choice disabled ${form.mode==="DISABLED" ? "selected":""}`} onClick={()=>setForm({...form,mode:"DISABLED"})}>
              <span className="mode-symbol off">—</span><span><strong>Desativado</strong><small>Pausa automações sem apagar a configuração salva.</small></span>
            </button>
          </div>
          <p className="mode-explanation">{modeCopy} <HelpButton topic={form.mode==="HYBRID" ? "hybrid" : "mode"} label="Explicar o modo selecionado"/></p>
        </section>

        {form.mode!=="DISABLED" && <section className="integration-section">
          <div className="integration-section-title"><div><p className="eyebrow dark">CONTA META</p><h3>Identificação da conta Business</h3></div><button className="help-text-button" type="button" onClick={()=>setHelp("meta")}><CircleHelp size={16}/>Onde encontro?</button></div>
          <div className="integration-grid">
            <label><span className="label-with-help">ID da conta do WhatsApp Business <HelpButton topic="waba" label="Explicar ID da conta do WhatsApp Business"/></span><input inputMode="numeric" value={form.businessAccountId} onChange={(e)=>setForm({...form,businessAccountId:e.target.value.replace(/\D/g,"")})} placeholder="Ex.: 123456789012345"/></label>
            <label><span className="label-with-help">ID do número do WhatsApp <HelpButton topic="phoneId" label="Explicar ID do número do WhatsApp"/></span><input inputMode="numeric" value={form.phoneNumberId} onChange={(e)=>setForm({...form,phoneNumberId:e.target.value.replace(/\D/g,"")})} placeholder="Identificador numérico fornecido pela Meta"/></label>
            <label><span className="label-with-help"><MessageCircleMore size={15}/>Número do WhatsApp Business</span><input value={form.businessPhone} onChange={(e)=>setForm({...form,businessPhone:e.target.value})} placeholder="+55 71 ..."/></label>
            <label>Versão da API<select value={form.graphVersion} onChange={(e)=>setForm({...form,graphVersion:e.target.value})}><option>v23.0</option><option>v24.0</option><option>v25.0</option></select></label>
          </div>
        </section>}

        {form.mode!=="DISABLED" && <section className="integration-section">
          <div className="integration-section-title"><div><p className="eyebrow dark">CREDENCIAIS</p><h3>Autorizar a comunicação com a Meta</h3></div><KeyRound size={20}/></div>
          <label><span className="label-with-help">Credencial de acesso da Meta <HelpButton topic="token" label="Explicar credencial de acesso da Meta"/></span><input aria-label="Credencial de acesso da Meta" type="password" value={form.accessToken} onChange={(e)=>setForm({...form,accessToken:e.target.value})} placeholder={state.accessTokenConfigured ? "Já configurada · deixe vazio para manter" : "Cole aqui a credencial quando estiver disponível"}/></label>
          <label><span className="label-with-help">Chave secreta do aplicativo <HelpButton topic="secret" label="Explicar chave secreta do aplicativo"/></span><input type="password" value={form.appSecret} onChange={(e)=>setForm({...form,appSecret:e.target.value})} placeholder={state.appSecretConfigured ? "Já configurada · deixe vazio para manter" : "Informe a chave fornecida pela Meta"}/></label>
          <div className="verify-token-row"><label><span className="label-with-help">Token de verificação <HelpButton topic="verify" label="Explicar token de verificação"/></span><input type="password" value={form.verifyToken} onChange={(e)=>setForm({...form,verifyToken:e.target.value})} placeholder={state.verifyTokenConfigured ? "Já configurado · deixe vazio para manter" : "Você pode gerar um token abaixo"}/></label><button className="secondary" type="button" disabled={busy} onClick={()=>void generateVerifyToken()}>Gerar token</button></div>
          {generatedVerifyToken && <div className="generated-token"><strong>Copie este valor agora</strong><code>{generatedVerifyToken}</code><small>Ele já está salvo de forma protegida no servidor e não será exibido novamente depois que esta janela for fechada.</small></div>}
        </section>}

        {form.mode==="HYBRID" && <section className="integration-section hybrid-section">
          <div className="integration-section-title"><div><p className="eyebrow dark">COMPLEMENTO DE GRUPOS</p><h3>Verificação adicional pelo WhatsApp Web</h3></div><Settings2 size={20}/></div>
          <p className="mode-explanation">Este complemento pode ajudar a conferir grupos tradicionais, membros e administradores que a integração oficial não consiga enxergar. Ele exige pareamento próprio e pode precisar ser reconectado após mudanças no WhatsApp. A Meta continua sendo o canal principal de mensagens.</p>
          <div className="integration-grid">
            <label><span className="label-with-help">Endereço do servidor complementar <HelpButton topic="wppUrl" label="Explicar endereço do servidor complementar"/></span><input value={form.wppUrl} onChange={(e)=>setForm({...form,wppUrl:e.target.value})}/></label>
            <label><span className="label-with-help">Nome da sessão <HelpButton topic="wppSession" label="Explicar nome da sessão complementar"/></span><input value={form.wppSession} onChange={(e)=>setForm({...form,wppSession:e.target.value})}/></label>
          </div>
          <label><span className="label-with-help">Credencial do complemento <HelpButton topic="wppToken" label="Explicar credencial do complemento"/></span><input type="password" value={form.wppToken} onChange={(e)=>setForm({...form,wppToken:e.target.value})} placeholder={state.wppTokenConfigured ? "Já configurada · deixe vazio para manter" : "Opcional até o pareamento"}/></label>
        </section>}

        {form.mode!=="DISABLED" && <div className="webhook-line">
          <div><span>Endereço de retorno da Meta <HelpButton topic="webhook" label="Explicar endereço de retorno da Meta"/></span><code>{state.webhookUrl}</code></div>
        </div>}

        {notice && <div className="notice" role="status"><CheckCircle2 size={18}/><span>{notice}</span></div>}
        {error && <p className="error banner" role="alert">{error}</p>}

        <div className="integration-actions">
          <button className="secondary" type="button" onClick={onClose}>Fechar</button>
          {form.mode!=="DISABLED" && <button className="secondary" type="button" disabled={busy || !state.accessTokenConfigured} onClick={()=>void validate()}>{busy ? <LoaderCircle className="spin"/> : <CheckCircle2 size={17}/>}Validar conexão</button>}
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
