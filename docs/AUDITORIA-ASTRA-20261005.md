# Auditoria e âncora — Conexão Youtube

Data: 05/10/2026 (America/Bahia). Escopo: leitura de Git, documentação, implementação e validação local. Sem correções de código, commit, publicação ou operações financeiras externas.

## Âncora real

- Dispositivo: ubuntu-desktop-bootstrap-ubuntu--Inspiron-5447.
- Pasta: /home/ubuntu-desktop-bootstrap-ubuntu-/Documents/Codex/2026-10-04/gostar/Conexão Youtube
- Repositório autônomo; git worktree list contém apenas essa pasta. Não é uma worktree ligada ao Clareia.
- Branch main; HEAD 07f85b510133323209084776838ef1c2c32d008a, feat: scaffold collaborative playlist MVP, 04/10/2026 17:41:34 -0300.
- Sem remote configurado no momento observado.
- WIP prévio: 7 arquivos rastreados modificados (.gitignore, PROJECT_STATUS.md, README.md, apps/api/src/app.ts, apps/api/src/config.ts, apps/client/package.json, apps/client/tsconfig.node.json); não rastreados: apps/client/.env.android, apps/client/android/, apps/client/src/vite-env.d.ts, package-lock.json.
- Nenhum AGENTS.md localizado nos diretórios ancestrais conferidos ou na raiz do projeto. Ler eventual governança nova antes de futuras mudanças.

## Produto compreendido

React/Vite/PWA/Capacitor no cliente; Fastify/SQLite no servidor. Login por nome, telefone e identificador numérico SOS YOUTUBER; OTP em modo de desenvolvimento. Quadro sequencial com 10 links; 10 créditos iniciais; salvar um link custa 1 crédito. Primeira contribuição por usuário/ciclo é livre de passe; contribuições adicionais consomem passe. Pix de R$20 concede 20 créditos e 1 passe. Fechar ciclo premia cada participante distinto com 1 crédito e abre o próximo. OAuth individual permite exportar voluntariamente ciclo concluído para playlist privada. Não há implementação de recompensa por assistir vídeos.

## Evidências de validação

- Node v22.22.1; npm test passou. São 5 casos distintos da API executados duas vezes (src/app.test.ts e dist/app.test.js), total reportado 10. Cliente não possui testes e passa com --passWithNoTests.
- npm run lint passou; é checagem TypeScript, não análise ampla de lint.
- npm run build concluiu com exit code 0: API TypeScript e cliente Vite/PWA aprovados.
- Reproduções por app.inject com SQLite em memória; nenhuma credencial real e nenhuma chamada financeira externa. Resposta de Mercado Pago foi simulada.
- Não foi encontrado APK no diretório app/build/outputs na verificação. Android existe como WIP, mas APK e execução física não foram validados.
- Sem inspeção visual de UI ou validação real de WhatsApp, Google/YouTube ou Mercado Pago nesta auditoria.

## Achados prioritários

1. Autenticação: authGuard aceita qualquer JWT válido sem rejeitar purpose youtube-oauth. Reproduzido: state recebido de /youtube/connect usado como Bearer em /dashboard retorna HTTP 200. Separar finalidade/audience e impedir uso como sessão; implementar state único.
2. Pix aprovado imediatamente: /payments/pix grava APPROVED antes de settlePayment; settlePayment retorna cedo ao encontrar APPROVED. Reproduzido: resposta HTTP 201 APPROVED com purchased=0 e extraPasses=0. Confirmar/creditar de maneira atômica, com idempotência financeira independente de status.
3. CORRIGIDO APÓS LEITURA DO INPUT ORIGINAL: quadro global entre grupos é requisito explícito, não defeito. A reprodução de visibilidade entre 123 e 456 confirma aderência. O grupo identifica a origem do participante; não implementar isolamento. Verificação de pertencimento ao WhatsApp não existe e não deve ser confundida com cadastro do número informado.
4. Pix/webhook: confirmação consulta provedor, mas não verifica valor, moeda e correspondência entre provider_payment_id e pagamento local antes de creditar. MERCADO_PAGO_WEBHOOK_SECRET declarado, sem uso; estados refunded/charged_back não reconciliam saldo. Auditar antes de dinheiro real.
5. Produção: segredos padrão e AUTH_DEV_MODE/PAYMENTS_DEV_MODE true não são recusados por NODE_ENV production; OTP sem limitação de tentativas/envios, JWT com duração de 30 dias. Endpoint request-code com AUTH_DEV_MODE false retorna 501; entrega WhatsApp não implementada.
6. Exportação: retomada por added_count existe, mas sem trava por usuário/ciclo; requisições concorrentes podem criar playlists ou inserir itens duplicados. Não há reconciliação após sucesso remoto e falha antes de persistir progresso.
7. Android: API em .env.android aponta para emulador 10.0.2.2:3333. CORS permite apenas WEB_APP_URL (localhost:5173 por padrão), enquanto WebView usa origem HTTPS local; conferir origem e CORS em aparelho. Não validado em execução.
8. UI Pix real: não há consulta de status/polling do pagamento nem fechamento automático ao confirmar; dashboard atualiza periodicamente, mas modal continua sem confirmação explícita.
9. Cobertura: testes não cobrem fechamento de ciclo, recompensa, Pix/idempotência, OAuth/exportação, concorrência, grupos nem cliente. Excluir dist da descoberta para evitar contagem duplicada.
10. Esclarecimento documental: o grupo numérico com algarismos 1–9 atende ao input original; SOS YOUTUBER é o prefixo/nome do grupo. Explicitar no README que o quadro é global e que cadastro não verifica participação real no WhatsApp.

