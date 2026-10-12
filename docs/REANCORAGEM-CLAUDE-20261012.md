# Reancoragem ASTRA — trabalho Claude — 12/10/2026 UTC

Este é um mapa de descoberta e revisão inicial, não uma homologação integral. Proprietário do projeto: Fábio. As atribuições a agentes em documentos antigos descrevem autoria técnica.

## Fontes e estado confirmado

- Canonical: YouTube Final, sol/user-premium-20261006 @ 6d09b6f4b0d84bee8b82ec9c8e94f3bbc899ef01, com WIP anterior preservado.
- GitHub main @ c0b817218c7ca7771b749b57168030decc5fe54a. Confirmado por fetch e PR #1 aberto/DRAFT; head da PR ainda 6d09b6f. Nenhuma integração Claude na PR.
- Auditoria local: /home/ubuntu-desktop-bootstrap-ubuntu-/AUDITORIA-CLAUDE-SOSYT, branch auditoria @ ea21af422775ea04b28002a6763298fd219fda3d. Sem remotes configurados. Laudos 14–20 e várias evidências ainda untracked; preservar.
- Implementação Claude: /home/ubuntu-desktop-bootstrap-ubuntu-/AUDITORIA-CLAUDE-SOSYT/01-ESPELHO/trabalho, branch auditoria/correcoes-propostas @ 8a1962f34f59063205aa6f67203c15ffddd833b7. Sem remotes configurados.
- 6d09b6f é ancestral confirmado de 8a1962f: 27 commits adicionais, 56 arquivos alterados, 5749 inserções e 190 remoções. É uma continuação da base premium, não um projeto sem relação histórica.
- Arquivos não commitados no clone: apps/api/src/bot-automations.ts e bot-automations.test.ts. Não descartar, nem presumir publicados.

## Produção: o checkpoint de 08/10 está superado

Railway consultado diretamente nesta rodada:
- Web SUCCESS/Online, 1/1 réplica: 1bf687bd-4bd6-41f5-bd4d-b472fc6f4f6c, 10/10/2026 16:34 UTC.
- API SUCCESS/Online, 1/1 réplica: dddb1c3c-44b1-4ab6-be04-35b3a9b90de3, 10/10/2026 12:56 UTC.
- Zero ocorrências na janela padrão de 8h, nenhuma mudança staged/applying.
- Volume sos-youtuber-data permanece em /data, 500 MB.
- GET API /health e GET Web retornaram HTTP 200 sem autenticação ou mutação.
- A configuração source da API AINDA mostra Fabiomtt2/sosyt/main/65d5b2c. Isso NÃO identifica o conteúdo dos uploads manuais posteriores.
- Metadados dos deployments atuais não trazem commitHash. O SHA exato de cada artefato publicado ainda precisa de prova. Não declarar produção == 8a1962f.
- LAUDO-16 vincula os deployments anteriores (34124487 API / 9d9a0c0a Web, 09/10) a 01fe764, via upload. Os deployments de 10/10 já os substituíram.
- NÃO republicar a branch antiga nem fazer merge/deploy antes de mapear os artefatos atuais e convergir as alterações.

## Funcionalidades encontradas em código e commits

| Domínio | Implementação encontrada | Estado desta revisão |
| --- | --- | --- |
| Acesso | password.ts, password-auth, setup-code, admin-credentials, OwnerAccessPanel | Presente; revisar fluxo completo com Google/OTP/aprovação, sem assumir UI concluída |
| Filas | queues.ts, inventory.ts, QueueSwitcher, item Pular | Presente; confrontar novas regras com laudos/decisões |
| Loja | store.ts, OwnerStorePanel, produtos e preços configuráveis | Presente; defaults e migrações precisam revisão funcional |
| SUPER | super.ts, SuperPanel, assinatura/expiração/renovação | Presente; não confundir renovação interna com cobrança externa comprovada |
| Comunidade | global-chat.ts, mailbox.ts, GlobalChat, OwnerCommsPanel | Presente; guardas sensíveis corrigidas em dad2640 e commits posteriores |
| Avatar | avatar-tiers.ts, OwnerAvatarsPanel, seletor com tiers/molduras | Últimos dois commits; laudos anteriores não homologam automaticamente estes commits |
| Bot | bot.ts, OwnerBotPanel, number-health.ts | Configuração e diagnóstico; integração operacional incompleta identificada abaixo |
| Progresso | correções em app.ts + testes audit-regressions/m01-defesa | Revisar defesa contra duração/percentual forjados; não equivale a provar atenção humana |

