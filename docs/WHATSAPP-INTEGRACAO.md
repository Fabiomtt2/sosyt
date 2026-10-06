# Bot SOS YouTube — implementação e ativação

## Fluxo construído

1. A CTA `Quero participar` abre a tela de dados. Após o registro, o botão de continuidade abre o WhatsApp com mensagem pronta: “Olá! Quero participar do projeto SOS YouTube.”. O WhatsApp exige que a pessoa pressione Enviar; wa.me não envia sozinho.
2. Meta entrega a mensagem ao endpoint HTTPS `/webhooks/whatsapp`. O servidor verifica HMAC SHA-256 do corpo original com WHATSAPP_APP_SECRET e confere o ID do número Business; WHATSAPP_BUSINESS_ACCOUNT_ID acrescenta conferência da conta.
3. O bot enfileira acolhimento e pedido do nome de preferência. Ao responder o nome, o número recebido pela Meta/wa_id é associado à solicitação, marcada WHATSAPP no painel. O nome é autodeclarado; a origem do telefone é o webhook assinado, não o texto digitado no site.
4. No mesmo fluxo que cria a pendência no dashboard, o bot agenda o alerta “Novo Usuário! Registro pendente 📨” para `OWNER_ALERT_WHATSAPP` quando configurado; se ele estiver vazio, usa os telefones das contas Owner. O alerta leva nome, número e quantidade de pendências.
5. A aprovação acontece pelo dashboard ou pela sincronização oficial do grupo. Depois que telefone + grupo constam em `group_memberships`, o participante entra diretamente no aplicativo, sem Credencial/OTP. O adaptador OTP legado permanece no backend, mas não faz parte do fluxo principal. Quando a Groups API oficial expõe o grupo, entrada/saída sincroniza `group_memberships`; grupos não expostos continuam com conferência Owner.

Mensagens recebidas são deduplicadas por ID. Solicitações são deduplicadas por telefone. Respostas/alertas ficam em fila persistente; worker executa a cada cinco segundos, tem lease, timeout, até cinco tentativas e retentativa administrativa. Respostas livres só são tentadas dentro de 24h da mensagem original; notificações aos Owners usam template para não depender de janela aberta. Falhas de envio OTP invalidam o código.

Envio aceito pela API NÃO comprova entrega/leitura. O painel contabiliza aceites da Meta; falta implementar reconciliação completa de status de entrega. Timeout/falha entre aceite remoto e gravação local pode duplicar um envio numa retentativa: não há promessa de exactly-once externo. Não prometer aprovação em poucos minutos.

## Campos necessários no .env

| Campo | Conteúdo |
| --- | --- |
| OWNER_WHATSAPP | Número Business dedicado, quando houver. Se ausente, o número Owner Rafael é o contato público de fallback. |
| OWNER_FABIO_WHATSAPP / OWNER_RAFAEL_WHATSAPP | Telefones associados às contas Owner |
| OWNER_ALERT_WHATSAPP | Número administrativo prioritário para alertas de novos registros; se vazio, usa os telefones Owner configurados |
| WHATSAPP_PHONE_NUMBER_ID | ID Meta do número Business (não é o telefone) |
| WHATSAPP_BUSINESS_ACCOUNT_ID | ID da WABA para conferência adicional |
| WHATSAPP_ACCESS_TOKEN | Credencial de servidor autorizada para enviar mensagens |
| WHATSAPP_APP_SECRET | Segredo do aplicativo Meta, usado na assinatura |
| WHATSAPP_VERIFY_TOKEN | Valor exclusivo de pelo menos 16 caracteres para o desafio do webhook |
| WHATSAPP_GRAPH_VERSION | Versão suportada pela conta, default configurável v24.0 |
| WHATSAPP_OTP_TEMPLATE | Nome do template AUTHENTICATION aprovado, código em body e botão OTP/url índice 0 |
| WHATSAPP_OWNER_ALERT_TEMPLATE | Nome do template aprovado para aviso administrativo |
| WHATSAPP_DECISION_TEMPLATE | Template para comunicar decisão quando a janela livre já fechou |
| WHATSAPP_TEMPLATE_LANGUAGE | Idioma exato aprovado, default pt_BR |
| WHATSAPP_GROUPS_SYNC_ENABLED | Liga/desliga descoberta/sincronização oficial, default true |
| WHATSAPP_GROUPS_SYNC_MINUTES | Intervalo do worker de grupos, default 5 minutos |

O template de alerta deve ter parâmetros de corpo nesta ordem: `{{1}}` nome declarado, `{{2}}` número do usuário, `{{3}}` quantidade pendente. Sugestão de texto a submeter à Meta: “Novo Usuário! Registro pendente 📨! O usuário de nome {{1}}, número: {{2}}, aguarda registro ▶️! Pendências atuais: {{3}}.” Categoria/aprovação e cobrança dependem da Meta; não assumir envio gratuito.

O OTP deve usar o template aprovado de autenticação compatível com os componentes enviados pelo adaptador. O número deve estar habilitado na Cloud API. Publicar HTTPS e configurar no aplicativo Meta o callback e assinatura `messages`. O desafio GET valida hub.mode, hub.verify_token e hub.challenge; o POST verifica X-Hub-Signature-256. Só desativar AUTH_DEV_MODE após teste real de entrega e validade do código.

Estado operacional deste Xubuntu em 05/10/2026: os números Owner e de alerta estão configurados. Faltam as credenciais da Meta Cloud API (Phone Number ID, WABA ID, access token, app secret/verify token e templates). A Groups API oficial existe e o adaptador já possui sincronização de grupos/participantes; sem essas credenciais ela não pode operar. Como fallback local foi pesquisado WAHA/NOWEB, que usa WebSocket sem Chromium e oferece mensagens, webhooks e Groups API, mas depende de pareamento QR e é uma integração não oficial do WhatsApp Web.

## Grupos SOS YOUTUBER

Código do grupo vai de 1 a 99, sem zero inicial. Participantes informam “SOS YOUTUBER — Digite a qual grupo você pertence”; o backend valida o número contra `group_memberships`. Owners são reconhecidos automaticamente por nome + WhatsApp e Credencial. O marcador `#` existe apenas internamente na API e não aparece na interface.

A automação oficial está implementada sem robô de WhatsApp Web: o worker lista grupos ativos do número Cloud API, reconhece subject no formato `SOS YOUTUBER N`, grava o `group_id`, consulta participantes e sincroniza `group_memberships`. Webhooks `group_participants_update` atualizam entrada/saída em tempo real e são deduplicados. O painel também oferece sincronização imediata.

Isso não significa que qualquer grupo comum/preexistente possa ser lido. A automação só atua nos grupos que a conta Meta elegível realmente devolve. Grupos não expostos permanecem em `OWNER_VERIFIED`; digitar o número do grupo nunca prova pertencimento.

## Referências oficiais consultadas

- https://faq.whatsapp.com/5913398998672934 — click to chat e mensagem preenchida.
- https://github.com/fbsamples/whatsapp-api-examples — exemplos oficiais de mensagens, templates e assinatura de webhook; referência de arquitetura, sem copiar aplicação inteira.
- https://developers.facebook.com/documentation/business-messaging/whatsapp/groups — Groups API (trechos indexados; leitura completa bloqueada por 429 nesta pesquisa).
- https://developers.facebook.com/documentation/business-messaging/whatsapp/groups/webhooks/ — eventos de participantes (trecho indexado).

O SDK Node antigo da Meta está arquivado; não foi adicionado como dependência. O adaptador usa chamadas HTTP explícitas e requer validação com a versão Graph API habilitada na conta.
