# PROMPT OBRIGATÓRIO — PRÓXIMA INSTÂNCIA SOS YOUTUBER

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


> **Leia este arquivo integralmente antes de editar qualquer coisa.**
> Depois confira o estado REAL via Desktop Commander, Git local, GitHub e Railway.
> Não assuma que o chat é mais atual que o filesystem.

## Reancoragem canônica — 07/10/2026

Diretório local canônico:
`~/Documents/Codex/2026-10-04/gostar/YouTube Final`

Git local na abertura desta rodada:
- branch: `sol/user-premium-20261006`
- HEAD: `c0b817218c7ca7771b749b57168030decc5fe54a`
- origin: `https://github.com/Fabiomtt2/sosyt.git`
- `main` e `origin/main`: `c0b8172`
- WIP grande staged + unstaged: **NÃO reset / clean / stash / checkout destrutivo**.

GitHub:
- repo público canônico: `Fabiomtt2/sosyt`
- default branch: `main`
- main confirmado diretamente pelo conector no commit `c0b8172`.

Railway:
- projeto: `SOS YouTuber`
- production env: `b431d0b9-6a69-4d2a-afb3-c4a79f3dbb0a`
- API service: `sos-youtuber-api`
- WEB service: `sos-youtuber-web`
- ambos online, 1/1 réplica, sem staged changes.
- deployment live atual de API e WEB: commit de aplicação `65d5b2c`, não a WIP premium.
- API preserva volume `sos-youtuber-data` montado em `/data`.
- houve uma falha histórica antiga do WEB nas últimas 24h, mas deployment atual está SUCCESS/online.

## O que esta rodada implementou até agora

1. **Motor de canal do participante**
   - Owner overview recebe `youtubeChannelId/title/thumbnailUrl`.
   - modal administrativo individual recebe `profile.youtubeChannel`.
   - UI Owner mostra nome + ícone do canal.
   - card da contribuição mostra miniatura do canal do participante junto ao thumbnail do vídeo.
   - área de envio mostra canal conectado ou CTA “Conectar/Atualizar canal”.
   - perfil “Minha conta” também mostra identidade YouTube.
   - OAuth existente `/youtube/connect` é reutilizado sem `roundId` para conectar canal antes da playlist.
   - teste API novo passou.

2. **Fila “Fila 12 de 10 vídeos”**
   - causa identificada: concatenação visual de “Fila 1” + “2/10”, não banco com 12 slots.
   - DB continua com CHECK slot 1..10.
   - OwnerDeskMenu agora separa `Fila 1` e progresso `2/10 vídeos`.
   - botão virou `Participar da fila` e ganhou espaçamento próprio.

3. **Modais**
   - helper `useModalLifecycle.ts` criado.
   - StoreModal, OwnerTeamModal, OwnerDeskMenu, ParticipantAdminModal, GroupAdminModal, AdminHelpModal, criação de playlist e WatchProgress receberam/padronizaram body-lock + Escape.
   - clique no backdrop já fecha nos componentes principais; CSS garante scroll interno do modal e não da página.

4. **Intro real**
   - `IntroVisualCarousel.tsx` criado e inserido no `brand-panel` antes do login.
   - fallback seguro para `hero.webp`.
   - referências opcionais: `hero-community.webp` e `hero-growth.webp` se existirem.

5. **Avatar persistente**
   - backend já persistia presets.
   - falha do teste anterior: E2E só abria o seletor e nunca clicava.
   - E2E foi alterado para escolher `avatar 17`, confirmar fechamento, reabrir e exigir estado `selected`, além de Escape.
   - **ainda precisa rodar o E2E atualizado antes de declarar validado.**

6. **Badge dourado ADMIN na fila**
   - usuário reportou corte.
   - causa estrutural: badge usava `bottom:-6px` fora do envelope.
   - JSX agora marca `.slot-avatar-shell.has-admin-badge`.
   - shell reserva espaço inferior; badge fica dentro do envelope; botão administrativo recebe altura mínima.
   - **precisa gate visual/E2E antes de declarar fechado.**

## Gates já rodados nesta rodada

- API após novo teste de canal: **74/74 GREEN**
- TypeScript/lint API + client: **GREEN**
- `git diff --check`: vinha GREEN antes desta micro-rodada; repetir após badge/E2E.
- Playwright atualizado: **AINDA NÃO RODADO** depois das mudanças mais recentes.

## Assets visuais

Preservar:
- `avatars.webp`
- `coins.webp`
- `hero.webp`
- `pass.webp`
- `watch.webp`

