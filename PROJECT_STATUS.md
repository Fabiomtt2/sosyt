# Estado verificável — YouTube Final

## Retomada ASTRA — 08/10/2026 02:39 -03
- Branch sol/user-premium-20261006, base c0b8172. WIP consolidado em 11 commits temáticos; código/evidências validados em ba1ce1abf7e2748131ce1e96e45704dd667c2919. Documentação vem em commit posterior na mesma branch (resolver HEAD com git rev-parse). Main/GitHub ainda c0b8172 e produção 65d5b2c. Nenhum push/merge/deploy até este checkpoint.
- Gate final GREEN: .local-tmp/gate-reviewed-20261008T053328Z/results.json — 112 testes API, 10 cliente, lint, build, Playwright 3/3, diff e cached-check. Python 5/5 GREEN com OCR/GUI reais em Xvfb isolado. Fixtures de telefone agora sintéticas.
- Login: chave WhatsApp 5 min/uso único ou Google alternativo; aprovação e carteira preservadas. Business +5571993978956 central/editável/persistido. Alertas e decisões agora consultam templates salvos; contagem inclui associações Google pendentes.
- Companion novo real em companion/sos_companion.py; opt-in, região explícita, OCR local, metadados apenas, sem automação do player/ledger. API com token restrito, expiração e revogação web/local. E2E executa cliente Python contra API real de teste. Não foi recuperado um runtime IFtp histórico.
- WATCH_TIME: 1 moeda interna/20 min acumulados, perfil e detalhe Owner usando mesma fonte. Legado preservado sem fabricar tempo. Corrigidas pausa, corrida de inicialização YouTube e conclusão por percentual legado.
- Visual: intro sem carrossel/background ilustrado; banners só no dashboard; novas artes de loja; lifecycle de modais com foco/Tab/Escape/body lock. Avatar persistente e badge ADMIN auditados. Screenshot do cartão detectou SOS YOUTUBER #; corrigido para Participação administrativa no cartão e no detalhe.
- Impedimento de publicação: prontidão do login real não comprovada. Google sem variáveis no Railway; Meta pode existir no banco. Credenciais Owner locais retornaram 401 na API de produção (health 200). Não inventar credenciais nem habilitar DEV para contornar.
- Main dispara publicação Pages automaticamente, então não fazer merge enquanto API/provedores não estiverem prontos. Railway mantém fonte fixada em 65d5b2c e volume /data. Pilha validada como conjunto, não cada commit intermediário como release.
- Auditoria detalhada: docs/AUDITORIA-ASTRA-20261008.md. Próximo: push premium, abrir PR com bloqueio de publicação e conferir igualdade entre branch local/remota.
- Snapshot imediatamente anterior aos commits: .local-tmp/astra-precommit-20261008T053653Z (115 arquivos + patches + hashes).


## Regra mais recente — Fábio, 07/10/2026 13:25 Bahia
- WhatsApp Business público inicial aprovado: +5571993978956. Fonte: mensagem explícita do usuário; pode constar no modelo do projeto. Contatos privados/credenciais dos Owners continuam separados.
- Número central em apps/api/src/project-defaults.ts, seed inicial em integration_settings e edição persistente pelo painel ROOT_OWNER. Valor persistido prevalece após restart/deploy. Links públicos e effectiveWhatsAppConfig consultam o mesmo estado. Mudar telefone não descobre credenciais Meta; conferência cruza telefone público e Phone Number ID antes de liberar envio após alterações.
- NÃO usar carrossel nem ilustração de background na intro/login: removida a montagem de IntroVisualCarousel. Componente antigo preservado no WIP para rastreabilidade, sem uso na tela.
- Carrossel aprovado apenas na área do participante, em formato banner informativo sobre o projeto. Artes não são finais: ASTRA autorizado a redesenhar loja e demais ilustrações, afastando estética gamer; motores continuam prioritários.
- Na retomada, encontrada e lida integralmente docs/AUDITORIA-SOL-MOTOR-20261007.md. Sol implementou watch-observation/WATCH_TIME enquanto ASTRA estava parado. Não reconstruir o motor duplicado: auditar estado atual, inclusive protocolo legado.
- Snapshot anterior a esta edição: .local-tmp/astra-business-entry-20261007T162833Z (88 arquivos WIP + patches + hashes). HEAD continua c0b8172, branch sol/user-premium-20261006. Sem commit/push/merge/deploy nesta etapa.


