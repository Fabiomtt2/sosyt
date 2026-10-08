# Bot SOS YouTube — implementação e ativação

## Fluxo construído

1. A CTA `Quero participar` abre a tela de dados. Após o registro, o botão de continuidade abre o WhatsApp com mensagem pronta: “Olá! Quero participar do projeto SOS YouTube.”. O WhatsApp exige que a pessoa pressione Enviar; wa.me não envia sozinho.
2. Meta entrega a mensagem ao endpoint HTTPS `/webhooks/whatsapp`. O servidor verifica HMAC SHA-256 do corpo original com WHATSAPP_APP_SECRET e confere o ID do número Business; WHATSAPP_BUSINESS_ACCOUNT_ID acrescenta conferência da conta.
3. O bot enfileira acolhimento e pedido do nome de preferência. Ao responder o nome, o número recebido pela Meta/wa_id é associado à solicitação, marcada WHATSAPP no painel. O nome é autodeclarado; a origem do telefone é o webhook assinado, não o texto digitado no site.
4. No mesmo fluxo que cria a pendência no dashboard, o bot agenda o alerta “Novo Usuário! Registro pendente 📨” para `OWNER_ALERT_WHATSAPP` quando configurado; se ele estiver vazio, usa os telefones das contas Owner. O alerta leva nome, número e quantidade de pendências.
5. A aprovação é uma decisão Owner; a sincronização oficial fornece a evidência externa nos grupos que a exigem. Identidade e autorização de grupo são estados distintos: a chave WhatsApp de 6 dígitos (5 minutos, uso único) pode confirmar registro/login sem aprovar o grupo; Google é uma alternativa opcional de identidade e a autorização YouTube continua separada. Depois que telefone + grupo constam em `group_memberships`, a mesma conta é liberada sem criar carteira ou histórico duplicados. Quando a Groups API oficial expõe o grupo, entrada/saída atualiza a prova externa e a autorização aprovada; grupos não expostos continuam com conferência Owner.

Mensagens recebidas são deduplicadas por ID. Solicitações são deduplicadas por telefone. Respostas/alertas ficam em fila persistente; worker executa a cada cinco segundos, tem lease, timeout, até cinco tentativas e retentativa administrativa. Respostas livres só são tentadas dentro de 24h da mensagem original; notificações aos Owners usam template para não depender de janela aberta. Falhas de envio OTP invalidam o código.

Envio aceito pela API NÃO comprova entrega/leitura. O painel contabiliza aceites da Meta; falta implementar reconciliação completa de status de entrega. Timeout/falha entre aceite remoto e gravação local pode duplicar um envio numa retentativa: não há promessa de exactly-once externo. Não prometer aprovação em poucos minutos.

## Configuração de produção

| Campo | Conteúdo |
| --- | --- |
| WHATSAPP_BUSINESS_PHONE | Padrão inicial público +5571993978956; o valor persistido no painel prevalece. OWNER_WHATSAPP é compatibilidade legada. |
| OWNER_FABIO_WHATSAPP / OWNER_RAFAEL_WHATSAPP | Telefones associados às contas Owner |
| OWNER_ALERT_WHATSAPP | Número administrativo prioritário para alertas de novos registros; se vazio, usa os telefones Owner configurados |
| WHATSAPP_PHONE_NUMBER_ID | ID Meta do número Business (não é o telefone) |
| WHATSAPP_BUSINESS_ACCOUNT_ID | ID da WABA para conferência adicional |
| WHATSAPP_ACCESS_TOKEN | Credencial de servidor autorizada para enviar mensagens |
| WHATSAPP_APP_SECRET | Segredo do aplicativo Meta, usado na assinatura |
| WHATSAPP_VERIFY_TOKEN | Valor exclusivo de pelo menos 16 caracteres para o desafio do webhook |
| WHATSAPP_GRAPH_VERSION | Versão suportada pela conta, default configurável v24.0 |
| WHATSAPP_OTP_TEMPLATE | Nome do template AUTHENTICATION aprovado, código em body e botão OTP/url índice 0. Pode vir do ambiente ou do painel ROOT_OWNER. |
| WHATSAPP_OWNER_ALERT_TEMPLATE | Nome do template aprovado para aviso administrativo. Pode vir do ambiente ou do painel ROOT_OWNER. |
| WHATSAPP_DECISION_TEMPLATE | Template para comunicar decisão quando a janela livre já fechou. Pode vir do ambiente ou do painel ROOT_OWNER. |
| WHATSAPP_TEMPLATE_LANGUAGE | Idioma exato aprovado, default pt_BR. Também pode ser salvo no painel ROOT_OWNER. |
| WHATSAPP_GROUPS_SYNC_ENABLED | Liga/desliga descoberta/sincronização oficial, default true |
| WHATSAPP_GROUPS_SYNC_MINUTES | Intervalo do worker de grupos, default 5 minutos |

### Configuração pelo painel Owner

O painel ROOT_OWNER persiste no SQLite do volume, com segredos cifrados no servidor: modo, WABA ID, Phone Number ID, número Business, versão Graph API, access token, app secret, verify token e os nomes/idioma dos três templates Meta. O número Business salvo no painel tem precedência para o link público `wa.me`; o padrão TypeScript autorizado é usado na primeira inicialização e contatos pessoais não são o padrão público. O Phone Number ID continua sendo o identificador técnico usado pela Cloud API e não deve ser confundido com o número humano exibido ao usuário.

