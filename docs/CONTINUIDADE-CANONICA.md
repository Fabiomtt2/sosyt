# CONTINUIDADE CANÔNICA — SOS YouTuber

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


> Atualizado em **07/10/2026 ~00:34 BRT** após reancoragem cruzada por Desktop Commander, Git local, GitHub e Railway.
> Este arquivo é o primeiro handoff a ler quando uma instância perder contexto. Ele registra estado operacional; não autoriza descartar WIP.

## 0. Regra de segurança

- **NÃO** executar `git reset`, `git clean`, `git stash`, checkout destrutivo ou descarte de arquivos.
- **NÃO** copiar a árvore histórica `Conexão Youtube` por cima da canônica.
- **NÃO** assumir que `main` contém a rodada mais nova: em 07/10 o avanço premium está na working tree.
- Preservar evidências, assets, banco SQLite e todos os arquivos não rastreados relevantes.
- Antes de alterar regra de produto, cruzar este arquivo, `AGENTS.md`, `docs/ANCHOR-YOUTUBE-FINAL.md`, testes e Git real.

## 1. Árvore canônica e Git

Árvore canônica no Inspiron:

```text
~/Documents/Codex/2026-10-04/gostar/YouTube Final
```

Estado confirmado:

```text
branch: sol/user-premium-20261006
HEAD:   c0b817218c7ca7771b749b57168030decc5fe54a
short:  c0b8172
origin/main: c0b8172
ahead/behind HEAD...origin/main: 0 / 0
remote: https://github.com/Fabiomtt2/sosyt.git
```

Últimos checkpoints publicados:

1. `c0b8172` — docs: record owner control plane production checkpoint
2. `65d5b2c` — feat: make owner control plane operational
3. `02f3e4b` — feat: recover owner integrations and evolution mode
4. `45ce984` — test: refresh owner layout evidence
5. `6f73d61` — fix: stabilize owner integration layout

**Importante:** `sol/user-premium-20261006` ainda aponta para `c0b8172`. A rodada premium/participante/Owner posterior está **não commitada**.

## 2. WIP local que NÃO pode ser perdido

Em 07/10 a working tree contém aproximadamente **2.382 inserções / 423 remoções**, além de binários/evidências.

Áreas alteradas:
- API: auth/login, grupo, DB, Owner/admin, pagamentos, WhatsApp, YouTube/progresso e regressões.
- Cliente: `App.tsx`, `OwnerDashboard.tsx`, `PhoneField.tsx`, `WatchProgress.tsx`, API client e CSS.
- E2E: fluxo único grande cobrindo participante, Owner, loja, fila, playlist e administração.
- Novos componentes ainda untracked: `AvatarModal.tsx`, `OwnerDeskMenu.tsx`, `OwnerTeamModal.tsx`, `ProfilePhotoActions.tsx`, `PurchaseModal.tsx`, `StoreModal.tsx`, `UserAccountMenu.tsx`, `UserWallet.tsx`, `UserWelcomeCarousel.tsx`.
- Novas evidências de participante/admin/loja/avatar ainda untracked.

Não tentar “recriar” esses módulos a partir do GitHub; primeiro ler a working tree.

## 3. Árvore histórica auditada

`~/Documents/Codex/2026-10-04/gostar/Conexão Youtube` foi comparada com a canônica.

Resultado:
- `YouTube Final` é o superset funcional.
- Não foi encontrado módulo de produto exclusivo no antigo que justifique merge bidirecional.
- Exclusivos antigos relevantes eram basicamente caches/SDK e artefatos Vite gerados (`vite.config.js/.d.ts`), que **não devem ser convergidos**.
- Manter a árvore antiga somente como histórico/read-only.

## 4. GitHub

Repositório canônico: `Fabiomtt2/sosyt`.

Conector GitHub confirmou `main @ c0b8172` em 07/10/2026.
O Git local, após `git fetch --all --prune`, confirmou o mesmo SHA.

Consequência: GitHub não contém ainda a rodada premium atual. Não usar o GitHub como fonte única para “corrigir” o WIP.

## 5. Railway produção

Projeto: `SOS YouTuber`
Environment: `production`