Data de consolidação: 06/10/2026.

## Linhagem e auditoria

A fonte histórica ASTRA permanece em `Conexão Youtube`, branch `main`, HEAD `0f09c7b` mais WIP não commitado. Ela foi auditada novamente antes desta convergência: `git diff --check`, 47 testes de API, 3 do cliente, TypeScript e build/PWA passaram.

O primeiro merge isolado `ae26bf1` incorporou por hash todos os arquivos de código/texto modificados ou criados pelo WIP ASTRA. Nenhum código ASTRA foi perdido nesse checkpoint. As diferenças posteriores são evolução na árvore isolada `YouTube Final`.

Histórico principal:
- `37f915c` — checkpoint/auditoria ASTRA inicial;
- `14f584e` — motor web compartilhado e controles Owner;
- `0f09c7b` — âncora documental ASTRA;
- `ae26bf1` — primeiro merge isolado;
- `361c87a` — Owners refinados e acompanhamento de reprodução;
- `974443a` — login Owner por WhatsApp formatado;
- `02249e3` — evidências UI;
- `9978481` — auditoria externa de integrações.

A governança corrente está em `AGENTS.md` e a fonte de verdade de produto/continuidade é **`docs/ANCHOR-YOUTUBE-FINAL.md`**. O checkpoint **`docs/RECOVERY-CHECKPOINT-20261006-CRITICAL-OWNER-UI.md`** registra a rodada crítica; o P0 de identidade/solicitação Owner, a busca incremental de DDD e o modal de integração foram fechados no WIP atual e protegidos por E2E. `.env` é local/ignorado e não deve ser exibido ou versionado.

## Produto consolidado

- Quadro global entre todos os grupos SOS YOUTUBER com Filas de 10 posições sequenciais, URL, autor, grupo e horário permanentes. Ao completar 10, a Fila fecha e outra abre sem apagar a anterior.
- URL precisa ser YouTube; validação estrutural sempre e consulta externa quando `YOUTUBE_API_KEY` existe.
- `Fábio/Fabio` e `Rafael`: ambos são `ROOT_OWNER` completos. Nomes configurados com sufixo `0` permanecem aliases legados de compatibilidade. Administradores adicionais promovidos usam `ADMIN_OWNER` restrito. Credencial incorreta permanece na etapa Owner e nunca cai em solicitação/cooldown de participante. O `#` permanece apenas como detalhe interno da API.
- Login neutro: nome + WhatsApp internacional; participante comum não digita grupo. O backend resolve automaticamente participante/Owner e o grupo pelo vínculo do WhatsApp em `group_memberships`, complementado por `whatsapp_member_verifications` quando houver integração externa. Se ainda não estiver aprovado, a UI registra a solicitação pendente e mostra confirmação amigável. Não há Credencial/OTP no fluxo principal.
- 10 moedas iniciais; salvar custa 1. Produto `COINS_LAUNCH`: R$20 → 10 moedas compradas + 1 passe bônus. Produto `PASS_SINGLE`: R$20 → 1 passe e 0 moedas. Crédito só entra após confirmação server-side/idempotente.
- Ao fechar o ciclo, recompensa de curadoria existente permanece.
- Participantes daquela Fila podem criar playlist privada na própria conta via OAuth Google/YouTube. A UI oferece um único CTA `Criar playlist` por usuário/Fila; contribuições extras do mesmo usuário não duplicam a ação dentro dos slots.
- Acompanhamento de reprodução usa IFrame Player API, conta avanço natural com aba visível, ignora saltos grandes e sincroniza progresso por usuário/Fila. Fechar pausa; `Concluir tarefa` encerra no percentual atual. 100% conclui automaticamente.
- Regra confirmada pelo usuário: cada marco de 10% consolidado gera 1 moeda interna, máximo 10 por playlist/ciclo. Ledger `WATCH_PROGRESS` torna os marcos idempotentes.
- Moedas são crédito interno para controlar capacidade de contribuição; não são saque ou pagamento em dinheiro. O Owner vê separadamente origem inicial/promocional, comprada e bônus/recompensa.
- Participante de uma Fila READY não pode contribuir na próxima até finalizar sua tarefa. Após conclusão manual ou 100%, há cooldown persistente de 30 minutos (`423 COOLDOWN_ACTIVE`); depois volta ao fluxo comum.
- O mesmo `video_id` do YouTube não pode ser reutilizado em Filas posteriores.

