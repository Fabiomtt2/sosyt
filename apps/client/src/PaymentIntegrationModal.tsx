import { useEffect, useState } from "react";
import { Check, ExternalLink, HelpCircle, Landmark, PauseCircle, ShieldCheck, X } from "lucide-react";
import { ownerApi, type PaymentIntegrationState } from "./api";

type Provider = Exclude<PaymentIntegrationState["provider"],"DISABLED">;
type HelpTopic = "provider-mp" | "provider-asaas" | "provider-pagbank" | "environment" | "mp-access" | "mp-webhook" | "asaas-api" | "asaas-webhook" | "pagbank-token" | "webhook";

const labels: Record<PaymentIntegrationState["provider"],string> = {
  MERCADO_PAGO:"Mercado Pago",
  ASAAS:"Asaas",
  PAGBANK:"PagBank",
  DISABLED:"Desativado"
};

const help: Record<HelpTopic,{title:string;body:string;steps?:string[];url?:string}> = {
  "provider-mp":{
    title:"Quando escolher Mercado Pago?",
    body:"Escolha se você já usa ou prefere a conta Mercado Pago. O SOS cria um QR Pix para cada pacote e só libera as moedas depois de confirmar o pagamento com o próprio Mercado Pago.",
    steps:["Tenha uma aplicação criada no painel Mercado Pago.","Copie a chave de acesso da aplicação.","Configure/revele a chave secreta dos avisos automáticos (webhook)."],
    url:"https://www.mercadopago.com.br/developers/pt/docs/checkout-api-payments/integration-configuration/integrate-pix?scope=prod"
  },
  "provider-asaas":{
    title:"Quando escolher Asaas?",
    body:"Escolha se quer uma integração brasileira focada em cobranças. O SOS cria a cobrança Pix, busca o QR Code e pode cadastrar automaticamente o endereço que recebe as confirmações de pagamento.",
    steps:["Use uma conta Asaas aprovada para receber Pix.","Copie a API Key da conta.","Crie uma senha segura para os avisos automáticos; o SOS tenta registrar o webhook ao salvar."],
    url:"https://docs.asaas.com/docs/pix"
  },
  "provider-pagbank":{
    title:"Quando escolher PagBank?",
    body:"Escolha se sua operação financeira está no PagBank/PagSeguro. O SOS cria o pedido Pix e verifica a assinatura digital enviada pelo PagBank antes de liberar moedas.",
    steps:["Tenha uma chave Pix ativa na conta PagBank.","Obtenha o token da API da conta.","Cole o token aqui; o SOS envia seu endereço de confirmação em cada pedido."],
    url:"https://developer.pagbank.com.br/reference/criar-pedido-com-qr-code-pix-v2"
  },
  environment:{
    title:"Produção ou Teste?",
    body:"Seu SOS YouTuber já tem backend e endereço público. Este controle NÃO liga nem desliga o servidor. Ele escolhe apenas quais credenciais do provedor serão usadas.",
    steps:["Produção: dinheiro real e credenciais reais da sua conta.","Teste: ambiente de simulação fornecido pelo banco para validar a integração sem cobrar usuários."]
  },
  "mp-access":{
    title:"Chave de acesso do Mercado Pago",
    body:"É a senha que permite ao servidor criar e consultar pagamentos na sua conta. No painel do Mercado Pago ela costuma aparecer como Access Token.",
    steps:["Copie somente da sua aplicação oficial.","Cole aqui e salve.","Depois de salvar, a chave fica criptografada e não volta para a tela."]
  },
  "mp-webhook":{
    title:"Chave dos avisos do Mercado Pago",
    body:"Quando o Mercado Pago avisa que um Pix mudou de status, ele assina esse aviso. Esta chave permite ao SOS conferir se a mensagem veio realmente do Mercado Pago.",
    steps:["Abra sua aplicação no Mercado Pago.","Entre em Webhooks/Notificações.","Revele a chave secreta e cole aqui."]
  },
  "asaas-api":{
    title:"Chave de acesso do Asaas",
    body:"É a credencial que permite ao SOS criar cobranças, consultar pagamentos e obter o QR Code Pix na sua conta Asaas. No Asaas ela aparece como API Key."
  },
  "asaas-webhook":{
    title:"Senha dos avisos do Asaas",
    body:"É uma senha criada por você para proteger os avisos automáticos enviados pelo Asaas. Use de 32 a 255 caracteres difíceis de adivinhar. O SOS guarda essa senha criptografada."
  },
  "pagbank-token":{
    title:"Token de integração PagBank",
    body:"É a chave que autoriza o SOS a criar e consultar pedidos na sua conta PagBank. Depois de salvo, o token fica criptografado no servidor e não aparece novamente."
  },
  webhook:{
    title:"Endereço de confirmação automática",
    body:"É a porta pública do SOS YouTuber que recebe avisos do provedor quando um Pix muda de status. Você não precisa decorar esse endereço; ele é gerado a partir do backend público."
  }
};