`coins-bag.webp`:
- `file` reconhece RIFF/WebP 480x480 alpha.
- PIL/libwebp local falhou ao decodificar (`could not create decoder object`).
- portanto ainda tratar como **suspeito / não promover** até validação visual/decoder confiável.

Ainda faltam localmente:
- `pass-ticket.webp`
- `hero-community.webp`
- `hero-growth.webp`

Não inventar/substituir artes aprovadas sem recuperar os binários corretos.

## Próxima sequência obrigatória

1. conferir `git status --short --branch`, HEAD, origin/main e sessões DC;
2. conferir Railway production e GitHub main;
3. rodar lint/diff-check após qualquer edição;
4. completar E2E:
   - avatar 17 realmente persiste;
   - Owner menu mostra Fila + progresso separados;
   - Escape fecha menu/modal;
   - badge ADMIN da fila cabe integralmente no envelope;
5. revisar screenshots desktop + mobile;
6. concluir assets aprovados;
7. gate completo:
   `git diff --check && npm test && npm run lint && npm run build && npm run test:e2e -w @conexao/client`
8. revisar diff por domínio;
9. commits temáticos pequenos;
10. merge para `main`, push GitHub;
11. confirmar Railway redeploy do novo commit e saúde;
12. atualizar este arquivo + `CONTINUIDADE-CANONICA.md` + `PROJECT_STATUS.md` com hashes finais.

## Regra de heartbeat e perda de instância

A cada marco relevante ou aproximadamente 3 minutos de trabalho prolongado:
- atualizar este arquivo e/ou o canônico com o estado novo;
- registrar GREEN/RED real, não promessa;
- nunca escrever “corrigido” se só foi implementado e ainda não foi testado;
- se a instância cair, a próxima começa por este arquivo e pelos estados reais Git/DC/GitHub/Railway.

### Heartbeat E2E — 07/10/2026

Primeira execução do Playwright após as mudanças recentes:
- lint/TypeScript: GREEN;
- Playwright: RED em assert novo do menu Owner, porque o teste exigia literalmente `2/10`;
- DOM real capturado mostrou `Fila 1` + `0/10 vídeos · recebendo contribuições`;
- isso confirmou que o valor é dinâmico e que o teste precisava validar separação visual, não assumir contagem;
- assert foi corrigido para aceitar `N/10` e medir título/progresso em linhas separadas.
- E2E completo ainda precisa ser reexecutado; avatar persistente e badge ADMIN continuam “implementados, aguardando validação E2E”.

### Heartbeat avatar/CORS — 07/10/2026

Segundo Playwright expôs o bug real do avatar:
- clique em avatar 17 ocorreu;
- modal permaneceu aberto;
- UI mostrou erro de conexão com API;
- causa confirmada no pacote `@fastify/cors`: default `GET,HEAD,POST`, enquanto avatar usa `PUT /profile/avatar`.
Correção aplicada:
- CORS explícito: GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS;
- teste de preflight adicionado em `apps/api/src/app.test.ts`.
Isso também protege PATCH/DELETE usados por outros fluxos web.
Ainda falta reexecutar gate/E2E para declarar avatar persistente GREEN.

### Heartbeat GREEN navegador — 07/10/2026

Após corrigir CORS:
- API: **75/75 GREEN**;
- lint/TypeScript: **GREEN**;
- Playwright completo: **1/1 GREEN (44,3 s)**.
Validado em navegador real:
- menu Owner mostra Fila e N/10 em linhas separadas;
- Escape fecha menu Owner;
- avatar 17 é salvo via PUT, modal fecha, avatar vira preset e ao reabrir o seletor 17 continua `selected`;
- causa do bug localhost era CORS sem PUT/PATCH/DELETE;
- badge dourado ADMIN foi criado em submissão administrativa real na Fila 2 e a geometria exige badge inteiro dentro do shell/card;
- screenshot nova: `docs/evidencias/participante-admin-badge-fila.png`.
Fila + avatar persistente + badge ADMIN estão agora GREEN.


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