Serviços:
- Web: `sos-youtuber-web` — Online/SUCCESS, 1/1 réplica.
- API: `sos-youtuber-api` — Online/SUCCESS, 1/1 réplica, volume persistente montado em `/data`.
- Sem staged/pending work.

Código atualmente executado por ambos:
```text
65d5b2c37aed321fee5ec8c6c028b51f7f77dba9
feat: make owner control plane operational
```

`c0b8172` é somente documentação, por isso Railway permanecer em `65d5b2c` é coerente.

A falha Web antiga de 06/10 14:11 é histórica; o deploy ativo posterior está SUCCESS.

**Não redeployar Railway antes de validar e commitar o WIP atual.**

## 6. Último gate conhecido

Gate completo reexecutado em **07/10/2026 ~00:43 BRT**, já incluindo os dois polimentos CSS mais recentes e este estado de WIP:

- `git diff --check`: **GREEN**.
- `npm test`: **83/83 GREEN** — API 73/73 + cliente 10/10.
- `npm run lint`: **GREEN** — API + cliente.
- `npm run build`: **GREEN** — API + React/PWA.
- E2E Playwright: **1/1 GREEN** — fluxo completo em 41,5 s.
- Build mantém apenas warning não bloqueante de chunk principal ~550 kB.

Auditoria Playwright dirigida também confirmou:
- DDI sem input de busca extra;
- digitar `55` filtra Brasil sem selecionar automaticamente;
- DDD total: 67;
- DDD visíveis por página: **15 = 5 colunas × 3 linhas**;
- sem overflow;
- filtro `71` retorna apenas `71 BA`.

Esse gate autoriza criar **checkpoint na branch premium**, mas não autoriza merge em `main` nem deploy Railway enquanto o RED visual de assets da Loja/carrossel permanecer aberto.

## 7. Regressões já cobertas no E2E

O E2E atual já cobre, entre outras:
- Owner → modo participante administrativo → voltar ao painel Owner sem cair na proteção de 120 min;
- badge `ADMIN` no participante e `OWNER` no painel;
- `FILA 1` separada de grupo; não reproduzir bug visual “Fila 12”;
- avatar circular, inclusive Owner/Admin com badge inferior;
- login sem campo manual de grupo no fluxo normal;
- loja, Pix demo, segunda URL após compra;
- fila completa, criação de playlist e acompanhamento;
- OAuth YouTube mockado no contrato da UI.

## 8. Assets — RED visual ainda aberto

Diretório:
`apps/client/public/assets/user/`

Presentes e devem ser preservados:
- `avatars.webp` — 40.894 bytes
- `coins.webp` — 28.292 bytes
- `hero.webp` — 51.544 bytes
- `pass.webp` — 25.872 bytes
- `watch.webp` — 29.140 bytes

Estado incompleto:
- `coins-bag.webp` existe com apenas **6.144 bytes** e é suspeito; em inspeção anterior não abriu como imagem válida.
- `UserWelcomeCarousel.tsx` referencia `/assets/user/hero-community.webp` e `/assets/user/hero-growth.webp`, mas esses arquivos ainda não existem localmente.
- A Loja ainda usa os pôsteres retangulares `coins.webp` e `pass.webp`; visualmente ainda não foi fechada.

As quatro artes aprovadas foram recuperadas da Biblioteca do ChatGPT no turno anterior, mas **a transferência binária validada para o Inspiron não foi concluída** antes da interrupção.

Regra para retomar:
1. não substituir os cinco assets válidos acima;
2. transferir novas artes primeiro para `.local-tmp`;
3. validar tipo, dimensões e SHA-256;
4. converter para WebP se necessário;
5. mover atomicamente somente após validação;
6. repetir screenshots da Loja/carrossel e o gate.

## 9. Evidência visual fresca

Capturas E2E de 07/10 confirmaram:
- avatar de participante circular;
- avatar Owner/Admin circular + badge dourado inferior;
- conta administrativa mostra “Owner principal · Fila atual 1”, sem grupo `#`;
- `FILA 1` aparece corretamente;
- DDI/DDD sem moldura vermelha;
- DDD 5×3 sem overflow;
- Loja ainda é RED visual pelos assets pendentes.

## 10. Próxima sequência segura

Ao retomar:

```bash
cd ~/Documents/Codex/2026-10-04/gostar/'YouTube Final'
git fetch --all --prune
git status --short --branch
git log -1 --decorate --oneline
git diff --check
```

