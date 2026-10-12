# Auditoria e convergência ASTRA — 08/10/2026

## Base e preservação

Reancoragem no Inspiron, árvore canônica YouTube Final, branch sol/user-premium-20261006, base c0b817218c7ca7771b749b57168030decc5fe54a. Fetch e consulta direta ao GitHub confirmaram main nessa base. A árvore histórica Conexão Youtube permaneceu somente leitura. Não houve reset, clean, stash, descarte de untracked ou reescrita de histórico.

Snapshots preservados em .local-tmp: astra-entry-20261007T053809Z, astra-business-entry-20261007T162833Z e astra-resume-20261008T051635Z. O último contém 114 arquivos do WIP, patches staged/unstaged, inventário e hashes. A revisão usa o estado completo do filesystem, não só o index herdado.

As implementações de Sol/Claude recebidas no WIP foram preservadas e confrontadas com código/testes. A história existente mantém seus autores; os commits desta consolidação registram a revisão conjunta sem atribuir identidades inventadas a coautores. A pilha de commits é uma unidade integrada de validação; commits intermediários não são candidatos individuais a deploy.

## Correções e entregas

| Área | Evidência / comportamento atual |
| --- | --- |
| Identidade | Chave de seis dígitos, cinco minutos, uso único, limite de tentativas e reenvio. Registro confirmado segue para aprovação; login posterior mantém a mesma conta e carteira. |
| Google | Alternativa de login com state/nonce/PKCE e resultado vinculado ao navegador. Não associa uma conta antiga só porque alguém digitou seu telefone. Owner decide associação. OAuth do canal é separado. |
| Privilégios | Fábio e Rafael ROOT_OWNER. Corrigida elevação administrativa por simples nome/telefone; sessão administrativa vinculada à versão da credencial/permissão e ao telefone atual. |
| Business | +5571993978956 como seed público aprovado; edição central e persistente; troca da identidade do remetente exige nova conferência Meta. Avisos OTP/Google leem templates salvos no painel. |
| Bot | Aprovação orienta chave WhatsApp ou Google vinculado. Alertas consideram pedidos e associações Google pendentes. Outbox com deduplicação local, lease e retentativa, sem alegar exactly-once externo. |
| Fila/carteira | Slots 1–10, autoria e URL preservadas; transação de contribuição e passes; proteção contra fila alterada durante consulta externa; crédito de curadoria condicionado à inserção no ledger. |
| Tempo | WATCH_TIME por 20 minutos acumulados, relógio do servidor, intervalos únicos, sessão concorrente bloqueada. Pausa/retomada e percentual legado não fabricam recompensas/conclusão. Perfil e detalhe Owner usam o mesmo total. |
| Companion | Python real novo, não IFtp recuperado. Tkinter, região opt-in, OCR local; só último metadado no servidor. Pareamento de cinco minutos, token restrito revogável/expirável, antirreplay. Não controla player nem escreve ledger. |
| Player | Corrigida chamada a métodos YouTube antes de sua disponibilidade. Nenhuma garantia de atenção humana ou de contagem de views é apresentada. |
| Avatar e canal | CORS permite PUT; E2E seleciona e reabre avatar. Canal conectado do participante é distinto do publicador do vídeo. |
| Loja | Ilustrações editoriais transparentes novas, sem preços/textos embutidos. Corrigido transbordamento da imagem sobre texto; geometria protegida pelo E2E e inspeção visual. |
| Modais | Lifecycle central com bloqueio do body, foco, Tab/Shift+Tab, Escape só no diálogo superior e retorno ao acionador. Confirmações críticas protegidas. |
| Visual | Intro sem carrossel/background ilustrado. Dashboard com banners informativos, pausa e respeito a reduced-motion. Badge ADMIN inteiro no cartão; texto interno SOS YOUTUBER # substituído por participação administrativa. |

## Validação

Gate de .local-tmp/gate-20261008T051656Z: 111 testes API, dez cliente, lint, build, três E2E GREEN. Correção dos templates: 112 testes API GREEN. Gate posterior .local-tmp/gate-final-20261008T052951Z também integralmente GREEN.

A captura do badge desse segundo gate permitiu ver o marcador interno #, não detectado pela geometria. Corrigidos o cartão e o detalhe administrativo; o gate final atualizado está GREEN em .local-tmp/gate-reviewed-20261008T053328Z/results.json (112 API, dez cliente, lint, build e três E2E). Não usar apenas screenshot antiga ou elemento presente como prova visual.