### Checkpoint Sol auditor de motor — 07/10/2026 ~09:45 Bahia
- Sol assumiu temporariamente o papel de auditor independente que seria do Claude.
- Snapshot integral da WIP ASTRA criado em `.local-tmp/sol-motor-entry-*` antes de editar.
- Auditoria registrada em `docs/AUDITORIA-SOL-MOTOR-20261007.md`.
- P0 confirmado: rota histórica premiava vetores arbitrários `watchedSeconds/durations` por 10%.
- Migração SQLite aditiva criada: `watch_time_totals`, `watch_observation_state` e `observed_intervals_json`; nenhum ledger antigo foi removido.
- Nova rota server-time `POST /rounds/:id/watch-observation` implementada.
- Motor novo: relógio do servidor, sessão única por usuário, rejeição de seek, dedupe de intervalos, acúmulo global entre sessões/filas, 1 moeda a cada 1200 s via ledger novo `WATCH_TIME`.
- `WATCH_PROGRESS` histórico permanece intacto e não vira tempo inventado.
- Teste novo `watch-time.test.ts`: 4/4 GREEN.
- Suíte API completa após a camada server-side: **93/93 GREEN**.
- Cliente React ainda usa protocolo legado neste checkpoint; NÃO desativar/remover rota antiga antes de migrar o cliente.

### Gate GREEN — motor de tempo server-side — 07/10/2026 ~09:58 Bahia
- Novo protocolo `POST /rounds/:id/watch-observation`.
- Relógio do servidor limita o tempo aceito; seek/salto não credita; trechos repetidos não creditam; sessão concorrente ativa não credita.
- Tempo verificado acumula globalmente entre sessões e filas; 1200 s verificados = 1 moeda via ledger `WATCH_TIME`.
- Ledger histórico `WATCH_PROGRESS` permanece preservado e não é convertido em minutos inventados.
- Rota legada `PUT /watch-progress` fica apenas como compatibilidade de percentual/finalização e NÃO concede novas moedas (`LEGACY_NO_REWARD`).
- React usa o protocolo novo e a UI não promete mais moeda por percentual.
- Gate: API 93/93 GREEN; client 10/10 GREEN; lint/TypeScript GREEN; build API+PWA GREEN; Playwright 2/2 GREEN; `git diff --check` GREEN.

### Checkpoint Sol — idempotência de curadoria — 07/10/2026 ~10:04 Bahia
- Fechamento de Fila foi endurecido: carteira só recebe CURATION_REWARD quando o `INSERT OR IGNORE` correspondente realmente cria o ledger.
- Novo teste injeta ledger pré-existente sem saldo, fecha a fila e prova ausência de crédito duplicado.
- API agora **94/94 GREEN**; `git diff --check` GREEN.
- `settlePayment()` foi revisado: já opera em transação, verifica `PIX_PURCHASE` antes da carteira e não recebeu alteração sem evidência de falha.

### Checkpoint Sol — segurança de identidade — 07/10/2026 ~10:14 Bahia
- Produção não aceita mais `/participation/request` sem prova de identidade; fluxo real usa chave WhatsApp (`request-code registration:true`).
- Resposta legada `ALREADY_REGISTERED` não devolve mais `groupCode`.
- Teste prova que produção não enumera cadastro/grupo por essa rota.
- Teste adicional prova que revogar `ADMIN_OWNER` invalida imediatamente token Owner e nova `/admin/elevate` da sessão participante.
- API **95/95 GREEN**; `git diff --check` GREEN.

### Checkpoint Sol motor — 07/10/2026 12:05 Bahia
- Gate build + E2E pós-migração foi retomado do PID 266534.
- `npm run build`: GREEN.
- `phone-key.spec.ts`: GREEN.
- `community.spec.ts`: RED único por expectativa textual obsoleta:
  esperava `0% · +0 moedas`, mas a UI nova separa percentual de recompensa por tempo.
- O RED não indica falha do motor; é teste legado incompatível com a microcopy nova.
- Próximo passo exato: atualizar a assertiva para `0% concluído` + resumo de tempo verificado e rerodar E2E completo.

### Checkpoint Sol motor — 07/10/2026 12:07 Bahia
- E2E completo pós-migração watch-time: **2/2 GREEN**.
- community.spec.ts: GREEN (43,9 s).
- phone-key.spec.ts: GREEN (4,1 s).
- A expectativa antiga de `0% · +0 moedas` já estava atualizada na working tree para `0% concluído` + tempo verificado.
- Próximo passo: gate integral único e revisão do diff do motor antes de qualquer commit/merge.

