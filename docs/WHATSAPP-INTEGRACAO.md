# Bot SOS YouTube — implementação e ativação

## Fluxo construído

1. O link Quero participar pelo WhatsApp abre conversa com mensagem pronta: “Olá! Quero participar do projeto SOS YouTube.”. O WhatsApp exige que a pessoa pressione Enviar; wa.me não envia sozinho.
2. Meta entrega a mensagem ao endpoint HTTPS `/webhooks/whatsapp`. O servidor verifica HMAC SHA-256 do corpo original com WHATSAPP_APP_SECRET e confere o ID do número Business; WHATSAPP_BUSINESS_ACCOUNT_ID acrescenta conferência da conta.
3. O bot enfileira acolhimento e pedido do nome de preferência. Ao responder o nome, o número recebido pela Meta/wa_id é associado à solicitação, marcada WHATSAPP no painel. O nome é autodeclarado; a origem do telefone é o webhook assinado, não o texto digitado no site.
4. Dois alertas independentes podem ser enviados a Fabio0 e Rafael0 por template aprovado, contendo quantidade de pendências no momento do evento, nome e telefone. Painel diferencia solicitações web e WhatsApp.
5. Owner confere vínculo ao grupo e aprova. O login exige número e grupo autorizados, além do OTP. O adaptador de OTP usa template de autenticação; código nunca é devolvido ao navegador com AUTH_DEV_MODE=false.

Mensagens recebidas são deduplicadas por ID. Solicitações são deduplicadas por telefone. Respostas/alertas ficam em fila persistente; worker executa a cada cinco segundos, tem lease, timeout, até cinco tentativas e retentativa administrativa. Respostas livres só são tentadas dentro de 24h da mensagem original; notificações aos Owners usam template para não depender de janela aberta. Falhas de envio OTP invalidam o código.

Envio aceito pela API NÃO comprova entrega/leitura. O painel contabiliza aceites da Meta; falta implementar reconciliação completa de status de entrega. Timeout/falha entre aceite remoto e gravação local pode duplicar um envio numa retentativa: não há promessa de exactly-once externo. Não prometer aprovação em poucos minutos.

## Campos necessários no .env

| Campo | Conteúdo |
| --- | --- |
| OWNER_WHATSAPP | Número Business de atendimento, DDI+DDD+número, usado pelo link |
| OWNER_FABIO_WHATSAPP / OWNER_RAFAEL_WHATSAPP | Contatos que receberão os alertas |
| WHATSAPP_PHONE_NUMBER_ID | ID Meta do número Business (não é o telefone) |
| WHATSAPP_BUSINESS_ACCOUNT_ID | ID da WABA para conferência adicional |
| WHATSAPP_ACCESS_TOKEN | Credencial de servidor autorizada para enviar mensagens |
| WHATSAPP_APP_SECRET | Segredo do aplicativo Meta, usado na assinatura |
| WHATSAPP_VERIFY_TOKEN | Valor exclusivo de pelo menos 16 caracteres para o desafio do webhook |
| WHATSAPP_GRAPH_VERSION | Versão suportada pela conta, default configurável v24.0 |
| WHATSAPP_OTP_TEMPLATE | Nome do template AUTHENTICATION aprovado, código em body e botão OTP/url índice 0 |
| WHATSAPP_OWNER_ALERT_TEMPLATE | Nome do template aprovado para aviso administrativo |
| WHATSAPP_TEMPLATE_LANGUAGE | Idioma exato aprovado, default pt_BR |

O template de alerta deve ter parâmetros de corpo nesta ordem: `{{1}}` quantidade pendente, `{{2}}` nome declarado, `{{3}}` número. Sugestão de texto a submeter à Meta: “Há nova solicitação no SOS YouTube. Pendentes: {{1}}. Nome: {{2}}. WhatsApp: {{3}}. Confira o painel administrativo.” Categoria/aprovação e cobrança dependem da Meta; não assumir envio gratuito.

O OTP deve usar o template aprovado de autenticação compatível com os componentes enviados pelo adaptador. O número deve estar habilitado na Cloud API. Publicar HTTPS e configurar no aplicativo Meta o callback e assinatura `messages`. O desafio GET valida hub.mode, hub.verify_token e hub.challenge; o POST verifica X-Hub-Signature-256. Só desativar AUTH_DEV_MODE após teste real de entrega e validade do código.

Nenhuma conta Meta, template ou número foi cadastrado externamente nesta etapa. Sem credenciais, o worker não envia e webhook/login real respondem que a integração precisa ser configurada. A integração não foi testada contra a Meta real: os testes usam respostas controladas.

## Grupos SOS YOUTUBER

Código é inteiro positivo (1,2,...10,...), sem zero inicial, até oito dígitos. `#` pertence apenas aos Owners Fabio0/Rafael0 e nunca prova privilégio por si só. Nome de exibição não é credencial de acesso.

A Meta documenta Groups API, grupos por convite e eventos de participantes. Isso não comprova que os grupos comuns preexistentes SOS YOUTUBER podem ser consultados pela nossa conta. Nesta pesquisa, o corpo completo das páginas Meta retornou 429; não afirmar limites/elegibilidade sem confirmação atual no console/documentação. O MVP mantém conferência pelo Owner. Não usar o número do grupo informado como prova, não simular sincronização e não adotar robô WhatsApp Web silenciosamente.

Antes de construir admissão automática, confirmar: elegibilidade da conta, suporte aos grupos existentes, IDs reais dos grupos e eventos/listagem autorizados. Se a API suportar esse cenário, mapear grupo externo→código SOS, atualizar vínculo por eventos assinados e revogar na saída. Até essa comprovação, esse automatismo é uma pendência explícita.

## Referências oficiais consultadas

- https://faq.whatsapp.com/5913398998672934 — click to chat e mensagem preenchida.
- https://github.com/fbsamples/whatsapp-api-examples — exemplos oficiais de mensagens, templates e assinatura de webhook; referência de arquitetura, sem copiar aplicação inteira.
- https://developers.facebook.com/documentation/business-messaging/whatsapp/groups — Groups API (trechos indexados; leitura completa bloqueada por 429 nesta pesquisa).
- https://developers.facebook.com/documentation/business-messaging/whatsapp/groups/webhooks/ — eventos de participantes (trecho indexado).

O SDK Node antigo da Meta está arquivado; não foi adicionado como dependência. O adaptador usa chamadas HTTP explícitas e requer validação com a versão Graph API habilitada na conta.