## WhatsApp

Fluxo atual: `Quero participar` → tela de dados → solicitação persistente → dashboard Owner/bot → decisão Owner → a mesma página acompanha o estado → quando todas as verificações exigidas estiverem concluídas mostra `Cadastro aprovado` → usuário volta ao acesso normal. Reenvio do mesmo WhatsApp fica bloqueado por 120 minutos sem apagar o pedido. OTP não é requisito do login principal.

A decisão do Owner responde por mensagem livre quando a janela de serviço está ativa; fora dela usa `WHATSAPP_DECISION_TEMPLATE` quando configurado. Fila persistente, HMAC, deduplicação, lease, retry/backoff e OTP por template permanecem.

Automação de grupos:
- worker pode descobrir grupos oficiais cujo subject é `SOS YOUTUBER N` e registrar sua evidência externa;
- presença do participante é gravada separadamente da decisão Owner;
- **presença no grupo não aprova cadastro por si só**;
- quando a validação externa estiver ativa, o acesso só é materializado com aprovação Owner + presença do membro + prova de que ao menos um Owner é admin pelo mesmo provedor;
- saída do grupo revoga a prova externa/acesso aplicável sem apagar dados históricos;
- eventos são deduplicados e o painel permite sincronização imediata;
- sem provedor real pareado, o fallback de validação manual Owner continua disponível.

Isso não simula acesso a grupos comuns não expostos pela API oficial. A validação real depende da conta Meta, OBA/eligibilidade e IDs retornados pelo provedor.

## Continuidade e UI Premium — 06/10/2026

- `docs/ANCHOR-YOUTUBE-FINAL.md` é a âncora canônica obrigatória; `docs/SKILL-CONTINUIDADE-YOUTUBE-FINAL.md` define o protocolo operacional.
- Intro preserva a identidade ASTRA com lockup horizontal da marca e uma única CTA `Quero participar`. O botão voltou ao vermelho simples anterior; o bloco de segurança é textual, **sem escudo/ícone verde**.
- A CTA `Quero participar` abre a tela intermediária; o envio cria uma página persistente `Solicitação em análise`, com acompanhamento automático/manual. Após aprovação, a mesma página muda para `Cadastro aprovado`; o usuário escolhe quando voltar ao acesso.
- Login continua universal: nome + `WhatsApp` internacional, sem campo manual de grupo para participante, sem +55 automático, sem rótulos Owner e sem `#` visível. `Credencial administrativa` só aparece para Owner; o grupo é resolvido server-side.
- Texto auxiliar do login é uma linha no desktop e responsivo no mobile.
- País/DDI fica contido em popover com rolagem interna e setas ↑/↓; DDD brasileiro usa trilho horizontal ‹/› e busca incremental por teclado sem caixa extra (`7` filtra 7x; `71` localiza 71). O DDD exibe 15 cards completos (5×3) por viewport, sem coluna parcialmente cortada; E2E também bloqueia overflow horizontal do seletor/documento. Ambos fecham com `Esc` e não alteram a altura da página.
- `Grupos e acesso` pagina funcionalmente o espaço 1–999 em carrossel; grupos não persistidos podem ser ativados diretamente. A autorização manual usa o mesmo `PhoneField` internacional e seletor visual 1–999.
- Modal do BOT possui scroll interno, fecha por `Esc` em camadas e explica **Meta Oficial / Meta + Grupos / Evolution Gateway / Desativado**. O botão `Configurar integração` usa sempre vermelho ASTRA; Meta Oficial usa azul, Meta + Grupos usa vaporwave azul/roxo/magenta com Meta + YouTube 50/50, Evolution usa navy/índigo e Desativado usa cinza. A seleção altera imediatamente textos/status/campos antes de salvar; Evolution não exibe aviso, webhook ou validação Meta.
- Passe Premium global foi limitado a profundidade, consistência de cartões, botões, slots, dashboard e modais, preservando paleta navy/vermelho/creme e tipografia ASTRA.
- Webapp/XFCE é a prioridade corrente; APK não é prioridade desta rodada.