Depois:
1. confirmar que HEAD continua `c0b8172` e branch `sol/user-premium-20261006`;
2. NÃO descartar o WIP;
3. terminar assets pendentes;
4. auditar screenshots Loja/carrossel;
5. rodar `git diff --check && npm test && npm run lint && npm run build && npm run test:e2e -w @conexao/client`;
6. revisar `git diff` por domínio;
7. criar commits pequenos/temáticos;
8. só depois decidir push/merge para GitHub e redeploy Railway;
9. atualizar este arquivo no mesmo checkpoint.

## 11. Handoff complementar e staging local

Também existe `docs/CONTINUIDADE-SOL-20261007-0034.md`, criado na mesma janela de recuperação. Ele é coerente com este canônico e preserva detalhes adicionais sobre auditoria Python/“terceiro-olho”, timeout YouTube e pendências visuais. **Não o apagar.** Em caso de divergência futura, este `CONTINUIDADE-CANONICA.md` + Git/testes reais prevalecem.

Após o gate GREEN de 07/10, foi feito **somente staging local** para proteger o WIP. Não houve commit/push/merge/deploy. O staging deliberadamente exclui o `coins-bag.webp` suspeito e ainda aguarda os quatro assets aprovados finais da Loja/Hero.

`README.md` e `PROJECT_STATUS.md` receberam atualização concorrente válida para refletir ROOT_OWNER, login sem grupo manual, produtos atuais e gate 73+10; preservar essas mudanças.

## 12. Heartbeat obrigatório

Durante trabalho prolongado:
- enviar heartbeat a cada marco importante;
- nunca ficar vários minutos em “pensando” sem explicar processo vivo;
- se um processo ficar silencioso, verificar PID/sessão antes de assumir travamento;
- registrar neste arquivo qualquer novo checkpoint, commit, deploy ou RED relevante antes de encerrar a instância.

## 13. Estado de saída desta reancoragem

Ao encerrar a rodada de reancoragem:
- branch continua `sol/user-premium-20261006`;
- HEAD e `origin/main` continuam `c0b8172`;
- não houve commit, push, merge ou deploy;
- código/docs/evidências validados estão organizados no **staging local**;
- não há tracked changes fora do staging;
- `git diff --cached --check` e `git diff --check` estão GREEN;
- único untracked: `apps/client/public/assets/user/coins-bag.webp`, suspeito e propositalmente não promovido;
- P0 seguinte: integrar `coins-bag.webp`, `pass-ticket.webp`, `hero-community.webp` e `hero-growth.webp` a partir das artes aprovadas, validar hash/tipo, refazer screenshots Loja/carrossel e só então novo gate/commit.

## 14. Reancoragem + handoff obrigatório — 07/10/2026

Foi criado `docs/NEXT-INSTANCE-MANDATORY.md`. Toda nova instância deve lê-lo antes de editar o projeto e cruzar seu conteúdo com Desktop Commander, Git local, GitHub `Fabiomtt2/sosyt` e Railway `SOS YouTuber`.

Checkpoint desta rodada:
- local `sol/user-premium-20261006 @ c0b8172`; GitHub main também `c0b8172`;
- Railway production online em `65d5b2c` para API/WEB, sem staged changes;
- motor de canal administrativo/participante implementado e coberto por teste API;
- API 74/74 e lint/TypeScript GREEN;
- bug visual “Fila 12 de 10” identificado como concatenação de Fila 1 + 2/10 e layout separado;
- E2E agora exige clique/persistência real de avatar 17, mas precisa ser executado após as mudanças recentes;
- badge ADMIN da fila recebeu correção estrutural para reservar espaço, ainda aguardando gate visual/E2E;
- assets finais continuam pendentes; `coins-bag.webp` segue suspeito apesar de `file` reconhecer RIFF/WebP porque o decoder PIL local falhou.

### Validação navegador — 07/10/2026

CORS explicitou GET/HEAD/POST/PUT/PATCH/DELETE/OPTIONS. Isso corrigiu a seleção de avatar no localhost, que falhava no preflight de `PUT /profile/avatar`. Novo teste de preflight protege a regressão. Gate parcial após a correção: API 75/75, lint/TypeScript GREEN e Playwright E2E 1/1 GREEN. O E2E agora prova avatar 17 persistente, Fila/progresso separados e badge ADMIN integral em submissão real da Fila 2.


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