function HelpButton({topic,label,onOpen}:{topic:HelpTopic;label:string;onOpen:(topic:HelpTopic)=>void}) {
  return <button type="button" className="payment-help-icon" aria-label={label} title={label} onClick={()=>onOpen(topic)}><HelpCircle size={16}/></button>;
}

export function PaymentIntegrationModal({ initial,onClose,onSaved }:{
  initial:PaymentIntegrationState;
  onClose:()=>void;
  onSaved:(state:PaymentIntegrationState,message:string)=>void;
}) {
  const [state,setState]=useState(initial);
  const [provider,setProvider]=useState(initial.provider);
  const [environment,setEnvironment]=useState(initial.environment);
  const [mercadoPagoAccessToken,setMercadoPagoAccessToken]=useState("");
  const [mercadoPagoWebhookSecret,setMercadoPagoWebhookSecret]=useState("");
  const [asaasApiKey,setAsaasApiKey]=useState("");
  const [asaasWebhookToken,setAsaasWebhookToken]=useState("");
  const [pagBankToken,setPagBankToken]=useState("");
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const [notice,setNotice]=useState("");
  const [helpTopic,setHelpTopic]=useState<HelpTopic>();

  useEffect(()=>{
    const previousOverflow=document.body.style.overflow;
    document.body.style.overflow="hidden";
    const escape=(event:KeyboardEvent)=>{
      if(event.key!=="Escape") return;
      if(helpTopic) setHelpTopic(undefined);
      else onClose();
    };
    document.addEventListener("keydown",escape);
    return ()=>{
      document.body.style.overflow=previousOverflow;
      document.removeEventListener("keydown",escape);
    };
  },[helpTopic,onClose]);

  const activeHelp=helpTopic ? help[helpTopic] : undefined;
  const webhookUrl=provider==="MERCADO_PAGO" ? state.webhookUrls.mercadoPago : provider==="ASAAS" ? state.webhookUrls.asaas : provider==="PAGBANK" ? state.webhookUrls.pagBank : "";
  const providerConfigured=provider==="MERCADO_PAGO"
    ? state.mercadoPagoAccessTokenConfigured && state.mercadoPagoWebhookSecretConfigured
    : provider==="ASAAS"
      ? state.asaasApiKeyConfigured && state.asaasWebhookTokenConfigured
      : provider==="PAGBANK"
        ? state.pagBankTokenConfigured
        : false;

  function selectProvider(next:Provider) {
    setProvider(next);
    setError("");
    setNotice("");
  }

  async function save() {
    setBusy(true); setError(""); setNotice("");
    try {
      const saved=await ownerApi.savePaymentIntegration({
        provider,environment,
        mercadoPagoAccessToken:mercadoPagoAccessToken || undefined,
        mercadoPagoWebhookSecret:mercadoPagoWebhookSecret || undefined,
        asaasApiKey:asaasApiKey || undefined,
        asaasWebhookToken:asaasWebhookToken || undefined,
        pagBankToken:pagBankToken || undefined
      });
      setState(saved);
      setMercadoPagoAccessToken(""); setMercadoPagoWebhookSecret("");
      setAsaasApiKey(""); setAsaasWebhookToken(""); setPagBankToken("");
      const message=saved.providerSetup?.message ?? (saved.provider==="DISABLED" ? "Novas compras reais foram pausadas. Saldos e histórico foram preservados." : `${labels[saved.provider]} salvo como provedor de novas compras.`);
      if (saved.providerSetup && !saved.providerSetup.ok) setError(message);
      else setNotice(message);
      onSaved(saved,message);
    } catch(cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível salvar a configuração de pagamento.");
    } finally {
      setBusy(false);
    }
  }

  return <div className="modal-backdrop payment-config-backdrop" onMouseDown={onClose} onWheel={(event)=>event.stopPropagation()}>
    <section className="modal payment-config-modal" role="dialog" aria-modal="true" aria-label="Configurar pagamentos" onMouseDown={(event)=>event.stopPropagation()}>
      <button className="close payment-close" aria-label="Fechar configuração de pagamentos" onClick={onClose}><X size={20}/></button>

      <div className="payment-modal-header">
        <p className="eyebrow dark">PAGAMENTOS · PACOTES DE MOEDAS</p>
        <h2><Landmark size={23}/> Pagamentos por Pix</h2>
        <p>Seu backend já está online. Aqui o Owner escolhe <strong>onde as novas compras de moedas serão cobradas</strong>. Trocar de provedor não altera moedas, passes, carteiras ou transações antigas.</p>
      </div>

      <div className="payment-setup-steps" aria-label="Como configurar">
        <span><b>1</b>Escolha o provedor</span>
        <span><b>2</b>Cole as chaves da conta</span>
        <span><b>3</b>Salve e acompanhe as confirmações</span>
      </div>

      <section className="payment-config-section">
        <div className="payment-section-heading"><div><span className="payment-step-label">1 · ESCOLHA</span><h3>Onde você quer receber o Pix?</h3></div></div>
        <div className="payment-provider-grid">
          <article className={`payment-provider-card ${provider==="MERCADO_PAGO" ? "selected":""}`}>
            <button type="button" className="payment-provider-select" aria-pressed={provider==="MERCADO_PAGO"} onClick={()=>selectProvider("MERCADO_PAGO")}>
              <strong>Mercado Pago</strong><small>Boa escolha se sua operação já usa Mercado Pago. Cria QR Pix e confirma o pagamento automaticamente.</small>
            </button>
            <HelpButton topic="provider-mp" label="Explicar Mercado Pago" onOpen={setHelpTopic}/>
          </article>
          <article className={`payment-provider-card ${provider==="ASAAS" ? "selected":""}`}>
            <button type="button" className="payment-provider-select" aria-pressed={provider==="ASAAS"} onClick={()=>selectProvider("ASAAS")}>
              <strong>Asaas</strong><small>Focado em cobranças. O SOS cria o Pix, busca o QR Code e pode configurar o aviso automático ao salvar.</small>
            </button>
            <HelpButton topic="provider-asaas" label="Explicar Asaas" onOpen={setHelpTopic}/>
          </article>
          <article className={`payment-provider-card ${provider==="PAGBANK" ? "selected":""}`}>
            <button type="button" className="payment-provider-select" aria-pressed={provider==="PAGBANK"} onClick={()=>selectProvider("PAGBANK")}>
              <strong>PagBank</strong><small>Para contas PagBank/PagSeguro. Cria o pedido Pix e confere a assinatura antes de liberar moedas.</small>
            </button>
            <HelpButton topic="provider-pagbank" label="Explicar PagBank" onOpen={setHelpTopic}/>
          </article>
        </div>
        <button type="button" className={`payment-pause-choice ${provider==="DISABLED" ? "selected":""}`} onClick={()=>setProvider("DISABLED")}>
          <PauseCircle size={18}/><span><strong>Pausar novas compras reais</strong><small>Não apaga saldos, moedas, passes nem histórico.</small></span>
        </button>
      </section>

      {activeHelp && <aside className="payment-help-panel" role="dialog" aria-label={activeHelp.title}>
        <button className="payment-help-close" type="button" aria-label="Fechar explicação" onClick={()=>setHelpTopic(undefined)}>×</button>
        <div>
          <p className="eyebrow dark">EXPLICAÇÃO SIMPLES</p>
          <h3>{activeHelp.title}</h3>
          <p>{activeHelp.body}</p>
          {activeHelp.steps && <ol>{activeHelp.steps.map((step)=><li key={step}>{step}</li>)}</ol>}
          {activeHelp.url && <a href={activeHelp.url} target="_blank" rel="noreferrer">Abrir guia oficial <ExternalLink size={14}/></a>}
        </div>
      </aside>}

      {provider!=="DISABLED" && <section className="payment-config-section">
        <div className="payment-section-heading"><div><span className="payment-step-label">2 · CONTA</span><h3>Use dinheiro real ou ambiente de teste?</h3></div><HelpButton topic="environment" label="Explicar Produção e Teste" onOpen={setHelpTopic}/></div>
        <p className="payment-plain-note"><strong>O SOS YouTuber já está publicado.</strong> Esta escolha muda apenas as credenciais usadas no provedor.</p>
        <div className="payment-environment-choice" role="radiogroup" aria-label="Ambiente do provedor">
          <button type="button" role="radio" aria-checked={environment==="PRODUCTION"} className={environment==="PRODUCTION" ? "selected":""} onClick={()=>setEnvironment("PRODUCTION")}><strong>Produção</strong><small>Pix e dinheiro reais</small></button>
          <button type="button" role="radio" aria-checked={environment==="SANDBOX"} className={environment==="SANDBOX" ? "selected":""} onClick={()=>setEnvironment("SANDBOX")}><strong>Teste</strong><small>Credenciais de simulação</small></button>
        </div>
      </section>}

      {provider==="MERCADO_PAGO" && <section className="payment-config-section payment-provider-fields">
        <div className="payment-section-heading"><div><span className="payment-step-label">3 · CHAVES</span><h3>Dados da sua aplicação Mercado Pago</h3></div></div>
        <label><span className="label-with-help">Chave de acesso <HelpButton topic="mp-access" label="Explicar chave de acesso do Mercado Pago" onOpen={setHelpTopic}/></span>
          <input type="password" value={mercadoPagoAccessToken} onChange={(event)=>setMercadoPagoAccessToken(event.target.value)} placeholder={state.mercadoPagoAccessTokenConfigured ? "Já configurada · deixe vazio para manter" : "Cole a chave da sua aplicação"}/>
          <small className="field-help-copy">No Mercado Pago, esta chave aparece como <strong>Access Token</strong>.</small>
        </label>
        <label><span className="label-with-help">Chave que confirma os avisos <HelpButton topic="mp-webhook" label="Explicar chave dos avisos do Mercado Pago" onOpen={setHelpTopic}/></span>
          <input type="password" value={mercadoPagoWebhookSecret} onChange={(event)=>setMercadoPagoWebhookSecret(event.target.value)} placeholder={state.mercadoPagoWebhookSecretConfigured ? "Já configurada · deixe vazio para manter" : "Cole a chave secreta do webhook"}/>
          <small className="field-help-copy">Serve para o SOS ter certeza de que o aviso de pagamento veio do Mercado Pago.</small>
        </label>
      </section>}

      {provider==="ASAAS" && <section className="payment-config-section payment-provider-fields">
        <div className="payment-section-heading"><div><span className="payment-step-label">3 · CHAVES</span><h3>Dados da sua conta Asaas</h3></div></div>
        <label><span className="label-with-help">Chave de acesso <HelpButton topic="asaas-api" label="Explicar chave de acesso do Asaas" onOpen={setHelpTopic}/></span>
          <input type="password" value={asaasApiKey} onChange={(event)=>setAsaasApiKey(event.target.value)} placeholder={state.asaasApiKeyConfigured ? "Já configurada · deixe vazio para manter" : "Cole a API Key do Asaas"}/>
        </label>
        <label><span className="label-with-help">Senha dos avisos automáticos <HelpButton topic="asaas-webhook" label="Explicar senha dos avisos do Asaas" onOpen={setHelpTopic}/></span>
          <input type="password" minLength={32} maxLength={255} value={asaasWebhookToken} onChange={(event)=>setAsaasWebhookToken(event.target.value)} placeholder={state.asaasWebhookTokenConfigured ? "Já configurada · deixe vazio para manter" : "Crie uma senha segura de 32 a 255 caracteres"}/>
          <small className="field-help-copy">Ao salvar, o SOS tenta cadastrar/atualizar automaticamente o endereço de confirmação no Asaas.</small>
        </label>
      </section>}

      {provider==="PAGBANK" && <section className="payment-config-section payment-provider-fields">
        <div className="payment-section-heading"><div><span className="payment-step-label">3 · CHAVE</span><h3>Dados da sua conta PagBank</h3></div></div>
        <label><span className="label-with-help">Token de integração <HelpButton topic="pagbank-token" label="Explicar token de integração PagBank" onOpen={setHelpTopic}/></span>
          <input type="password" value={pagBankToken} onChange={(event)=>setPagBankToken(event.target.value)} placeholder={state.pagBankTokenConfigured ? "Já configurado · deixe vazio para manter" : "Cole o token da API PagBank"}/>
          <small className="field-help-copy">O SOS usa esse token para criar e consultar pedidos Pix na sua conta.</small>
        </label>
      </section>}

      {provider!=="DISABLED" && <section className="payment-config-section">
        <div className="payment-section-heading"><div><span className="payment-step-label">CONFIRMAÇÃO</span><h3>Endereço que recebe avisos de pagamento</h3></div><HelpButton topic="webhook" label="Explicar endereço de confirmação automática" onOpen={setHelpTopic}/></div>
        <div className="payment-webhook-box"><code>{webhookUrl}</code><small>Gerado a partir do backend público do SOS YouTuber. Não contém senha.</small></div>
      </section>}

      <div className={`payment-config-status ${providerConfigured ? "ready":"pending"}`}>
        <ShieldCheck size={18}/><div><strong>{provider==="DISABLED" ? "Novas compras reais pausadas" : providerConfigured ? "Credenciais mínimas já estão salvas" : "Ainda faltam dados para este provedor"}</strong>
        <small>{provider==="DISABLED" ? "Tudo que já existe continua preservado." : providerConfigured ? "Você pode manter os campos de senha vazios para não substituir o que já foi salvo." : "Preencha as chaves acima e salve quando estiver pronto."}</small></div>
      </div>

      {notice && <div className="notice" role="status"><Check size={18}/><span>{notice}</span></div>}
      {error && <p className="error" role="alert">{error}</p>}

      <div className="payment-config-footer">
        <button type="button" className="secondary" onClick={onClose}>Cancelar</button>
        <button type="button" className="primary" disabled={busy} onClick={()=>void save()}>{busy ? "Salvando…" : provider==="DISABLED" ? "Salvar pausa" : "Salvar e usar para novas compras"}</button>
      </div>
    </section>
  </div>;
}