## Recuperação por Git — 05/10/2026

Uma regressão de contexto foi identificada e recuperada pelo histórico:
- `53e6d87` consolidou o onboarding internacional + bot;
- `9ac044a` preservou a CTA como entrada para a tela intermediária;
- `e4f1bf2` voltou a permitir link direto ao WhatsApp quando `whatsappJoinUrl` existia, pulando a tela já validada;
- a decisão recuperada agora é protegida por E2E mesmo quando um WhatsApp fictício está configurado;
- `docs/SKILL-RECUPERACAO-MEMORIA-GIT.md` tornou-se obrigatória quando o usuário disser que algo já havia sido corrigido/validado ou que a instância perdeu contexto.

A intro também fixa por teste: botão `Quero participar` isolado e com a mesma métrica de `Continuar`, sem retângulo externo; frase `Sempre por escolha sua.` em nova linha; peso normal nas duas primeiras linhas de segurança e negrito apenas na última.

## Verificação do WIP de convergência

Gate completo executado após recuperação por Git e refinamento visual:
- `git diff --check`: aprovado;
- backend: 65/65 testes;
- cliente: 9/9 testes;
- TypeScript API e cliente: aprovado;
- build API + React/PWA: aprovado;
- Playwright E2E: 1/1 aprovado no fluxo completo;
- Android: sync aprovado e APK debug gerado com SDK 35 local do projeto.

## Estado operacional local — Xubuntu · 05/10/2026

- Web/API locais respondem em `http://localhost:5173` e `http://localhost:3333`.
- `/auth/login` é o fluxo principal do participante: só concede sessão se telefone + grupo já estiverem ativos em `group_memberships`; caso contrário retorna 403 em português.
- Owner identificado por nome/alias + WhatsApp recebe apenas o campo `Credencial`; em `AUTH_DEV_MODE=true`, `sosyout` é aceito para teste local.
- Banco local, no diagnóstico desta rodada, tinha `0` memberships ativos e `0` usuários cadastrados; por isso nenhum participante real conseguia entrar antes de aprovação.
- Grupos públicos atuais: `1`, `2`, `10`.
- O contato público usa `OWNER_WHATSAPP` quando definido e, na ausência dele, usa o número Owner Rafael. O dashboard Owner já permite salvar no servidor e validar a configuração oficial Meta; sem credencial real, a conexão permanece explicitamente pendente. O complemento escolhido para grupos tradicionais é WPPConnect, ainda não pareado/ativado.
- O modo dev remove service workers/caches antigos e o launcher XFCE abre URL com cache-bust para reduzir risco de testar bundle PWA obsoleto. O launcher canônico está versionado em `scripts/launch-xubuntu.sh`, prefere Firefox explicitamente e usa `xdg-open` apenas como fallback.

## Publicação web

- GitHub Pages continua disponível em `https://fabiomtt2.github.io/sosyt/`; o build Pages usa `/sosyt/` em assets, manifest, PWA `start_url` e `scope`.
- Backend HTTPS real já existe no Railway: `https://sos-youtuber-api-production.up.railway.app`, Fastify em produção, healthcheck `/health` e SQLite em volume persistente.
- Frontend full-stack existe em `https://sos-youtuber-web-production.up.railway.app`, apontando para a API Railway. Após o merge, API e Web foram repontados para `checkpoint de aplicação 65d5b2c` e ficaram online/SUCCESS, 1/1 réplica e sem alertas/falhas; a API passou healthcheck 200 com o volume persistente montado.
- A build pública nunca deve cair no `localhost:3333` do visitante; `VITE_API_URL` deve apontar para backend HTTPS quando a publicação precisar operar de ponta a ponta.
- `vite.config.ts` é a única configuração Vite canônica; scripts nomeiam explicitamente esse arquivo para impedir precedência de artefatos legados.

## Recuperação e convergência — 06/10/2026