## 15. Auditoria independente de motor — Sol — 07/10/2026 ~09:45 Bahia
Foi criado snapshot pré-edição `.local-tmp/sol-motor-entry-*` e relatório `docs/AUDITORIA-SOL-MOTOR-20261007.md`.
P0 watch-progress está em migração controlada:
- servidor novo já usa observações limitadas pelo relógio server-side;
- deduplica trechos e bloqueia sessão concorrente;
- tempo válido acumula globalmente e 1200 s geram 1 moeda via `WATCH_TIME`;
- histórico `WATCH_PROGRESS` permanece intacto;
- API 93/93 GREEN, incluindo 4 testes adversariais novos;
- cliente ainda precisa ser migrado antes de fechar/desativar o protocolo legado.

## 16. Motor de recompensa por tempo — GREEN — 07/10/2026 ~09:58 Bahia
Sol concluiu a migração P0 de acompanhamento: percentual permanece métrica de jornada, não fonte de recompensa; observações server-time substituem vetores premiáveis do cliente; há dedupe de trechos, trava de sessão concorrente e limitação pelo relógio do servidor. O acumulador global está em `watch_time_totals`, o estado ativo em `watch_observation_state`, e 1 moeda/1200 s usa ledger `WATCH_TIME`. `WATCH_PROGRESS` histórico permanece intacto. A rota antiga não concede novas moedas. Gate: API 93/93, cliente 10/10, lint, build, diff-check e E2E 2/2 GREEN.

## 17. Curadoria idempotente — GREEN — 07/10/2026 ~10:04 Bahia
Fechamento da fila agora condiciona o aumento da carteira à criação efetiva do ledger `CURATION_REWARD`. Regressão específica prova que ledger pré-existente não duplica saldo. API 94/94 GREEN e diff-check GREEN.

## 18. Segurança de identidade — GREEN — 07/10/2026 ~10:14 Bahia
Rota legada `/participation/request` foi restrita a `AUTH_DEV_MODE`; produção exige a prova WhatsApp/Google do fluxo novo. `ALREADY_REGISTERED` não expõe mais `groupCode`. Revogação de ADMIN_OWNER ganhou regressão explícita e invalida imediatamente tokens/reelevação. API 95/95 GREEN.

## 16. RED E2E pós-migração watch-time — 07/10/2026 12:05 Bahia
Build production GREEN. Playwright: phone-key GREEN; community RED somente porque o teste ainda esperava a microcopy antiga `0% · +0 moedas`. A UI/motor novos não vinculam moeda ao percentual. Corrigir expectativa e rerodar o E2E completo antes de qualquer commit.

## 17. Playwright pós-watch-time — 07/10/2026 12:07 Bahia
E2E completo reexecutado após migração do protocolo de acompanhamento: **2/2 GREEN**. Community e phone-key passaram. Próximo gate: diff-check + todos os testes + lint + build + E2E numa única sequência.

### Watch-time integrado ao cliente — Sol — 07/10/2026 ~12:07 Bahia
A migração P0 agora cobre servidor e cliente. O navegador envia observações pequenas; servidor limita pelo relógio, deduplica trechos e controla sessão concorrente. UI separa percentual de progresso da recompensa por tempo. Reabertura na mesma aba reutiliza o identificador da sessão. Playwright completo 2/2 GREEN. Ainda executar gate completo novamente antes de commit/merge.

## 18. Gate integral pós-migração watch-time — 07/10/2026 12:11 Bahia
GREEN completo: diff-check; API 96/96; client 10/10; lint; build; E2E 2/2. Total 106 testes + 2 E2E. Reward novo somente via `WATCH_TIME`, 1 moeda a cada 1200 s verificados pelo protocolo de observação server-time. Histórico `WATCH_PROGRESS` preservado.

### Gate completo pós-watch-time — 07/10/2026 ~12:13 Bahia
GREEN integral: API 96/96, cliente 10/10, lint, build e Playwright 2/2. Nenhum deploy/merge nesta etapa. Próximo P0/P1: confrontar motor WhatsApp, pagamentos e configuração Railway com o código atual sem revelar segredos nem prometer integração externa não configurada.

