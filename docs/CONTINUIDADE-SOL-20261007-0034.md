# CONTINUIDADE SOL — SOS YOUTUBER

Data local: 07/10/2026 ~00:34 BRT
Estado: WIP local não commitado / não publicado.

## Fonte de verdade
1. Regra explícita mais recente do usuário.
2. Filesystem/Git real do projeto canônico.
3. Testes e screenshots frescos do WIP.
4. GitHub remoto.
5. Railway publicado/configuração operacional.
6. Documentação antiga apenas como histórico.

NÃO resetar, NÃO clean, NÃO stash, NÃO descartar WIP rastreado ou não rastreado.

## Projeto canônico
- Diretório: ~/Documents/Codex/2026-10-04/gostar/YouTube Final
- Branch: sol/user-premium-20261006
- HEAD: c0b817218c7ca7771b749b57168030decc5fe54a
- origin/main: c0b817218c7ca7771b749b57168030decc5fe54a
- GitHub: Fabiomtt2/sosyt
- O WIP posterior a c0b8172 está na working tree; não reconstruir do zero.

## Árvore histórica
- ~/Documents/Codex/2026-10-04/gostar/Conexão Youtube
- main @ 0f09c7b0ec618ff0380dcf2b79c7914283f47487
- Auditoria comparativa: árvore anterior/truncada.
- Não há módulo de produto relevante exclusivo nela que seja superior e esteja faltando no YouTube Final.
- Usar como histórico/read-only; não fazer merge bidirecional automático.

## GitHub
Branches observadas:
- main @ c0b8172
- sol/owner-control-plane-20261006 @ 65d5b2c
- sol/whatsapp-modes-evolution-20261006-recovered @ 02f3e4b

c0b8172 é checkpoint documental posterior a 65d5b2c; a diferença 65d5b2c..c0b8172 não altera código executável.

## Railway production
Projeto: SOS YouTuber
Environment: production

Web:
- sos-youtuber-web
- online, 1/1
- deploy ativo SUCCESS
- commit executado 65d5b2c

API:
- sos-youtuber-api
- online, 1/1
- deploy ativo SUCCESS
- volume persistente
- commit executado 65d5b2c

O WIP local não está publicado. Não deployar working tree sujo.

## Gate conhecido
Antes dos dois últimos ajustes CSS de acabamento:
- npm test: API 73/73 + cliente 10/10 = 83/83 GREEN
- git diff --check: GREEN
- npm run lint: GREEN
- npm run build: GREEN
- npm run test:e2e -w @conexao/client: 1/1 GREEN (~1.1 min)

Depois do último E2E foram feitos apenas:
1. CSS de .admin-participant-note;
2. CSS de .phone-incremental-filter.

Rerodar gate completo antes de commit.

## Correções já aplicadas

### Owner / sessão
- Fábio e Rafael = ROOT_OWNER completos.
- ADMIN_OWNER adicional restrito.
- retorno participante administrativo -> Owner reemite/renova sessão Owner;
- logout de participante e logout Owner encerram somente a sessão correspondente;
- evita retorno indevido ao cooldown de 120 min.

### Grupo / fila
- DB local auditado: fila atual canônica era sequence=1; não havia fila 12.
- “Fila 12” tratado como bug de apresentação/estado.
- UI separa Grupo de Fila.
- conta administrativa mostra Owner principal · Fila atual 1.
- não exibir grupo artificial # como se fosse grupo do participante.

### Grupo automático
Motor real:
- resolveGroupForPhone()
- group_memberships
- whatsapp_member_verifications quando integração externa está configurada.

Importante: identificação automática pode ser vínculo aprovado pelo Owner no banco; não significa necessariamente prova em tempo real de presença no WhatsApp sem integração externa.
Texto do login foi corrigido para refletir isso.

### DDI / DDD / WhatsApp
PhoneField.tsx continua canônico.
Brasil: +55 | DDD | número.
Auditoria fresca:
- DDI sem input de busca extra;
- digitar 55 filtra Brasil sem selecionar automaticamente;
- DDD: 67 opções totais, 15 visíveis por página = 5 colunas x 3 linhas;
- digitar 71 deixa 71 BA;
- sem overflow;
- foco vermelho removido no componente telefônico;
- filtro DDI estilizado como chip.

Evidências temporárias:
- .local-tmp/audit-ddi-fresh.png
- .local-tmp/audit-ddd-unfiltered-fresh.png
- .local-tmp/audit-ddd-fresh.png

### Avatar / badge
- avatar da barra circular;
- clique no círculo abre seletor simples;
- nome/menu abre conta;
- badge ADMIN/OWNER dourado na borda inferior;
- wrappers quadrados neutralizados.

Evidências:
- docs/evidencias/participante-admin-desktop.png
- docs/evidencias/participante-admin-conta-desktop.png
- docs/evidencias/participante-inicio-desktop.png
- docs/evidencias/participante-avatar-desktop.png