- Git local encontrado e reancorado em `~/Documents/Codex/2026-10-04/gostar/YouTube Final`; `main` e `origin/main` estavam limpos em `45ce984`.
- Branch de recuperação atual: `sol/whatsapp-modes-evolution-20261006-recovered`.
- Desktop Commander secundário está online no Inspiron com cota disponível e é a rota local preferencial.
- `gh` local está autenticado como `Fabiomtt2` com escopos `repo` e `workflow`, contornando o GitHub App somente-leitura desta instância.
- O trabalho feito no Vercel ficou preservado no snapshot `snap_Kg3VFafm7lvEcrJXCFXYYeYL9hNs`; o hash Sandbox `6b29eb6` era o checkpoint mais completo, enquanto `951bf7b`/`0dccc7d` eram intermediários. Esses hashes nunca chegaram ao GitHub e foram recuperados/supersedidos na branch local atual.
- Recuperação implementada localmente: busca DDI por nome/acento; badge ASTRA da autorização manual; `META_GROUPS` com migração do legado `HYBRID`; Evolution Gateway com URL/instância/API key cifrada; contexto do modal e resumo Owner sensíveis ao provider.
- Gate local desta recuperação: 65/65 API, 9/9 cliente, build API, React/PWA e Playwright E2E 1/1 aprovados. Evidências visuais foram regeneradas em `docs/evidencias/`.
- Nenhum recurso pago deve ser criado para contornar conectores quando houver rota local/gratuita funcional.

## Pendências externas/produção

- Credenciais e teste real Meta WhatsApp/Groups API.
- Credenciais e teste real Google/YouTube.
- Credenciais e conciliação real do provedor financeiro escolhido (Mercado Pago, Asaas ou PagBank); adaptadores e configuração Owner existem, mas cada conta precisa de teste real antes de produção financeira.
- Política de privacidade, termos, retenção/exclusão e revogação de dados.
- Observabilidade, backup/restauração e implantação.
- Revisar requisitos contratuais/políticas dos provedores antes de produção.
- APK debug atualizado foi gerado; instalação automática no aparelho físico ficou pendente porque o transporte USB/ADB oscilou durante a tentativa. Android WIP histórico não foi destruído.


## Reauditoria visual — 06/10/2026 · HEAD base 66af15c
- Local e origin/main foram reancorados no mesmo commit antes da rodada.
- RED real em Grupos e acesso: o grid esticava internamente o campo Nome; corrigido para mesma coordenada Y e 50 px de altura do PhoneField. E2E exige diferença <=1 px.
- RED real no modal Configurar integração: o wrapper era um header e herdava a barra navy global, gerando a faixa escura/texto ilegível. Wrapper isolado + proteção em integration.css.
- Novo gate visual cobre 1366x768, scroll interno, ausência de overflow horizontal e não sobreposição título/status/seção.
- Página participante e motor de Filas/moedas/URLs/progresso permanecem invariantes protegidos pelo gate completo.


## Owner control plane + pagamentos + auditoria visual — 06/10/2026

- Base desta rodada: `main @ 02f3e4b`; a branch `sol/owner-control-plane-20261006` foi validada e convergida no checkpoint de aplicação `65d5b2c`.
- **Premissa preservada:** moedas virtuais, compra de pacote, passes, wallet/ledger, Fila, cooldown e progresso continuam com a lógica anterior. A camada financeira apenas processa/confirma o Pix.
- DDD brasileiro: removido timer de 1,2 s que apagava a busca incremental. `71` permanece filtrado enquanto o popover estiver aberto; E2E espera 1,6 s para proteger essa regressão.
- Grupos: `enabled` agora significa **habilitado internamente no SOS**, não “grupo WhatsApp existente”. Overview/gerenciamento separam vínculo externo, provedor de verificação, Owner-admin, última prova/sincronização e `join_url`. ID externo é somente leitura.
- Pagamentos Owner: `MERCADO_PAGO | ASAAS | PAGBANK | DISABLED`, um ativo por vez para novas compras. Troca não reatribui pagamentos antigos.
- Credenciais financeiras são cifradas em `integration_settings`; UI recebe apenas flags de configuração. Receita e pacotes mensais somam qualquer provider real aprovado e excluem `DEMO`.
- Mercado Pago usa Pix + assinatura de webhook; Asaas usa cobrança/QR e tenta configurar o webhook ao salvar; PagBank usa pedido Pix e valida assinatura do webhook sobre corpo bruto.
- Webhooks Asaas/PagBank usam `payment_webhook_events` para idempotência. Pagamentos pendentes consultam o provider gravado na própria transação, mesmo após troca do provider ativo.
- Owner passou por auditoria visual real, registrada em `docs/AUDITORIA-VISUAL-OWNER-20261006.md`. Evidências finais: `owner-pagamentos-after-audit-desktop.png`, `owner-pagamentos-after-audit-mobile.png`, `owner-grupo-gerenciar-desktop.png`, `owner-desktop.png`, `owner-mobile.png`.
- Regra UX: linguagem leiga na superfície; token/webhook/API Key/Access Token/Git/WIP atrás de `?`. Modais Owner usam blur, body lock e scroll interno.
- “Painel sincronizado com o servidor” = polling dos dados exibidos a cada 10 s. “Conferir versão online” não instala nem faz deploy.
- Mês de referência é apresentado em PT-BR; aba ativa mobile é centralizada.
- Gate atual: **67/67 API + 9/9 cliente + lint/TypeScript + build API/React/PWA + Playwright E2E 1/1**.
- Nenhum recurso pago foi criado para esta convergência.