## 19. Concorrência fila/ledger — 07/10/2026 12:15 Bahia
Dois testes concorrentes adicionados e GREEN. API 98/98. Runtime atual serializa submissões corretamente, reverte perdedor e não duplica ledger. P1 futuro: garantia de uma única fila OPEN ainda é de aplicação, não constraint de schema; não endurecer migration sem inspecionar DB persistente Railway.

## 20. Auditoria WhatsApp/outbox — 07/10/2026 12:20 Bahia
Outbox concorrente testado: um job único não é enviado duas vezes por dois flushes simultâneos. API 99/99 GREEN. Motor oficial é real/testado; .env local ainda não possui IDs/segredos/templates Meta Business específicos, portanto a entrega oficial real continua pendente de credencial/configuração.

## 21. Hardening legado + WhatsApp — 07/10/2026 12:24 Bahia
Protocolo legado de watch não consegue mais criar recompensa nem auto-finalização. 100% arbitrário permanece apenas como compatibilidade visual e não desbloqueia tarefa. Outbox concorrente provado com job único. API 99/99 GREEN.

### Auditoria externa — WhatsApp e pagamentos — 07/10/2026 ~12:34 Bahia
WhatsApp agora permite configuração persistente dos nomes/idioma dos templates Meta pelo painel ROOT_OWNER, além das credenciais já cifradas no SQLite. Business Phone persistido passa a alimentar o link público wa.me, com fallback Owner. OTP/outbox/sync já usam configuração efetiva do SQLite. API 99/99 GREEN nesta etapa; lint/build/E2E 2/2 haviam ficado GREEN após a mudança visual de templates. Pagamentos não apresentaram P0: settlement/ledger idempotentes e webhooks revalidam o provedor. Próximo motor externo: Google/YouTube production readiness.


### ASTRA — Business e revisão do motor Sol — 07/10/2026 13:46 Bahia
Business +5571993978956 centralizado, persistido e editável em todos os modos do painel; propagação sem hardcode no frontend. Troca de identidade de remetente exige confirmação de correspondência na Meta, sem alterar telefones dos Owners. Campo/ajuda/edição/reload/wa.me validados E2E desktop/mobile; captura business-numero-mobile.png inspecionada. Intro sem montagem de imagem/carrossel. Botão de contato na solicitação resolve número do servidor a cada 10 s e ao recuperar foco.
Antes da revisão do watch: API 103/103, client 10/10, lint/build GREEN, E2E 3/3 GREEN. Dois REDs adicionais foram reproduzidos por ASTRA no motor Sol: (1) 100% legado provocava finalização automática na primeira observação, (2) intervalo após amostra pausada podia ser creditado. Correção aplicada: estado anterior active persistido, cobertura de intervalos dos dez vídeos para conclusão, percentuais sem arredondar antecipadamente para 100 e UI deixa de somar reprodução local repetida. Os 6 testes watch-time passaram após correção; acrescentada cobertura do encerramento natural. Novo gate em andamento. Nenhum commit/push/merge/deploy.


### Checkpoint ASTRA — 07/10/2026 13:51 Bahia
- Nova regra Business e visual do usuário incorporada. API 106/106 + cliente 10/10, lint e build GREEN após revisão ASTRA dos dois REDs adicionais no motor Sol. Gate E2E final em conferência; execução PID 287244. Build mantém aviso de bundle ~566 kB (não bloqueante).
- Pendente de produto/infra: credenciais oficiais Meta e Google não fabricadas; não confundir número Business existente com Cloud API configurada. Todas as alterações ainda locais, sem deploy.
- Auditoria histórica não encontrou runtime Python IFtp/IFTP nas duas árvores/reflogs/objetos examinados; update-watch.py é gerador JSX, não runtime. Próximo bloco será companion novo, identificado como nova implementação, opt-in, captura apenas região escolhida, sem enviar imagens, com autorização revogável e sinais complementares ao motor web. OCR não provará atenção humana nem autorizará moedas sozinho.
- Preflight do Inspiron: tkinter/Pillow/OpenCV disponíveis; tesseract e xvfb ausentes. Ainda não foi instalado nada neste bloco nem criado companion. Não alegar recuperação de runtime histórico.