Os nomes de templates configurados no painel apenas selecionam modelos já aprovados no WhatsApp Manager; o SOS não cria nem aprova templates automaticamente. O alerta administrativo recebe parâmetros na ordem: nome declarado, telefone e quantidade pendente.

O template de alerta deve ter parâmetros de corpo nesta ordem: `{{1}}` nome declarado, `{{2}}` número do usuário, `{{3}}` quantidade pendente. Sugestão de texto a submeter à Meta: “Novo Usuário! Registro pendente 📨! O usuário de nome {{1}}, número: {{2}}, aguarda registro ▶️! Pendências atuais: {{3}}.” Categoria/aprovação e cobrança dependem da Meta; não assumir envio gratuito.

O OTP deve usar o template aprovado de autenticação compatível com os componentes enviados pelo adaptador. O número deve estar habilitado na Cloud API. Publicar HTTPS e configurar no aplicativo Meta o callback e assinatura `messages`. O desafio GET valida hub.mode, hub.verify_token e hub.challenge; o POST verifica X-Hub-Signature-256. Manter AUTH_DEV_MODE=false em produção; publicar o novo fluxo somente após conferir um provedor real de acesso.

Estado operacional auditado em 07/10/2026: os números Owner e de alerta estão configurados localmente; o painel já consegue persistir o número Business e os nomes/idioma dos templates. A ativação externa real continua dependente de credenciais válidas da Meta Cloud API e de templates aprovados. A Groups API oficial existe e o adaptador já possui sincronização de grupos/participantes; sem essas credenciais ela não pode operar. Como fallback local foi pesquisado WAHA/NOWEB, que usa WebSocket sem Chromium e oferece mensagens, webhooks e Groups API, mas depende de pareamento QR e é uma integração não oficial do WhatsApp Web.

## Grupos SOS YOUTUBER

Participantes não digitam grupo: o backend resolve o vínculo pelo WhatsApp em `group_memberships` e, conforme o modo, em `whatsapp_member_verifications`. O catálogo herdado suporta códigos 1–999; o uso atual solicitado é SOS YOUTUBER 1–99. Owners são reconhecidos automaticamente por nome + WhatsApp e Credencial. O marcador `#` existe apenas internamente na API e não aparece na interface.

A automação oficial está implementada sem robô de WhatsApp Web: o worker lista grupos ativos do número Cloud API, reconhece subject no formato `SOS YOUTUBER N`, grava o `group_id`, consulta participantes e sincroniza `group_memberships`. Webhooks `group_participants_update` atualizam entrada/saída em tempo real e são deduplicados. O painel também oferece sincronização imediata.

Isso não significa que qualquer grupo comum/preexistente possa ser lido. A automação só atua nos grupos que a conta Meta elegível realmente devolve. Grupos não expostos permanecem em `OWNER_VERIFIED`; digitar o número do grupo nunca prova pertencimento.

## Referências oficiais consultadas

- https://faq.whatsapp.com/5913398998672934 — click to chat e mensagem preenchida.
- https://github.com/fbsamples/whatsapp-api-examples — exemplos oficiais de mensagens, templates e assinatura de webhook; referência de arquitetura, sem copiar aplicação inteira.
- https://developers.facebook.com/documentation/business-messaging/whatsapp/groups — Groups API (trechos indexados; leitura completa bloqueada por 429 nesta pesquisa).
- https://developers.facebook.com/documentation/business-messaging/whatsapp/groups/webhooks/ — eventos de participantes (trecho indexado).

O SDK Node antigo da Meta está arquivado; não foi adicionado como dependência. O adaptador usa chamadas HTTP explícitas e requer validação com a versão Graph API habilitada na conta.


## Regra mais recente — Fábio, 07/10/2026 13:25 Bahia
- WhatsApp Business público inicial aprovado: +5571993978956. Fonte: mensagem explícita do usuário; pode constar no modelo do projeto. Contatos privados/credenciais dos Owners continuam separados.
- Número central em apps/api/src/project-defaults.ts, seed inicial em integration_settings e edição persistente pelo painel ROOT_OWNER. Valor persistido prevalece após restart/deploy. Links públicos e effectiveWhatsAppConfig consultam o mesmo estado. Mudar telefone não descobre credenciais Meta; conferência cruza telefone público e Phone Number ID antes de liberar envio após alterações.
- NÃO usar carrossel nem ilustração de background na intro/login: removida a montagem de IntroVisualCarousel. Componente antigo preservado no WIP para rastreabilidade, sem uso na tela.
- Carrossel aprovado apenas na área do participante, em formato banner informativo sobre o projeto. Artes não são finais: ASTRA autorizado a redesenhar loja e demais ilustrações, afastando estética gamer; motores continuam prioritários.

A edição no painel grava no SQLite persistente da API (volume /data no Railway). Não exige redeploy para mudar o telefone depois que esta versão for publicada. Atualização aplica-se às próximas requisições; telas já abertas recebem a nova configuração na próxima atualização, atualmente a cada 10 segundos no painel. Nenhuma mensagem externa foi enviada durante testes.