## Reancoragem ASTRA — 07/10/2026 (em execução)

- Leitura integral dos 13 documentos exigidos concluída antes de editar.
- Local: sol/user-premium-20261006 @ c0b8172; origin/main e GitHub main idênticos após fetch.
- Railway: API/Web SUCCESS, 1 réplica cada, volume /data; ambos fixados em 65d5b2c (push de main sozinho não troca o pin). Nenhum deploy nesta rodada.
- WIP original staged/unstaged/untracked preservado em snapshot privado .local-tmp/astra-entry-*/ com patches separados, arquivos e hashes; index não alterado.
- Assets coins-bag.webp (34940 bytes) e pass-ticket.webp (27094 bytes) presentes; documentos anteriores sobre ausência/tamanho inválido estão superados. Hero community/growth ainda ausentes.
- Histórico pesquisado nas duas árvores, reflogs/branches/objetos órfãos: nenhum runtime Python, .pyc ou IFtp recuperado; update-watch.py é gerador JSX. Três blobs órfãos são handoffs Markdown. Acompanhamento nasceu em 361c87a (React) e ganhou persistência/ledger em 2365736.
- Regra explícita nova do usuário: 1 moeda virtual por 20 minutos acumulados entre sessões e filas; regra histórica de 10% deve ser migrada sem apagar ledger. Ainda NÃO implementada/validada nesta rodada.
- ROOT_OWNER de Fábio e Rafael confirmado no código. Gate antigo não substitui nova validação.
- Próximo: auditoria de motores/UX, recuperação das artes aprovadas, companion opt-in testável, gate completo, commits por domínio, merge/deploy somente após convergência.


### Decisão explícita de identidade — ASTRA 07/10/2026
- Usuário escolheu Google/YouTube (pergunta identity_proof) para confirmar identidade em aparelho novo. Isso supersede acesso público somente por nome/telefone.
- Identificação Google deve usar escopo mínimo separado da permissão YouTube para criar playlists.
- Conta legada sem vínculo Google não pode ser vinculada automaticamente só por telefone: exige aprovação Owner da associação. Sessões posteriores continuam conectadas.
- RED P0 reproduzido em banco isolado: /auth/login comum com telefone de Owner autorizado como participante -> /admin/elevate 200 ROOT_OWNER sem credencial. Corrigir origem/versão da sessão administrativa; não reduzir privilégios de Fábio/Rafael.
- E2E baseline fresco passou 1/1 em 94,5 s. Loja visualmente RED: cartaz + objeto sobreposto, repetição de preços e informação.


### Ajuste do usuário — 07/10/2026 08:43 (Bahia)
A decisão mais recente substitui Google obrigatório: acesso principal por número WhatsApp e chave aleatória de uso único com expiração de 5 minutos, entregue pelo bot. Mesma chave serve para confirmar registro ou login; grupo continua derivado do número, com aprovação manual Owner preservada. Google pode continuar opcional e a autorização YouTube permanece separada. Não acrescentar senha própria nem provedor SMS nesta rodada. Sessão autenticada, aprovação de grupo e conexão YouTube são estados distintos do mesmo user_id; não duplicar carteira, URLs ou histórico. Envio real ainda depende de configuração Meta/template; não anunciar funcionamento externo sem confirmação.
WIP de segurança em andamento: proteção de elevação ROOT e revogação administrativa, módulo Google opcional (ainda sem gate), adaptação OTP 300 s e registro verificado. Nada publicado/deployado.