## REDs / lacunas confirmadas por leitura

1. **Bot configurado não equivale a executando:** botMode/featureEnabled são usados dentro de bot.ts para calcular status, e owner.ts apenas consulta/salva o painel. Busca em apps/api/src não encontrou consumo desses controles pelo envio/webhook. whatsapp.ts executa outbox pela configuração efetiva de WhatsApp, sem consultar as flags do novo bot. Assim, não apresentar DISABLED/flags como interruptores operacionais homologados.
2. **Evolution:** no código rastreado, URL/instância/chave aparecem em armazenamento de integrações e cálculo de prontidão; nenhum transporte de envio Evolution foi localizado nessa revisão. botStatus pode marcar funções como active apenas pela presença de configuração. Requer implementação/integração e prova, não só credenciais.
3. **Automações em rascunho:** bot-automations.ts é catálogo puro de mensagens/placeholders. Único import encontrado: bot-automations.test.ts. Não há agendador/eventos/envio integrados nesse módulo ainda.
4. **Divergência Git x produção:** GitHub main e a PR não representam a produção posterior. Manter rastreabilidade dos uploads; não sobrescrever pelo checkpoint antigo.
5. **Validação visual parcial do Claude:** LAUDO-14 informa que screenshots de Acesso são previews estáticos aproximados. Não contam como prova visual do app integrado.

## Colisões com nosso WIP de 08/10

Arquivos alterados por ambos: App.tsx, OwnerDashboard.tsx, OwnerDeskMenu.tsx, PhoneField.tsx, styles.css. Integração deve preservar as correções úteis dos dois lados, não copiar árvores.

Nosso WIP inclui parsing/autofill de telefone, preservação de campos em erro, aprovação manual sem operação ROOT indevida, reorganização de integrações e textos honestos. Última execução registrada dele: cliente 17 testes e lint verdes, E2E 2/4 (não homologado). Falhas pendentes: expectativa de microcopy antiga em community.spec e login da fixture do novo zz-login-owner-audit.spec. Não reaproveitar o GREEN anterior de 112/10/3 como certificação deste WIP.

Claude 19ec1e4 acrescenta seleção automática de DDI/DDD. Isso difere da regra histórica de selecionar DDI por clique. Localizar confirmação posterior do usuário nos laudos/histórico antes de decidir; nenhuma regra alterada nesta rodada.

## Evidências lidas e limites

README, PROPRIEDADE-E-PAPEL, laudos 13,14,16,17,18,19,20, prova-motor-e2e/PRODUCAO-execucao.md, histórico e diffstat; leitura dirigida de bot.ts, bot-automations.ts, whatsapp.ts e diferenças de PhoneField/app.ts.

Claude registra 211 testes API + 14 cliente/lint/build em 01fe764. Isso é evidência histórica do autor, NÃO gate rerodado pelo ASTRA no HEAD 8a1962f. A prova de produção registra injeção de fixtures e limpeza posterior, não sessão humana real com YouTube; não repetir em produção como rotina de auditoria. Nenhuma mensagem externa ou alteração de banco foi feita nesta rodada.

## Próxima sequência

1. Preservar repositório de auditoria, implementação e os dois WIPs; mapear artefatos de 10/10 aos SHAs sem tocar produção.
2. Revisar acesso (participante/ROOT/ADMIN), filas, loja/SUPER, migrações e integração do bot. Conferir decisões de produto mais recentes antes de resolver divergências.
3. Preparar integração revisável dentro da árvore canônica, preservando commits/autoria e o WIP local; não editar a árvore Claude durante a auditoria.
4. Executar gate completo na versão convergida e inspeção visual real desktop/mobile. Só então PR/merge/publicação coordenada.

Esta rodada alterou somente este relatório e os quatro cabeçalhos de continuidade. Nenhum código, commit, push, merge ou deploy.