## Ordem de retomada

Preservar todo WIP e reler status/HEAD. Manter quadro global conforme input original; corrigir finalidade JWT e crédito Pix; ampliar testes de domínio relevantes; endurecer configuração/OTP e reconciliação de pagamentos; impedir exportação concorrente; validar Android/CORS; testar integrações externas em ambiente de teste; depois validar UI e preparar checkpoint Git. Não assumir que passar build implica produto pronto ou APK comprovado.


## Confronto com o input original apresentado pelo usuário em 05/10/2026

O input original passa a ser a referência de intenção do produto. A auditoria inicial não dispunha dele. A implementação não equivale ao escopo integral pedido.

| Requisito | Estado observado |
|---|---|
| Projeto isolado, sem alterar arquivos externos | Repositório autônomo; operações desta auditoria restritas à pasta. Não houve auditoria histórica de alterações externas do executor anterior. |
| Webapp e APK com mesmos dados | Cliente/API comuns implementados; Android preparado, APK não comprovado. |
| Login nome/WhatsApp/grupo sem 0 | Implementado; OTP real ausente. |
| Todos veem o mesmo quadro com autor/horário | Implementado e confirmado entre grupos; requisito global. |
| 10 posições liberadas sequencialmente | Implementado; falta teste de fechamento completo/concorrência. |
| 10 moedas iniciais e débito de 1 por Save | Implementado; débito confirmado em teste. |
| Compra R$20 dá 20 moedas e libera próxima contribuição | Passe separado implementado; bug quando Pix retorna aprovado imediatamente. |
| Moedas naturais não geram passe | Implementado no modelo e na lógica; ampliar testes. |
| Botão Save vira Compartilhar em Playlist | Intenção parcialmente implementada por cartão de ciclo concluído com botão separado; campo/botão original não se transforma literalmente. |
| Criar playlist com 10 URLs em cada conta autorizada | Integração implementada, mas sem teste real e com risco de exportação concorrente. Privacidade private foi decisão adicional. |
| Recompensa de 1 moeda por playlist criada | Implementação concede 1 moeda por participante ao fechar quadro, antes de qualquer playlist criada no YouTube: regra alterada. |
| Recompensa percentual pelo tempo efetivamente assistido | Ausente; substituída por recompensa de curadoria. Não tratar como concluído. |
| Reprodução/medição em segundo plano | Ausente; conflito com regras oficiais do YouTube para clientes API. |
| 1 moeda = R$1 | Pacote de compra segue preço unitário; não existe conversão de saldo em dinheiro/saque. A frase original é ambígua quanto a resgate. |
| HEAD/WIP/commits para continuidade | Um commit inicial; Android, lockfile e outras mudanças seguem sem commit. Esta auditoria é checkpoint documental não commitado. |

Fonte oficial consultada: https://developers.google.com/youtube/terms/developer-policies-guide e políticas vinculadas. Proíbem incentivar/recompensar usuários por assistir vídeos e permitir reprodução do player em segundo plano. Isso explica o limite técnico de produto, mas não torna automaticamente aprovada a substituição da regra de recompensa. Curadoria/exportação não constituem promessa de aumento ou garantia de views. Validar qualquer regra de recompensa remanescente em seu contexto.

Sem evidência aqui de aprovação anterior do usuário para essas mudanças de escopo. Preservar e explicitar a diferença entre intenção original, limite da plataforma e decisão tomada na implementação. Não reintroduzir recompensas por assistir ou mecanismos destinados a gerar engajamento artificial.

## Fechamento da implementação web — 2026-10-05

O quadro de dez espaços voltou ao centro da implementação: formulário dentro da próxima posição, links canônicos e autoria persistidos, detalhes de todos os dez vídeos no histórico e ação de exportação em cada contribuição própria quando a conta Google estiver conectada. Ciclos prontos antigos deixam de desaparecer pelo limite de cinco registros.

Login Owner/participante compartilham tela; privilégio exige credencial de servidor e token com propósito exclusivo. A autorização manual de telefone/grupo protege cadastro e sessões existentes. Os indicadores distinguem ciclo completo, playlist exportada e dinheiro simulado/real.

Validação final: 33 testes API, 3 de cliente, verificação TypeScript, build API/web e cenário completo Playwright aprovados. As etapas externas do Google foram simuladas na UI e na API; Pix de navegador foi DEMO. Nenhuma credencial externa real foi utilizada. Evidências em docs/evidencias; estado operacional e limites detalhados em PROJECT_STATUS.md.

O pedido original de pagamento por watch time NÃO foi entregue como tal: mantém-se a decisão registrada de curadoria sem incentivo de visualização e sem reprodução em segundo plano. APK está adiado por instrução expressa. Há pendências de OTP real, conciliação de estornos e pagamentos órfãos, normalização internacional de telefone e produção.