### Checkpoint Sol — watch-time frontend integrado — 07/10/2026 ~12:07 Bahia
- React migrou do payload premiável de vetores para POST /rounds/:id/watch-observation.
- UI não promete mais moeda por percentual; mostra percentual apenas como progresso e recompensa como tempo real verificado acumulado.
- Sessão de acompanhamento agora é estável por aba/usuário; fechar e reabrir o modal na mesma aba não cria falso conflito de 15 s.
- Rota legada PUT /watch-progress permanece apenas para compatibilidade de progresso e não concede novas moedas (LEGACY_NO_REWARD).
- Único motor que concede a recompensa nova é WATCH_TIME, 1 moeda por 1200 s verificados server-side.
- Histórico WATCH_PROGRESS permanece intacto.
- API: 93/93 GREEN na última suíte.
- Cliente unitário: 10/10 GREEN.
- lint/TypeScript + diff-check: GREEN.
- Playwright completo após atualização da microcopy: 2/2 GREEN (community + phone-key).
- Próximo: gate completo final depois da alteração de sessão estável; em seguida continuar auditoria dos motores WhatsApp/pagamentos antes de qualquer merge/deploy.

### Checkpoint Sol motor — FULL GATE GREEN — 07/10/2026 12:11 Bahia
Após migração completa do cliente para `POST /rounds/:id/watch-observation` e desativação de recompensa no protocolo legado:
- diff-check staged + unstaged: GREEN
- API: **96/96 GREEN**
- client unit: **10/10 GREEN**
- lint API + client: GREEN
- build API + PWA: GREEN
- Playwright: **2/2 GREEN**
- total: **106 testes unit/integration + 2 E2E verdes**
- build mantém apenas warning não bloqueante de chunk ~563 kB.
- protocolo legado `PUT /watch-progress` preserva compatibilidade de progresso, mas não concede novas moedas.
- protocolo novo é o único que gera `WATCH_TIME`: 1 moeda/1200 s server-time verificados.

### Gate completo GREEN — Sol — 07/10/2026 ~12:13 Bahia
Estado após integração do motor de recompensa por tempo:
- git diff --check: GREEN
- API: 96/96 GREEN
- cliente: 10/10 GREEN
- lint/TypeScript API+cliente: GREEN
- build produção API+cliente/PWA: GREEN
- Playwright: 2/2 GREEN (community + phone-key)
- watch-time: 1 moeda por 1200 s server-side; protocolo legado não premia; histórico antigo preservado.
- sessão de acompanhamento é estável por aba/usuário para não gerar falso conflito ao reabrir o modal.
Nenhum commit/push/merge/deploy foi feito por este gate. Próximo bloco: auditoria read-only de WhatsApp/pagamentos e readiness de produção antes de convergir commits.

### Checkpoint Sol auditor de concorrência — 07/10/2026 12:15 Bahia
- Auditoria de fila/ledger/pagamento feita após FULL GATE GREEN.
- Débito de moeda/passe, insert da submissão, ledger, fechamento e abertura da próxima fila estão na mesma transação SQLite.
- `UNIQUE(round_id,slot)`, `UNIQUE(round_id,video_id)` e ledger com referência única protegem invariantes locais.
- Testes concorrentes novos:
  1. duas submissões simultâneas -> slots 1 e 2, um débito para cada usuário;
  2. mesmo vídeo simultâneo -> 1x 201 + 1x 409, perdedor sem débito e apenas 1 ledger SUBMISSION.
- Suíte API neste checkpoint: **98/98 GREEN**.
- `settlePayment()` é transacional e replay já possui cobertura idempotente.
- P1 arquitetural: schema não possui constraint parcial de “somente uma fila OPEN”; código mantém essa regra. Não adicionar migration restritiva sem auditar DB Railway.
- Escala futura: uma réplica + SQLite está coerente; múltiplas réplicas exigiriam banco transacional compartilhado/estratégia diferente.

### Checkpoint Sol auditor WhatsApp — 07/10/2026 12:20 Bahia
- Outbox oficial é motor real: persistência, dedupe_key, lease, retry/backoff, HMAC webhook, OTP/template, Owner alerts e decisão.
- Teste concorrente novo prova que dois flushes simultâneos não enviam o MESMO job duas vezes no runtime atual.
- API neste checkpoint: **99/99 GREEN**.
- Config local: telefones dos Owners presentes; credenciais/IDs específicos Meta Business e templates oficiais ainda não estão configurados no .env local.
- Classificação: motor REAL/TESTADO; serviço Meta real PENDENTE DE CREDENCIAL/CONFIGURAÇÃO.
- Não imprimir ou versionar números/tokens/segredos; verificar apenas presença no Railway antes da configuração.