### YouTube URL validation
Fallback oEmbed sem API key tinha timeout de 8 s; WIP reduziu para 2,5 s mantendo parser, validação e fallback.

## Loja / Hero — RED visual
Preservar:
- apps/client/public/assets/user/avatars.webp
- coins.webp
- hero.webp
- pass.webp
- watch.webp

Biblioteca recuperada contém artes aprovadas:
- bolsa de moedas limpa;
- ticket/passe limpo;
- hero comunitário;
- hero crescimento.

Componentes esperam:
- coins-bag.webp
- pass-ticket.webp
- hero-community.webp
- hero-growth.webp

Estado:
- Loja funcional, mas ainda RED por aparência de cartaz dentro do card;
- hero precisa das duas cenas adicionais;
- preservar hero.webp como slide final;
- não gerar substitutos antes de usar artes aprovadas.

## Python Astra / terceiro-olho
Recuperação ampla foi feita em filesystem, Git, objetos órfãos, temporários, backups, pyc, shell history, Desktop Commander e árvores históricas.

Resultado:
- único .py do SOS localizado: .local-tmp/update-watch.py, gerador/editor de JSX, não runtime;
- proposta histórica do “terceiro-olho” Python existe como ideia;
- nenhum runtime Python físico com 5+ funções / IFtp foi recuperado;
- NÃO inventar novo Python sem ordem explícita.

Runtime real atual:
WatchProgress.tsx + YouTube IFrame Player API + API/DB/ledger server-side.

## Pendências antes de commit
P0:
1. integrar e validar assets aprovados de Loja + Hero;
2. git diff --check;
3. npm test;
4. npm run lint;
5. npm run build;
6. npm run test:e2e -w @conexao/client;
7. screenshots frescos desktop/mobile;
8. inspeção visual real.

P1 docs:
- atualizar docs/ANCHOR-YOUTUBE-FINAL.md
- atualizar PROJECT_STATUS.md
- revisar README.md
- docs antigos têm regras antigas de grupo/Owners/pacote; não reintroduzir código velho para “combinar”.

P1 UX:
- Owner “Grupos e acesso” continua denso apesar de funcional;
- Loja ainda parece cartaz/arte dentro de card;
- hero precisa carrossel real com três cenas aprovadas.

## Merge / deploy
Não commitar/pushar/mergir/deployar antes do gate completo + visual.
Sequência:
1. fechar assets/visual;
2. gate completo;
3. atualizar docs;
4. revisar status/diff;
5. pequenos commits lógicos;
6. push branch;
7. revisar diff contra origin/main;
8. merge seguro;
9. confirmar local main == GitHub main;
10. Railway Web + API;
11. healthcheck;
12. smoke público;
13. novo checkpoint de continuidade.

## Heartbeats
Durante tarefas longas, sempre emitir heartbeat em cada marco relevante.
Evitar buscas amplas em HOME/node_modules/SDK.

## Atualização ~00:45–00:50 BRT — staging concorrente detectado

Foi detectada edição concorrente real na mesma branch:
- às 00:43:43 outra instância executou `git add -u` e adicionou explicitamente componentes/assets/evidências;
- NÃO houve `git commit`;
- NÃO houve `git push`;
- o histórico recente do Desktop Commander não mostrou novas escritas após ~00:44:59 no momento desta checagem.

Regra: NÃO resetar, NÃO unstaging, NÃO stash e NÃO commitar esse index às cegas.

Estado conceitual:
- index/staged contém o checkpoint premium amplo (source + evidências + AGENTS/ANCHOR/CONTINUIDADE-CANONICA);
- `PROJECT_STATUS.md` e `README.md` receberam correções canônicas depois do staging e permanecem unstaged;
- `apps/client/public/assets/user/coins-bag.webp` continua untracked e não deve ser promovido sem validação;
- este arquivo `CONTINUIDADE-SOL-20261007-0034.md` continua untracked.

Correções documentais aplicadas após o staging:
- Fábio/Fabio + Rafael = ROOT_OWNER;
- ADMIN_OWNER adicional = restrito;
- login normal = nome + WhatsApp, grupo resolvido server-side;
- COINS_LAUNCH = R$20 -> 10 moedas + 1 passe bônus;
- PASS_SINGLE = R$20 -> 1 passe, 0 moedas;
- gate atual = 73/73 API + 10/10 cliente + diff-check + lint + build + E2E 1/1.

Gate completo do estado funcional atual:
- git diff --check GREEN;
- npm test 83/83 GREEN;
- npm run lint GREEN;
- npm run build GREEN;
- npm run test:e2e -w @conexao/client GREEN 1/1.

Bloqueio restante para merge/main/deploy:
- Loja/Hero ainda RED visual por assets aprovados não totalmente integrados.
- Não fazer merge/main/Railway antes de fechar esse RED e repetir screenshots/gate.