### Checkpoint ASTRA — autenticação validada, 07/10/2026
Regra confirmada pelo usuário às 08:47 Bahia: Google e chave WhatsApp são alternativas coexistentes; não criar conta/carteira por método. Chave OTP aleatória de 6 dígitos expira em 300 s, uso único, 5 tentativas, reenvio mínimo 60 s. Registro por chave confirma número sem conceder aprovação de grupo. Cadastro manual Owner é preservado. Google exige vínculo aprovado antes de acessar cadastro existente; scopes openid/email separados do YouTube.
GREEN: lint/TS; API 89/89; client 10/10; cenário E2E anterior passou; novo E2E phone-key.spec.ts passou isolado (4,9 s). Captura login-chave-whatsapp-mobile.png inspecionada. Corrigida infraestrutura E2E: limpeza do banco de fixture movida do playwright.config.ts (reimportado pelos workers) para scripts/browser-tests.mjs antes da API iniciar. Gate completo final ainda pendente; nenhuma publicação.
Segurança: login nome/telefone sem prova restrito a AUTH_DEV_MODE; sessões OTP/Google em modo real vinculadas ao número; elevação ROOT exige sessão administrativa emitida com credencial Owner válida; rotação/revogação invalida privilégios.
Próximo: substituir aceitação de vetores arbitrários de watch-progress e recompensa antiga 1 moeda/10% por observações limitadas pelo relógio do servidor, deduplicação de trechos e 1 moeda/20 min acumulados. Histórico e ledger antigos serão preservados sem fabricar tempo observado.


### ASTRA — Business e revisão do motor Sol — 07/10/2026 13:46 Bahia
Business +5571993978956 centralizado, persistido e editável em todos os modos do painel; propagação sem hardcode no frontend. Troca de identidade de remetente exige confirmação de correspondência na Meta, sem alterar telefones dos Owners. Campo/ajuda/edição/reload/wa.me validados E2E desktop/mobile; captura business-numero-mobile.png inspecionada. Intro sem montagem de imagem/carrossel. Botão de contato na solicitação resolve número do servidor a cada 10 s e ao recuperar foco.
Antes da revisão do watch: API 103/103, client 10/10, lint/build GREEN, E2E 3/3 GREEN. Dois REDs adicionais foram reproduzidos por ASTRA no motor Sol: (1) 100% legado provocava finalização automática na primeira observação, (2) intervalo após amostra pausada podia ser creditado. Correção aplicada: estado anterior active persistido, cobertura de intervalos dos dez vídeos para conclusão, percentuais sem arredondar antecipadamente para 100 e UI deixa de somar reprodução local repetida. Os 6 testes watch-time passaram após correção; acrescentada cobertura do encerramento natural. Novo gate em andamento. Nenhum commit/push/merge/deploy.


### Checkpoint ASTRA — 07/10/2026 13:51 Bahia
- Nova regra Business e visual do usuário incorporada. API 106/106 + cliente 10/10, lint e build GREEN após revisão ASTRA dos dois REDs adicionais no motor Sol. Gate E2E final em conferência; execução PID 287244. Build mantém aviso de bundle ~566 kB (não bloqueante).
- Pendente de produto/infra: credenciais oficiais Meta e Google não fabricadas; não confundir número Business existente com Cloud API configurada. Todas as alterações ainda locais, sem deploy.
- Auditoria histórica não encontrou runtime Python IFtp/IFTP nas duas árvores/reflogs/objetos examinados; update-watch.py é gerador JSX, não runtime. Próximo bloco será companion novo, identificado como nova implementação, opt-in, captura apenas região escolhida, sem enviar imagens, com autorização revogável e sinais complementares ao motor web. OCR não provará atenção humana nem autorizará moedas sozinho.
- Preflight do Inspiron: tkinter/Pillow/OpenCV disponíveis; tesseract e xvfb ausentes. Ainda não foi instalado nada neste bloco nem criado companion. Não alegar recuperação de runtime histórico.