Cinco testes Python passaram: parsing/sinais/cliente, Tesseract real e Tkinter/captura real em Xvfb isolado. Ferramentas extraídas dentro de .local-tmp/companion-tools; nenhuma instalação global. A imagem capturada nos testes é uma fixture sintética, não o desktop pessoal. O E2E executa o cliente HTTP Python real contra a API de teste e verifica revogação. Google/YouTube e Pix externos usam respostas controladas nos testes.

Uma conferência dos valores sensíveis locais contra arquivos destinados ao Git encontrou um telefone Owner em fixture antiga de PhoneField. A fixture foi substituída por números sintéticos e os dez testes do cliente passaram. Isso não reescreve o histórico anterior.

Evidências desktop/mobile em docs/evidencias, incluindo loja, Business editável, chave de acesso, avatar, fila administrativa, banners e companion. O build conserva um aviso de tamanho de chunk; não houve erro de build.

## Produção e impedimentos objetivos

Railway mantém API/Web SUCCESS, fonte fixada em 65d5b2c, sem redeploy nesta rodada. API com volume persistente /data; health público respondeu 200 em 08/10. Google Client ID/Secret não apareciam nas variáveis do serviço. Isso não diz se Meta/Pix estão configurados no banco: a leitura autenticada das configurações de produção não foi possível com as credenciais Owner locais (401).

Um telefone WhatsApp Business, sozinho, não habilita Cloud API nem templates. A publicação do login com prova obrigatória depende de um provedor real operacional, para não deixar participantes sem acesso. Não ativar modo DEV na produção como contorno.

O workflow Pages publica automaticamente em push de main. Por isso a convergência desta rodada termina na branch revisada/PR enquanto a prontidão externa não for confirmada. Merge e deploy são coordenados depois, sem atualizar só o frontend. O Railway está preso ao SHA antigo; antes da publicação será preciso apontar a fonte para o commit aprovado, revisar as mudanças pendentes e verificar health/volume/smoke público.

## Limites que permanecem explícitos

- OCR/player são sinais de reprodução, não prova de atenção humana. Companion desktop tem instalação manual, dependências e limitações de monitor principal/Wayland.
- Groups API depende da elegibilidade real da conta/grupo. Aprovação manual não é verificação externa em tempo real. O catálogo herdado suporta 1–999; operação solicitada usa 1–99, sem zero.
- Transporte Evolution não foi implementado nesta rodada; sua configuração existente não deve aparecer como integração ativa sem teste próprio.
- YouTube OAuth/exportação e Pix precisam de homologação real; não foram criadas credenciais ou pagamentos reais. Reconciliação operacional e estornos permanecem no backlog anterior.
- Privacidade/retenção e operação de produção ainda exigem fechamento antes de abertura pública ampla. Exclusão local de perfil não significa eliminação de todos os registros financeiros/históricos.

Próxima instância: ler o topo de NEXT-INSTANCE-MANDATORY.md para hashes, resultado final, PR e ponto exato. Não reconstruir motores já presentes nem sobrescrever a árvore com a versão histórica.

## Commits temáticos da consolidação

- `2767170e` — feat(core): persist participant profiles and owner access roles
- `ec064d50` — feat(auth): add verified Google identity and phone security coverage
- `4a0dc087` — feat(companion): add optional local OCR observations and time reward views
- `0145ede2` — fix(integrations): centralize Business settings and settlement products
- `b3ef2d7e` — feat(owner): expose guarded administration and participant channel details
- `d9b97785` — fix(api): integrate verified access and transactional queue rewards
- `d098f50b` — feat(client): add identity choices and shared modal lifecycle
- `63251c11` — feat(owner-ui): connect team and participant administration
- `59787f8d` — feat(participant): add persistent avatars account and store flows
- `de309fef` — feat(web): integrate watch companion and informative visual experience
- `ba1ce1ab` — test(e2e): exercise Business identity companion and visual regressions

Hashes do código/evidências comparados com o snapshot pré-commit: todos iguais. Nenhum valor sensível local foi encontrado nos arquivos finais destinados à branch; esta conferência não constitui expurgo do histórico antigo.

## Publicação da branch

PR em rascunho: https://github.com/Fabiomtt2/sosyt/pull/1. A branch foi publicada, sem merge em main. GitHub informou ausência de conflitos; não há checks CI configurados nessa branch, então GREEN aqui se refere ao gate local persistido. A comparação completa contra main encontrou uma linha em branco extra no fim de watch-rewards.ts, removida sem alteração de comportamento. Railway reconfirmado em 08/10: API e Web SUCCESS/1 réplica, sem ocorrências ou mudanças pendentes; nenhum deploy disparado.