### Checkpoint Sol hardening watch legado — 07/10/2026 12:24 Bahia
- Rota legada PUT /rounds/:id/watch-progress não concede moeda e agora também NÃO finaliza tarefa/cooldown.
- Percentual legado pode continuar salvo apenas por compatibilidade visual.
- Tarefa READY continua pendente até protocolo server-time ou ação explícita de finalização/abandono.
- Teste atualizado prova 100% legado sem finalized_at, sem cooldown e sem liberar nova contribuição.
- API: **99/99 GREEN**.
- Outbox WhatsApp concorrente também coberto: um job único não é enviado duas vezes.

### Checkpoint Sol — auditoria WhatsApp/pagamentos — 07/10/2026 ~12:34 Bahia
- Gate anterior pós watch-time: API 96/96, client 10/10, lint/build GREEN, Playwright 2/2 GREEN.
- Testes concorrentes válidos foram preservados; suíte API atual passou 99/99.
- Pagamentos auditados: settlement idempotente por ledger, confirmação reconsulta provedor, webhooks MP/Asaas/PagBank autenticados e cancelamento pós-aprovação coloca carteira em revisão. Nenhum P0 encontrado nesta passada.
- Integração WhatsApp em SQLite cifra segredos server-side e é usada por OTP, outbox, webhook e sync de grupos.
- Corrigida lacuna: nomes de templates OTP/alerta Owner/decisão + idioma agora podem ser persistidos pelo painel ROOT_OWNER e entram no effectiveWhatsAppConfig.
- Painel WhatsApp ganhou seção de templates Meta; lint/build/E2E 2/2 GREEN após mudança; screenshots top/scroll inspecionados e modal continua com scroll interno/botões contidos.
- Business Phone salvo no painel agora tem precedência no link público Quero participar/wa.me; fallback Owner permanece. Regressão coberta em owner.test.
- API após correção do link público: 99/99 GREEN + lint API GREEN.
- docs/WHATSAPP-INTEGRACAO.md atualizado: OTP/Google identidade atual, templates configuráveis no painel e distinção Business Phone x Phone Number ID.
- Nenhum commit/push/merge/deploy ainda.
- Próximo: auditar readiness Google/YouTube no Railway + efetividade das credenciais, depois gate integral e revisão do diff por domínio.


### ASTRA — Business e revisão do motor Sol — 07/10/2026 13:46 Bahia
Business +5571993978956 centralizado, persistido e editável em todos os modos do painel; propagação sem hardcode no frontend. Troca de identidade de remetente exige confirmação de correspondência na Meta, sem alterar telefones dos Owners. Campo/ajuda/edição/reload/wa.me validados E2E desktop/mobile; captura business-numero-mobile.png inspecionada. Intro sem montagem de imagem/carrossel. Botão de contato na solicitação resolve número do servidor a cada 10 s e ao recuperar foco.
Antes da revisão do watch: API 103/103, client 10/10, lint/build GREEN, E2E 3/3 GREEN. Dois REDs adicionais foram reproduzidos por ASTRA no motor Sol: (1) 100% legado provocava finalização automática na primeira observação, (2) intervalo após amostra pausada podia ser creditado. Correção aplicada: estado anterior active persistido, cobertura de intervalos dos dez vídeos para conclusão, percentuais sem arredondar antecipadamente para 100 e UI deixa de somar reprodução local repetida. Os 6 testes watch-time passaram após correção; acrescentada cobertura do encerramento natural. Novo gate em andamento. Nenhum commit/push/merge/deploy.


### Checkpoint ASTRA — 07/10/2026 13:51 Bahia
- Nova regra Business e visual do usuário incorporada. API 106/106 + cliente 10/10, lint e build GREEN após revisão ASTRA dos dois REDs adicionais no motor Sol. Gate E2E final em conferência; execução PID 287244. Build mantém aviso de bundle ~566 kB (não bloqueante).
- Pendente de produto/infra: credenciais oficiais Meta e Google não fabricadas; não confundir número Business existente com Cloud API configurada. Todas as alterações ainda locais, sem deploy.
- Auditoria histórica não encontrou runtime Python IFtp/IFTP nas duas árvores/reflogs/objetos examinados; update-watch.py é gerador JSX, não runtime. Próximo bloco será companion novo, identificado como nova implementação, opt-in, captura apenas região escolhida, sem enviar imagens, com autorização revogável e sinais complementares ao motor web. OCR não provará atenção humana nem autorizará moedas sozinho.
- Preflight do Inspiron: tkinter/Pillow/OpenCV disponíveis; tesseract e xvfb ausentes. Ainda não foi instalado nada neste bloco nem criado companion. Não alegar recuperação de runtime histórico.
