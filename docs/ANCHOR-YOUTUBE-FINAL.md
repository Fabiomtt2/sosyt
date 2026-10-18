# Checkpoint vigente — 2026-10-18T08:45-03:00

Fonte de integração: cofre Claude ~/AUDITORIA-CLAUDE-SOSYT/01-ESPELHO/trabalho,
branch auditoria/hybrid-plus-convergencia, HEAD local 027b1f7.
Commits locais: 2d2e1b3 (runtime, acesso e relay), 027b1f7 (relay longo/pausa).
Ainda SEM push/merge/deploy destes commits. Produção API continua 6b35c3b,
Web antiga. Sessão Evolution open e login Root HTTP200 confirmados nesta rodada.

Validação atual: 663 testes API e 36 cliente verdes, lint/build verdes.
E2E completo reexecutando após correções de autoria manual, clique Pix e catálogo lazy.
Resultado anterior: 11/14; não usar como certificação do conjunto novo.
Não iniciar segundo navegador/teste pesado. Cache Playwright canônico absoluto preservado.

Leia docs/CONVERGENCIA-FUNCIONAL-20261018.md e docs/INCIDENTE-BOT-ACESSO-20261018.md.
Leia os três laudos AUDITORIA-PERSONA-*-20261018.md, com evidências e limites.
A árvore canônica antiga permanece WIP preservado; contém módulos sociais, presentes,
filas e artes ainda não integrados ao cofre. Não sobrescrever árvores.

Fábio reafirmou atendimento humano NA MESMA conversa do BOT; usuário não abre outro chat.
Atendente autorizado responde via bot; número humano editável no painel identifica operador.
Pré-intro flash ~2s autorizada; LaunchFlash e CSS escritos, AINDA sem wiring/validação visual.
As três personas pedidas foram lançadas e entregaram laudos.

Próximo: concluir E2E, commits frontend/docs, push branch e main seguro, acompanhar API/Web,
backup consistente e smoke real autorizado. Continuar depois filas/Passe/cooldown, amigos,
doações, painel Root, ilustrações e inspeção visual atual. Não declarar 100%.
Autorização para merge/publicação já existe. Não pedir novamente confirmação genérica.

---

## ESTADO CANÔNICO — VERSÃO NOVA ONLINE — 2026-10-15T03:44:15.681864-03:00
- Fábio aplicou as7alterações no painel Railway. Patch vazio, nenhum trabalho pendente. Bloqueio anterior é histórico e não requer nova tentativa.
- APIad9c094f-c783-4c0e-a1ba-8f64147758d5 e Web27559349-38d7-434c-9107-9a975799c0e8 SUCCESS1/1 no mesmo commit586ca40, main, em15/10 às03:19 Bahia.
- API /health pública confirma jornada-20261014 e3capacidades. Backup pré-migração confirmado em /data/backups; volume /data500MB intacto. Web aguardou API pronta antes de iniciar.
- URL principal: https://sos-youtuber-web-production.up.railway.app ; API https://sos-youtuber-api-production.up.railway.app .
- Smoke real: ambosRootHTTP200, canConfigure/canManageOwners=true, Jornada/loja/chat/correio e modo participante administrativo funcionantes; Chromium1440/390 sem errosJS/HTTP5xx ou overflow observado. Capturas reais abertas.
- Passe estava inativo no banco de produção; foi ativado pela API Root conforme pedido de Fábio, mantendo preçoR$20/1passe e demais campos. Loja pública agora tem Moedas/Pular/SUPER/Passe; pacote antigo com bônus continua inativo.
- Código integral publicado. Pendências de integração: WhatsApp officialReady=false (modoOFFICIAL), PixDISABLED, GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET ausentes. Chave YouTube de validação configurada e VERIFIED. Não declarar conexão de canal/criação de playlist/Googlelogin ou envios/pagamentos reais disponíveis antes dessas credenciais.
- Relatório operacional: docs/DEPLOY-PRODUCAO-20261015.md. Pareceres: docs/AUDITORIA-JORNADA-LOGIN-CHAT-20261014.md.
- Gate de código permanece292API/25cliente/8Chromium+lint/build/diff GREEN. Nenhuma alteração de código após esse gate, somente configuração solicitada e documentação.
- Main local/remoto deve estar sincronizado ao final; commits documentais posteriores a586ca40 não alteram código implantado. Worktree atual convergencia-claude-20261012, branchmain; WIPs originais preservados.

## PRODUÇÃO NOVA CONFIRMADA — 2026-10-15T03:35:29.215920-03:00
- Fábio aplicou manualmente as7alterações pendentes. Railway confirma patch vazio, sem trabalho pendente; não há mais bloqueio da publicação.
- API ad9c094f-c783-4c0e-a1ba-8f64147758d5 SUCCESS1/1 e Web27559349-38d7-434c-9107-9a975799c0e8 SUCCESS1/1, ambos commit586ca4028b1de20f8b5aa6bbd1396b6948032699, main, implantados15/10 às03:19 Bahia.
- APIpública /health confirma release jornada-20261014 e capacidades gamification-v1/reward-redemption-v1/bot-password-v1.
- Backup consistente confirmado nos logs antes das migrações: /data/backups/pre-payment-benefits-1792045169222-b144ad30-c0c7-4239-8b35-23f245d44629.sqlite. Volume /data500MBpreservado.
- LogWeb comprova que aguardou capacidadesAPI e sóentão iniciou o servidor. Nenhum novo deploy necessário neste momento.
- AmbosOwners reautenticaram HTTP200 na versão nova. Smoke de telas públicas/Owner/participante em andamento; não confundir implantação do código com configuração definitiva de bot/Pix.
- Próximo: concluir smoke público e visão real, atualizar relatório definitivo e publicar checkpoint documental. Estado antigo de “deploy bloqueado” abaixo é histórico.

## ENTREGA ATUAL — 2026-10-15T03:14:36.405030-03:00
- PR #3 MERGED (9e1d8bc). Código revisado e documentação publicados em main; último checkpoint anterior a este documento: a1c2b09020f02dc36bb6b245d2f54e048bb805ba. Conferir ponta final com git rev-parse HEAD e origin/main.
- Gate GREEN: 292 API, 25 cliente, 8 Chromium, lint/TypeScript, build e diff check. Capturas finais vistas pelo integrador e auditor visual. Relatório: docs/AUDITORIA-JORNADA-LOGIN-CHAT-20261014.md.
- Implementado em main: XP/níveis/emblemas, moedas internas por nível/marcos, TOP3 mensal e ranking permanente, Booster sexta Bahia, trocas Passe/Pular e presentes, trials7dias, perfil/filas/chat/Owner e cinco eventos reais de bot. Saldo de recompensa separado de receita.
- Acesso/senha alternativa e senha bot cifrada integrados; invalidação de senha obsoleta; ROOT persistido e protegido, fora de premiações, credenciais atuais preservadas.
- PRODUÇÃO AINDA ANTIGA: Web/API online SUCCESS1/1, artefatos de 10/10 e health apenas {ok:true}. Novas capacidades não publicadas. API volume /data500MB intacto; backup/migrações da release ainda não executados.
- Tentativa autorizada Railway accept-deploy foi cancelada pela camada de aprovação: “Cancelled — the user did not approve this action. No changes were made.” Não atribuir recusa a Fábio e não contornar com CLI/browser.
- Patch d1be5c2e-d014-4ee2-bfab-9f295ea61286 continua STAGED, 7 campos, destructive=false: remove pin65d5b2c API/Web, reconecta fonte Web main, aguarda capacidades API no start Web, healthtimeout300s. Sem variáveis/rede/volume alterados.
- Pendência concreta: aplicar as7alterações pelo painel Railway production ou resolver autorização do conector. Não repetir em loop. Depois confirmar os dois SUCCESS, APIhealth com gamification-v1/reward-redemption-v1/bot-password-v1, backup em /data e smoke autenticado.
- URL principal funcionando na versão anterior: https://sos-youtuber-web-production.up.railway.app ; API https://sos-youtuber-api-production.up.railway.app .
- Rafael e Fábio revalidados na API pública HTTP200 nesta entrega. Credenciais reais somente em .env/arquivos privados ignorados e conversa; “sosyout” é histórico e não a credencial atual verificada.
- Pages está pausado sem VITE_API_URL configurada; workflow não publica uma versão desconectada. Sua configuração e CORS devem ser coordenados se esse canal for ativado.
- APIs definitivas Meta/Evolution e pagamentos reais seguem dependentes da configuração e validação externa. O gate não certifica atenção humana ou contagem do YouTube.
- Worktree atual: YouTube Final/.local-tmp/convergencia-claude-20261012, branch main, limpa ao final. Árvores originais Sol/Claude e seu WIP não foram descartados.

## Merge confirmado — 2026-10-15T03:12:11.350648-03:00
- PR #3 MERGED: https://github.com/Fabiomtt2/sosyt/pull/3
- Main local == GitHub main == 9e1d8bca8f81b9e51ddb0b7cc43049e094961973. Merge preservou os commits; árvore de produto idêntica à ponta testada 7edea71.
- Gate: 292 API, 25 cliente, 8 Chromium, lint/build/diff GREEN e revisão visual fresca. WIP/árvores originais Sol/Claude preservados.
- Código de gamificação, acesso, comunidade, loja e integração dos cinco eventos do bot agora está em main.
- Ainda não declarar deploy: próximo passo é aplicar patch Railway d1be5c2e-d014-4ee2-bfab-9f295ea61286 (7 campos não destrutivos). Volume /data, variáveis e dados preservados.
- Fonte Web espera API compatível. Após aplicar: observar SUCCESS dos dois serviços, backup/migrações e smoke público autenticado. APIs definitivas bot/pagamentos não certificadas.

## Push confirmado — 2026-10-15T03:09:56.147899-03:00
- Seis commits revisados publicados na branch astra/convergencia-20261012 até 0296bf240017bf136cd332b2e29c0a78863272e2; PR #3 atualizado com escopo final. Sem merge/deploy ainda.
- API 292, cliente25, Chromium8, lint/build/diff e reinspeção visual GREEN. Ponta documental posterior deve ser conferida por git/remote.
- Volume Railway /data intacto. Patch7 campos não destrutivo preparado; Web aguarda API compatível. Pages fica pausado enquanto não possui VITE_API_URL configurada.
- Próximo: confirmar ponta remota do PR, remover draft, merge seguro e aplicar uma vez o patch autorizado. Segredos ficam fora do Git.

## Checkpoint executivo — 2026-10-15T03:07:42.586017-03:00
- Cinco commits de código/teste/publicação concluídos. Documentando estado final para push e merge autorizado.
- Gate final: 292 API, 25 cliente, 8 Chromium, lint/build/diff GREEN. Capturas novas abertas e reinspecionadas.
- HEAD desta operação: afba71ef8ae71da85de985351df3f76724cc26ac. Ponta documental posterior: conferir git rev-parse HEAD e origin.
- Branch astra/convergencia-20261012; PR #3. Railway não publicado ainda, patch 7 campos preparado; volume preservado.
- Relatório dos dois auditores: docs/AUDITORIA-JORNADA-LOGIN-CHAT-20261014.md. Credenciais nunca no Git.

## Checkpoint executivo — 2026-10-15T03:07:42.581550-03:00
- Commit local confirmado: afba71ef8ae71da85de985351df3f76724cc26ac — fix(deploy): gate frontend publication on compatible API. Próximo: fechar documentação/push/PR/publicação.
- Gate final: 292 API, 25 cliente, 8 Chromium, lint/build/diff GREEN. Capturas novas abertas e reinspecionadas.
- HEAD desta operação: afba71ef8ae71da85de985351df3f76724cc26ac. Ponta documental posterior: conferir git rev-parse HEAD e origin.
- Branch astra/convergencia-20261012; PR #3. Railway não publicado ainda, patch 7 campos preparado; volume preservado.
- Relatório dos dois auditores: docs/AUDITORIA-JORNADA-LOGIN-CHAT-20261014.md. Credenciais nunca no Git.

## Checkpoint executivo — 2026-10-15T03:07:42.535616-03:00
- Commit local confirmado: 328f2c6120c57e4650bf9706344f11da8780b80e — test(e2e): verify journey commerce and responsive community flows. Próximo: fechar documentação/push/PR/publicação.
- Gate final: 292 API, 25 cliente, 8 Chromium, lint/build/diff GREEN. Capturas novas abertas e reinspecionadas.
- HEAD desta operação: 328f2c6120c57e4650bf9706344f11da8780b80e. Ponta documental posterior: conferir git rev-parse HEAD e origin.
- Branch astra/convergencia-20261012; PR #3. Railway não publicado ainda, patch 7 campos preparado; volume preservado.
- Relatório dos dois auditores: docs/AUDITORIA-JORNADA-LOGIN-CHAT-20261014.md. Credenciais nunca no Git.

## Checkpoint executivo — 2026-10-15T03:07:40.821084-03:00
- Commit local confirmado: 3df78b2950584dbfb4938786c238b8ad092cc1c7 — feat(web): integrate journey and refine premium community access. Próximo: fechar documentação/push/PR/publicação.
- Gate final: 292 API, 25 cliente, 8 Chromium, lint/build/diff GREEN. Capturas novas abertas e reinspecionadas.
- HEAD desta operação: 3df78b2950584dbfb4938786c238b8ad092cc1c7. Ponta documental posterior: conferir git rev-parse HEAD e origin.
- Branch astra/convergencia-20261012; PR #3. Railway não publicado ainda, patch 7 campos preparado; volume preservado.
- Relatório dos dois auditores: docs/AUDITORIA-JORNADA-LOGIN-CHAT-20261014.md. Credenciais nunca no Git.

## Checkpoint executivo — 2026-10-15T03:07:40.665608-03:00
- Commit local confirmado: 138917cabd4eed748a44568baa1bd03aa622e2e2 — feat(api): integrate journey events and protect account access. Próximo: fechar documentação/push/PR/publicação.
- Gate final: 292 API, 25 cliente, 8 Chromium, lint/build/diff GREEN. Capturas novas abertas e reinspecionadas.
- HEAD desta operação: 138917cabd4eed748a44568baa1bd03aa622e2e2. Ponta documental posterior: conferir git rev-parse HEAD e origin.
- Branch astra/convergencia-20261012; PR #3. Railway não publicado ainda, patch 7 campos preparado; volume preservado.
- Relatório dos dois auditores: docs/AUDITORIA-JORNADA-LOGIN-CHAT-20261014.md. Credenciais nunca no Git.

## Checkpoint executivo — 2026-10-15T03:07:40.584858-03:00
- Commit local confirmado: fb6a0ef5ad0ef6e2abc6f40f768f991489da5b43 — feat(rewards): add verified progression and earned coin economy. Próximo: fechar documentação/push/PR/publicação.
- Gate final: 292 API, 25 cliente, 8 Chromium, lint/build/diff GREEN. Capturas novas abertas e reinspecionadas.
- HEAD desta operação: fb6a0ef5ad0ef6e2abc6f40f768f991489da5b43. Ponta documental posterior: conferir git rev-parse HEAD e origin.
- Branch astra/convergencia-20261012; PR #3. Railway não publicado ainda, patch 7 campos preparado; volume preservado.
- Relatório dos dois auditores: docs/AUDITORIA-JORNADA-LOGIN-CHAT-20261014.md. Credenciais nunca no Git.

## Checkpoint executivo — 2026-10-15T03:07:40.054481-03:00
- Gate encerrado; revisão por domínio concluída. Iniciando commits locais, sem merge/deploy.
- Gate final: 292 API, 25 cliente, 8 Chromium, lint/build/diff GREEN. Capturas novas abertas e reinspecionadas.
- HEAD desta operação: bad6c07c583800f1fc8f0a45cb5b3078f6e6223c. Ponta documental posterior: conferir git rev-parse HEAD e origin.
- Branch astra/convergencia-20261012; PR #3. Railway não publicado ainda, patch 7 campos preparado; volume preservado.
- Relatório dos dois auditores: docs/AUDITORIA-JORNADA-LOGIN-CHAT-20261014.md. Credenciais nunca no Git.

## Retomada confirmada — 15/10/2026, 03h Bahia
- HEAD de trabalho bad6c07, branch astra/convergencia-20261012; WIP íntegro. Não houve commit/merge/deploy desta expansão.
- Gate journey-accepted-gate.log: API 292/292, cliente 25/25, lint/build GREEN; navegador 7/8. Último RED foi label acessível da senha atual; corrigido no markup, nova execução journey-final-browser.log em andamento.
- P1s encontrados pelos auditores foram corrigidos: senha bot pendente invalidada/cifrado apagado após troca/setup/bootstrap; ROOT configurado sincronizado em owner_access, excluído do TOP3, sem senha comum, sem rebaixamento/remoção e com troca de telefone segura.
- Google, OTP e modo participante sincronizam a identidade Root. Nenhuma credencial Owner foi alterada. Health anuncia capacidades da release jornada-20261014.
- XP aparece durante acompanhamento somente após confirmação do servidor; dashboard sincroniza a cada 5s com página visível e após operações. Nível 30 visual não substitui assinatura válida.
- Direct e Jornada possuem título/X fixos durante scroll; layout sem coluna vazia quando Booster indisponível. Capturas finais serão reinspecionadas.
- Railway patch d1be5c2e-d014-4ee2-bfab-9f295ea61286 agora contém 7 alterações: fonte API/Web + Web espera capacidades da API antes de servir e health timeout300s. Sem volume/variáveis/rede alterados, nada aplicado.
- Pages também verifica API; variável VITE_API_URL não está disponível no repositório (404), e a API atual só permite origem Railway Web. URL canônica de uso é Railway Web; não publicar um Pages desconectado.
- Próximo: encerrar E2E, rever novas imagens, atualizar relatório com ambos os pareceres, revisar/commitar por domínio, push/PR/main e uma tentativa autorizada de aplicar patch. Se a camada de aprovação rejeitar, registrar e preservar publicação anterior.

## Checkpoint atual — 14/10/2026 — Jornada, bot e acesso
- Worktree astra/convergencia-20261012, HEAD bad6c07; WIP preservado, nenhum commit/merge/deploy novo desta expansão.
- Implementado: XP por cobertura única consolidada no servidor; níveis com curva crescente; recompensas +1/nível, +20/10 níveis e SUPER de 7 dias/30 níveis. Tempo assistido/20 min → 1 moeda preservado.
- Ranking mensal Bahia com liquidação TOP3 15/10/5 uma vez por mês fechado; ranking permanente por nível/XP. Owners fora de premiações.
- Booster sexta America/Bahia 06:00–23:59, sorteio criptográfico, uma abertura/data; odds públicas/configuráveis. Troca somente moedas de recompensa por Passe/Pular (100 padrão), presentes idempotentes, receita separada.
- Integração visual: perfil, filas, chat global/privado, consulta de avatar, Jornada e painel Root. Nível 30 dá destaque visual; privilégio SUPER depende de assinatura/trial válido.
- Bot: cinco eventos reais, correio interno e outbox WhatsApp com estados explícitos. Senha inicial automática apenas com prova de acesso/conta aprovada/provedor elegível; payload cifrado antes de gravar, senhas existentes e Owners preservados.
- Login/chats revisados no tema premium; chat comum 30s e ADMIN/ROOT/SUPER isentos conforme regras; moderação usa autorização administrativa real.
- Gate final pendente após últimas correções: módulos 15 gamificação +4 bot +5 senha GREEN; E2E Jornada passou; último browser 7/8 com microcopy restante corrigida. Não declarar gate inteiro fechado.
- Dois pareceres serão consolidados em docs/AUDITORIA-JORNADA-LOGIN-CHAT-20261014.md. Capturas de fixtures, não dados pessoais.
- Rafael e Fábio autenticaram na produção com permissões ROOT confirmadas; credenciais somente em arquivos locais ignorados e conversa, nunca documentação/Git.
- Railway API/Web ainda artefatos de 10/10, volume /data intacto; patch staged d1be5c2e-d014-4ee2-bfab-9f295ea61286. Publicação depende do gate e operação coordenada; não contornar rejeição de aprovação.
- Próximo: gate completo, olhar capturas frescas, revisar diff, commits lógicos/push/PR e publicação segura. Histórico abaixo é preservado e não substitui este checkpoint.

## Rodada em andamento — 14/10/2026 — login, sala e recuperação Claude

- Base limpa bad6c07 na branch astra/convergencia-20261012; PR #3 draft. Nenhum merge/deploy novo.
- Novo pedido Fábio: refinar login no tema creme/ameixa, reformar sala pública para não parecer DM, participantes30s e ROOT_OWNER/ADMIN_OWNER sem cooldown; revisar XP/progresso Claude e cadastro automático pelo bot Híbrido+.
- Dois agentes somente leitura retomados: auditor_motor_retomada e auditor_visual_retomada. Capturas antes atuais access-before-* e room-admin-before-* abertas pelos auditores.
- Claude8a1962f ancestral preservado e os2arquivos bot WIP importados byte a byte. XP/níveis constam como proposta F3 no LAUDO-10, sem runtime perdido. Progresso por vídeo/tempo entre filas/20min→1moeda existe e é preservado.
- REDs: defaultchat180s; contratoADMIN informava180 emboraenvioisento; nota arredondava30spara1min; UI não moderavaSUPER; intro mobile617px; mensagensADMIN cartõessobrepostos.
- WIPcorrige30sdefault mantendo exceçõesOwner, contratoisento, feedsem balões, moderaçãoexplícita+limpezaconfirmadaROOT, rascunhoeditável duranteespera, introcompacta/microcopy.
- LoginOTP5min real usaMeta; seleçãoHíbrido+/flags não governamenvio; bootstrapgera senhaapósprova masnão entregaautomaticamente. Chip/provedor definitivo pendente; não declararbotativo nemsenhageradaautomática.
- Gate novo ainda em andamento: lint inicialGREEN; capturastestes access-room-before1/1GREEN. Não usar259/25/6anteriores como gate desteWIP.
- Próximo: visualafter, testes moderação/cooldown, gatecompleto, evidências/commits/push. Railwayhold permanece registrado abaixo.

## Retomada imediata — 14/10/2026 — comércio e identidade validados

- Fase: código e capturas publicados na branch, conferidos contra GitHub. Commit de código: d2f37dc43ef012bd639fd69b61c1f3006a0acf11. Ponta documental: obter com git rev-parse HEAD e comparar a origin/astra/convergencia-20261012.
- Worktree de integração existente: YouTube Final/.local-tmp/convergencia-claude-20261012. Branch astra/convergencia-20261012; base da rodada f730ecf3ce7a35cdc0acc00f91a329873b3ac226. Árvores original Sol e espelho Claude preservados.
- PR #3: https://github.com/Fabiomtt2/sosyt/pull/3 (draft). Main confirmado em b684f236ebf50766b02aacabedc122c82c9111b1. Sem merge/deploy desta rodada.
- GREEN: 259 API, 25 cliente, 6 Playwright; lint/TypeScript, build e diff check. Execução final em .local-tmp/e2e-commerce-final-20261014.log. Build mantém aviso não bloqueante de chunk >500 kB.
- Inspeção visual real desktop/mobile: loja, Pular/Passe/SUPER, confirmação +10, inventário, chat global, DM e badge ADMIN. Arte padrão do Passe corrigida para não embutir preço. Relatório: docs/AUDITORIA-COMERCIO-SUPER-20261014.md.
- Entrega: catálogo aditivo sem sobrescrever configuração Owner; recibos autenticados; celebração somente após crédito confirmado; recuperação de pendências/reload e deduplicação; Pular idempotente; ADMIN público; moldura e fala SUPER vinculadas à assinatura, preservando avatar; CTA animada e movimento reduzido.
- RED real corrigido no gate: nome legado do Owner retornava após modo participante. Mantém o nome público no mesmo usuário e consulta telefone efetivo persistido na elevação. ROOT_OWNER de Fábio/Rafael preservado.
- PASSE e PULAR são distintos. 10 moedas/R$20 sem passe bônus antigo; preços editados pelos Owners permanecem. Produto já inativado pelo Owner continua inativo.
- Railway relido em 14/10: Web/API online SUCCESS 1/1; volume 500 MB em /data; artefatos de 10/10 ativos. Patch d1be5c2e-d014-4ee2-bfab-9f295ea61286 segue STAGED, removendo pin 65d5b2c.
- Publicação coordenada ainda pendente. Cancelamento anterior de accept-deploy veio da camada de aprovação apesar de autorização de Fábio e Allow all actions. Causa específica não exposta; não atribuir recusa ao usuário, não contornar via CLI/browser e não alegar deploy.
- Próximo: conferir a ponta documental e PR; resolver publicação conjunta API/Web. Main dispara Pages. Não entregar frontend novo com API antiga.
- Bot definitivo e pagamentos reais dependem das APIs/credenciais já documentadas. Gate local usa fixtures e não certifica provedores externos nem atenção humana.
- Checkpoint atualizado em 2026-10-14T14:11:49.253750-03:00. Estado operacional pós-commit/push também em .local-tmp/publication-20261014.json.

### Commits desta rodada
- bb501609a98767dc10afac27e7ed46e6f0f7df05 fix(api): reconcile purchases and subscription identity
- 82de44751fa7492578f4931b683ea59f736cf98b fix(auth): preserve owner identity across participant sessions
- 840903a34f0e4d52b938989133ee51ab3404543e feat(web): celebrate purchases and unify premium community identity
- d2f37dc43ef012bd639fd69b61c1f3006a0acf11 test(e2e): verify commerce and refresh responsive visual evidence

## Retomada imediata — entrega auditada publicada em branch / PR draft
- PR: https://github.com/Fabiomtt2/sosyt/pull/3
- Branch astra/convergencia-20261012; código e capturas verificados no commit a07ca66896ed8578cbb319bbe19b4b7ae9e035f7. A ponta documental posterior deve ser obtida com git rev-parse HEAD e confrontada com origin/astra/convergencia-20261012.
- Cinco commits por domínio já enviados. Esta seção será consolidada no commit documental e enviada na mesma branch. O estado exato do último push está em .local-tmp/publication-20261013.json.
- main/origin/main permanece b684f236ebf50766b02aacabedc122c82c9111b1. Nenhum merge/deploy desta rodada. Árvores Sol/Claude e WIPs originais preservados.
- GREEN: 249 API + 21 cliente + 5 Playwright; lint/TypeScript/build; diff check; capturas reais desktop/mobile vistas com os olhos. Avatar Owner decodificado no chat, DM recebida, presente debitado/creditado uma vez, Híbrido+ salvo, Pular respeitando fila selecionada.
- Entrega: sala pública fixa e aberta; privadas distintas; inventário/SUPER; loja lateral configurável; duas novas artes editoriais, banners do participante, loading acolhedor; identidade Owner/participante/chat e preferência WhatsApp unificadas.
- Relatório completo e sugestões: docs/AUDITORIA-PRODUTO-ASTRA-20261013.md. Cobertura não equivale a 100% de estados/navegadores; pagamentos e APIs definitivas não foram exercitados.
- Railway relido em 13/10: API/Web Online SUCCESS 1/1, /data presente, sem ocorrências. Artefatos de 10/10 ainda ativos. Patch d1be5c2e-d014-4ee2-bfab-9f295ea61286 STAGED.
- Bloqueio concreto: accept-deploy retornou cancelamento por aprovação ausente apesar da autorização explícita de Fábio. Não atribuir a uma recusa dele; não contornar por CLI/browser, repetir em loop ou alegar publicação.
- Próximo: resolver o bloqueio do conector, revisar PR/diff e coordenar API/Web. Main aciona Pages; não liberar frontend isolado. Depois observar implantação, volume, health e smoke público com versões comprovadas.
- Bot Meta/Evolution: configuração unificada pronta, APIs definitivas/runtime de grupos e catálogo de 19 eventos ainda em preparação. Não fabricar credenciais nem prometer execução.
- Preservar catálogo aprovado por Fábio/Claude, ambas as contas ROOT_OWNER, intro sem carrossel, telefones pessoais/segredos fora do Git.

## Push confirmado — 2026-10-13T18:17:25.766973+00:00
- Branch astra/convergencia-20261012 publicada até a07ca66896ed8578cbb319bbe19b4b7ae9e035f7. Cinco commits temáticos; main permanece b684f236ebf50766b02aacabedc122c82c9111b1. Sem merge/deploy. Próximo: PR draft e consolidação documental.

## Commit confirmado — 2026-10-13T18:15:03.377609+00:00
- a07ca66896ed8578cbb319bbe19b4b7ae9e035f7 — test: verify community interactions and fresh responsive visuals
- Commit local na branch astra/convergencia-20261012. Não representa push/merge/deploy. Conjunto validado com 249 API + 21 cliente, lint/build e 5 E2E. Próximo: documentação e publicação da branch/PR, mantendo coordenação API/Web.

## Commit confirmado — 2026-10-13T18:15:02.457113+00:00
- dce37430455c5e736e382fe5e258af267997b648 — feat(web): integrate community room and illustrated participant experience
- Commit local na branch astra/convergencia-20261012. Não representa push/merge/deploy. Conjunto validado com 249 API + 21 cliente, lint/build e 5 E2E. Próximo: documentação e publicação da branch/PR, mantendo coordenação API/Web.

## Commit confirmado — 2026-10-13T18:15:02.295451+00:00
- 88b2e38c4023f8d674eabf929201bc2601f62a33 — fix(community): unify owner identity and secure cross-user transactions
- Commit local na branch astra/convergencia-20261012. Não representa push/merge/deploy. Conjunto validado com 249 API + 21 cliente, lint/build e 5 E2E. Próximo: documentação e publicação da branch/PR, mantendo coordenação API/Web.

## Commit confirmado — 2026-10-13T18:15:02.251450+00:00
- b0de8630e09697f65805fa39570df933b8cd61d9 — fix(whatsapp): converge persisted hybrid provider preferences
- Commit local na branch astra/convergencia-20261012. Não representa push/merge/deploy. Conjunto validado com 249 API + 21 cliente, lint/build e 5 E2E. Próximo: documentação e publicação da branch/PR, mantendo coordenação API/Web.

## Commit confirmado — 2026-10-13T18:15:02.190081+00:00
- 4ae7d6b73589df6122983a25232afe68001f0344 — chore: bundle local fonts and stabilize verification resources
- Commit local na branch astra/convergencia-20261012. Não representa push/merge/deploy. Conjunto validado com 249 API + 21 cliente, lint/build e 5 E2E. Próximo: documentação e publicação da branch/PR, mantendo coordenação API/Web.

## Gate final e revisão visual concluídos — 2026-10-13T18:14:43.987253+00:00
- Execução: YouTube Final/.local-tmp/convergencia-claude-20261012, branch astra/convergencia-20261012. HEAD e origin/main b684f236 antes dos novos commits. WIP original Sol/Claude preservado.
- GREEN confirmado em avatar-final-*: 249 API, 21 cliente, lint/TypeScript, build, 5 Playwright; diff --check limpo. Avatar público decodificado no navegador depois da correção CORP, inclusive cache 304.
- Capturas desktop/mobile vistas com os olhos: sala pública aberta/fixa, avatar Owner, loja lateral, DM/inventário/presente, Híbrido+ e carregamento. Relatório e sugestões: docs/AUDITORIA-PRODUTO-ASTRA-20261013.md.
- Railway relido agora: API/Web SUCCESS, 1/1, sem ocorrências; API com volume. Artefatos anteriores de 10/10 continuam ativos. Patch d1be5c2e-d014-4ee2-bfab-9f295ea61286 STAGED; conector rejeitou accept-deploy por aprovação ausente apesar da autorização explícita. Não contornar nem anunciar deploy.
- Próximo: executar .local-tmp/commit-reviewed-20261013.py, consolidar docs, push da branch e PR draft. Main também aciona Pages: manter publicação Web/API coordenada; não fazer merge enquanto o backend novo não puder ser publicado.
- Não há confirmação de runtime definitivo Evolution nem dos 19 eventos novos do bot. Preservar preços aprovados, intro sem carrossel e credenciais fora do Git.

## RED visual identificado e corrigido no WIP — 13/10/2026
- Chat global agora aberto/fixo, coluna reservada desktop e área própria de rolagem mobile; room-e2e 5/5 GREEN com geometria sem sobreposição.
- Inspeção visual encontrou ícone quebrado no avatar de catálogo, apesar do elemento existir. Helmet aplicava CORP same-origin à imagem pública da API, distinta da origem Web.
- Rota /avatars/:slug agora define CORP cross-origin apenas para imagens públicas, inclusive 304; demais rotas mantêm a proteção. Teste API verifica cabeçalhos/WEBP e E2E verifica complete/naturalWidth do avatar no chat.
- Novo gate avatar-final-* em execução. NÃO usar room-e2e anterior como GREEN definitivo deste último ajuste. Próximo: inspecionar avatar decodificado e executar commits temáticos já preparados em .local-tmp/commit-reviewed-20261013.py somente após gate final.
- Duas artes editoriais novas integradas em WebP, sala global/privadas separadas, loading acolhedor, prévia de aviso Owner e feedback de clique; avaliação/sugestões em AUDITORIA-PRODUTO-ASTRA-20261013.md.

## Direção explícita de Fábio — 13/10/2026 manhã, Bahia
- Chat global deve permanecer fixo e aberto como sala de conversa; não iniciar como faixa minimizada. Separar mensagens privadas visualmente. Desktop reserva coluna; mobile janela fixa com recolhimento voluntário.
- Enriquecer ilustrações, banners informativos, carregamento personalizado e feedback de clique; reduzir movimento quando solicitado pelo sistema. Intro continua sem carrossel.
- Auditoria não foi 100% de todos os estados: inspecionados Owner/participante, loja, banners, DM e presente com contas sintéticas. Relatar cobertura e limitações.
- Gate resumed: 249 API + 21 cliente + 5 E2E GREEN. Gate verified após alinhamento: 249/21, lint/build GREEN, E2E 4/5 por arte mobile 1px fora do card. Corrigir arte mantendo asserção geométrica.
- WIP ainda não commitado; main b684f236. Railway anterior online; patch pendente. Próximo: chat aberto, arte e feedback visual, capturas novas, gate e commits.

## Retomada confirmada — 13/10/2026 UTC
- HEAD b684f236 na worktree convergencia-claude-20261012; WIP preservado, sem novos commits ou publicação nesta retomada.
- release-unit.log confirma 249 testes API + 21 cliente GREEN; release-lint.log e release-build.log concluídos. release-e2e.log foi interrompido após 1/5, sem processo ativo. Somente E2E retomado em resumed-e2e.log; não declarar resultado antes de ler término.
- Última auditoria pública anterior confirmou login Owner HTTP 200 e acesso ao participante. Produção ainda apresentava avatar divergente entre painéis, Root como USER no chat e SUPER inativo. Correções locais incluem reconciliação de perfis legados ao iniciar API, com teste de reinício.
- Referência de presente é idempotente e destinatário da confirmação fica fixo. Marca WPP corrigida para W; Híbrido+ Meta/Evolution tem identidade própria.
- Evidências públicas com conta real ficam somente em .local-tmp/prod-*-private.png, fora do Git. Não registrar credencial nem telefone pessoal.
- Próximo: resultado E2E, inspeção das capturas novas, revisão final, commits temáticos/push/PR. Railway continua com bloqueio de aprovação informado pelo conector; nenhuma publicação nova confirmada. Coordenar API/Web antes de main.

## Checkpoint visual e integração — 12/10/2026 23:48 UTC
- Worktree de execução: .local-tmp/convergencia-claude-20261012, branch astra/convergencia-20261012, HEAD/main/origin/main ainda b684f236 até os commits desta rodada. Originais Sol/Claude preservados.
- Conjunto WIP: Híbrido+ Meta/Evolution persistido nas duas abas (legado recuperado por updated_at); avatar Owner/participante/chat; identidade atual SUPER; mensagens/inventário/presentes; loja lateral; banners; carregamento acolhedor.
- REDs reais corrigidos: Owner rejeitava catálogo; avatar não passava ao participante; cursor perdia mensagens do mesmo instante; chat retinha avatares/papéis/remoções; Pular podia cobrar a primeira fila gratuita e envio ignorava seleção; SUPER barrado no frontend; formulário apagava dados ao falhar.
- Presentes usam referência idempotente; repetição não duplica transferência. Root ilimitado depende da sessão administrativa validada, não de campos do cliente. Avisos internos identificam Owner e avatar.
- Última etapa accepted-*: 247 API e 21 cliente passaram; lint/build passaram; 5/5 E2E passaram. Depois disso, acrescentada recuperação da preferência legada mais recente + teste (248 esperados) e fixture de arte única. NOVO gate final em execução; conferir *.log antes de declarar o último estado GREEN.
- Inspeção com os olhos detectou X à esquerda e Híbrido+ sem contraste mesmo com fluxos GREEN; corrigidos em premium.css. Evidências premium-* atuais; capturas de modal são viewport (fullPage=false).
- Railway permanece bloqueado: nova autorização explícita do usuário, mas accept-deploy retorna Cancelled/INVALID_ARGUMENT por aprovação ausente. Nenhuma mudança aplicada; API/Web anteriores online, /data presente, patch d1be5c2e-d014-4ee2-bfab-9f295ea61286 STAGED.
- APIs definitivas Meta/Evolution e execução das flags do catálogo não são declaradas operacionais. Não criar segredos nem apagar configurações. Preço/quantidade Claude aprovados preservados; não repor passe no pacote.
- Próximo: finalizar gate e revisão de imagens; commits por domínio; push/PR. Publicação/merge precisam preservar coordenação API/Web, pois o frontend novo usa rotas/contratos novos. Não publicar Web sozinho.

## Retomada visual — 12/10/2026, conta fxmotta2 reconectada
- Local HEAD e origin/main b684f236; WIP preservado. Claude continua 8a1962f.
- reconnected-e2e.log: 4/4 GREEN, capturas novas ~22:59–23:00 UTC.
- API/Web anteriores online SUCCESS 1/1, volume presente. Nova autorização explícita de Fábio; accept-deploy novamente cancelou por aprovação ausente. Patch d1be5c2e-d014-4ee2-bfab-9f295ea61286 pendente; nada publicado.
- Escopo: Híbrido+ Meta/Evolution; avatar/chat; loja lateral premium; inventário/SUPER/DM/presentes; banners e carregamento. Preços Claude aprovados, intro sem carrossel.
- REDs: Owner não aceita cat-*; chat não resolve catálogo nem atualiza identidades/remoções; modos Bot/Integrações distintos; correio/inventário sem cliente participante.
- Próximo: corrigir contratos, capturar antes/depois, gate e commits temáticos.

## Estado atual — 12/10/2026, após confirmação de publicação
- PR #2 já MERGED; GitHub/main/local main b684f236ebf50766b02aacabedc122c82c9111b1. Esta worktree mantém a versão integrada; árvores original e Claude preservadas.
- Fábio confirmou publicação nesta rodada. O conector accept-deploy voltou a responder “Cancelled — the user did not approve this action. No changes were made.” Não contornar por CLI/browser nem afirmar deploy novo.
- Railway patch d1be5c2e-d014-4ee2-bfab-9f295ea61286 continua preparado somente para fontes API/Web; produção anterior online, API /data preservado.
- Acesso Owner de Fábio confirmado na API pública: POST /admin/login → 200, com credencial de emergência existente. Segredo e telefone privado NÃO registrados em Git. `sosyout` é histórico DEV, não credencial pública confirmada.
- Auditoria visual pós-merge em curso, Chromium desktop/mobile e contas sintéticas. Código identifica limpeza indevida do formulário ao falhar troca de credencial; corrigir e validar. Texto técnico longo de login/Avatares/Acesso será simplificado com fidelidade aos motores.

# ÂNCORA CANÔNICA — YOUTUBE FINAL

## Retomada imediata — conjunto homologado para merge — 12/10/2026
- Worktree executável de convergência: YouTube Final/.local-tmp/convergencia-claude-20261012, branch astra/convergencia-20261012. Código validado: fc811bad3006f404addc9e931331e2033d9e4166. Usar git rev-parse HEAD para obter a ponta documental atual.
- Ler docs/CONVERGENCIA-ASTRA-20261012.md. Herda 27 commits Claude sobre 6d09b6f; 6 commits ASTRA por domínio preservam telefone, navegação Owner, Loja, preparação do bot, E2E e proteção de compras.
- Gate final3: API 237/237, cliente 21/21, TypeScript/build GREEN, E2E 4/4 GREEN. Logs em .local-tmp/gate-20261012/*final3.log; capturas desktop/mobile frescas em docs/evidencias.
- Catálogo conforme decisão Fábio/Claude (1d8b50d): não restaurar pacote/passe antigos. Campos de arte/item/SUPER persistem pela rota real e chegam ao participante; item oculto não é republicado ao editar. Compras guardam benefícios ofertados; backup SQLite automático anterior à migração.
- bot-automations.ts/test copiados com hashes idênticos da árvore Claude; catálogo de 19 eventos preservado. OTP/outbox/cadastro/alertas existentes permanecem; ligar preferências/eventos novos e APIs de grupo é a integração ainda aberta. Usuário confirma GREEN do número temporário Meta; não fabricar credenciais definitivas.
- Original sol/user-premium-20261006 @ 6d09b6f e fonte Claude @ 8a1962f permanecem com seus WIPs preservados. Não iniciar o servidor da árvore original para homologar a convergência.
- GitHub main antes da publicação ainda c0b8172, PR #1 draft antiga. Próximo: push da convergência, revisar PR/diff, merge preservando histórico.
- Railway API dddb1c3c/Web 1bf687bd Online SUCCESS 1/1, API /data. Ambos ainda pinados em 65d5b2c na configuração de source, apesar de uploads manuais mais novos. Após main convergir, trocar fonte via staged change no environment production e observar SUCCESS, backup e smoke público. Não usar redeploy que reutiliza o artefato antigo.


## Correção explícita do usuário — 12/10/2026 14:10 Bahia — precedência atual
- A mudança de preço/quantidade de moedas e retirada do passe do pacote foi determinada por Fábio com Claude. NÃO é regressão. Preservar o catálogo aprovado/configurado; não restaurar automaticamente ofertas antigas.
- Nesta retomada, removida a restauração equivocada feita por ASTRA: COINS_10 padrão permanece R$20, 10 moedas, zero passes; PASS_SINGLE legado inativo. Nenhum banco de produção alterado. Outros valores devem ser conferidos no catálogo real/Owner, sem inferir “20 moedas” apenas do chat.
- Scripts/estados do Claude são preparação válida para o funcionamento integrado do bot/usuário/Owner. O usuário confirma GREEN do teste com número temporário Meta. Próximo trabalho é integrar caminhos de API/runtime e configuração persistida, preservando rascunhos; não tratar preparação como ausência total do motor nem declarar produção pronta só por credenciais salvas.
- Continuar na worktree .local-tmp/convergencia-claude-20261012 @ 8a1962f + WIP; original e árvore Claude intactos. E2E anterior falhou em vídeos fictícios agora rejeitados pela verificação de existência; corrigir fixture de teste sem enfraquecer validação real. Chat sobre modal encontrado e z-index corrigido; falta prova fresca.


## Reancoragem Claude — 12/10/2026 UTC — prevalece sobre checkpoints abaixo
- Ler docs/REANCORAGEM-CLAUDE-20261012.md antes de editar/publicar. Claude criou AUDITORIA-CLAUDE-SOSYT e implementação em 01-ESPELHO/trabalho, branch auditoria/correcoes-propostas @ 8a1962f, 27 commits sobre 6d09b6f; ambos sem remote configurado.
- GitHub main continua c0b8172; PR #1 OPEN/DRAFT head 6d09b6f. Nosso WIP posterior continua preservado e não homologado (último E2E 2/4). Não tratar o GREEN de 08/10 abaixo como status atual de toda a working tree.
- Railway REAL: API dddb1c3c e Web 1bf687bd, deployments de 10/10, ambos SUCCESS/Online 1/1; /data presente. HTTP health/Web 200. Fonte configurada antiga 65d5b2c não identifica os uploads manuais. SHA dos artefatos atuais ainda não comprovado; não republicar branch antiga.
- Bot novo: configurações/status não estão conectados ao motor de envio; catálogo bot-automations.ts + teste ainda untracked e sem integração runtime. Novidades reais incluem acesso por senha, múltiplas filas, loja configurável, SUPER, chat/correio e tiers de avatar; exigem revisão e gate conjunto.
- Preservar as duas árvores. Colisões com nosso WIP: App, OwnerDashboard, OwnerDeskMenu, PhoneField, styles. Nenhuma regra, código ou produção alterada nesta descoberta. Próximo: mapear deploys atuais, revisar novos motores/decisões e integrar com rastreabilidade.

## Retomada ASTRA — 08/10/2026 02:42 -03
- Conferência final: PR #1 OPEN/DRAFT, sem conflito; não há CI configurado nesta branch (gate local comprovado acima). Railway API/Web online SUCCESS, 1/1, zero ocorrências e zero mudanças pendentes em 08/10. Comparação integral contra main encontrou apenas uma linha extra no EOF de watch-rewards.ts, removida sem alteração de comportamento.
- PR em rascunho: https://github.com/Fabiomtt2/sosyt/pull/1. Manter sem merge até homologar o login real e coordenar API/Web. Código/evidências em ba1ce1ab; ponta documental da branch obtida com git rev-parse HEAD.
- Branch sol/user-premium-20261006, base c0b8172. WIP consolidado em 11 commits temáticos; código/evidências validados em ba1ce1abf7e2748131ce1e96e45704dd667c2919. Documentação vem em commit posterior na mesma branch (resolver HEAD com git rev-parse). Main/GitHub ainda c0b8172 e produção 65d5b2c. Branch publicada e conferida no GitHub; push inicial f434ab6d08de0a73666fd874ef066ffdc489053f, seguido deste checkpoint documental. Sem merge/deploy.
- Gate final GREEN: .local-tmp/gate-reviewed-20261008T053328Z/results.json — 112 testes API, 10 cliente, lint, build, Playwright 3/3, diff e cached-check. Python 5/5 GREEN com OCR/GUI reais em Xvfb isolado. Fixtures de telefone agora sintéticas.
- Login: chave WhatsApp 5 min/uso único ou Google alternativo; aprovação e carteira preservadas. Business +5571993978956 central/editável/persistido. Alertas e decisões agora consultam templates salvos; contagem inclui associações Google pendentes.
- Companion novo real em companion/sos_companion.py; opt-in, região explícita, OCR local, metadados apenas, sem automação do player/ledger. API com token restrito, expiração e revogação web/local. E2E executa cliente Python contra API real de teste. Não foi recuperado um runtime IFtp histórico.
- WATCH_TIME: 1 moeda interna/20 min acumulados, perfil e detalhe Owner usando mesma fonte. Legado preservado sem fabricar tempo. Corrigidas pausa, corrida de inicialização YouTube e conclusão por percentual legado.
- Visual: intro sem carrossel/background ilustrado; banners só no dashboard; novas artes de loja; lifecycle de modais com foco/Tab/Escape/body lock. Avatar persistente e badge ADMIN auditados. Screenshot do cartão detectou SOS YOUTUBER #; corrigido para Participação administrativa no cartão e no detalhe.
- Impedimento de publicação: prontidão do login real não comprovada. Google sem variáveis no Railway; Meta pode existir no banco. Credenciais Owner locais retornaram 401 na API de produção (health 200). Não inventar credenciais nem habilitar DEV para contornar.
- Main dispara publicação Pages automaticamente, então não fazer merge enquanto API/provedores não estiverem prontos. Railway mantém fonte fixada em 65d5b2c e volume /data. Pilha validada como conjunto, não cada commit intermediário como release.
- Auditoria detalhada: docs/AUDITORIA-ASTRA-20261008.md. Próximo: confirmar configuração real Meta/Google com acesso administrativo de produção, homologar login, só então coordenar merge/publicação e smoke público. Não recriar o número Business nem reabrir decisões já registradas.
- Snapshot imediatamente anterior aos commits: .local-tmp/astra-precommit-20261008T053653Z (115 arquivos + patches + hashes).


## Regra mais recente — Fábio, 07/10/2026 13:25 Bahia
- WhatsApp Business público inicial aprovado: +5571993978956. Fonte: mensagem explícita do usuário; pode constar no modelo do projeto. Contatos privados/credenciais dos Owners continuam separados.
- Número central em apps/api/src/project-defaults.ts, seed inicial em integration_settings e edição persistente pelo painel ROOT_OWNER. Valor persistido prevalece após restart/deploy. Links públicos e effectiveWhatsAppConfig consultam o mesmo estado. Mudar telefone não descobre credenciais Meta; conferência cruza telefone público e Phone Number ID antes de liberar envio após alterações.
- NÃO usar carrossel nem ilustração de background na intro/login: removida a montagem de IntroVisualCarousel. Componente antigo preservado no WIP para rastreabilidade, sem uso na tela.
- Carrossel aprovado apenas na área do participante, em formato banner informativo sobre o projeto. Artes não são finais: ASTRA autorizado a redesenhar loja e demais ilustrações, afastando estética gamer; motores continuam prioritários.
- Na retomada, encontrada e lida integralmente docs/AUDITORIA-SOL-MOTOR-20261007.md. Sol implementou watch-observation/WATCH_TIME enquanto ASTRA estava parado. Não reconstruir o motor duplicado: auditar estado atual, inclusive protocolo legado.
- Snapshot anterior a esta edição: .local-tmp/astra-business-entry-20261007T162833Z (88 arquivos WIP + patches + hashes). HEAD continua c0b8172, branch sol/user-premium-20261006. Sem commit/push/merge/deploy nesta etapa.


Data-base: 06/10/2026.

> LEITURA OBRIGATÓRIA. Este arquivo é a fonte de verdade de produto e continuidade do repositório YouTube Final.
> Toda instância/agente deve lê-lo antes de editar. Mudança de regra validada pelo usuário deve atualizar esta âncora no mesmo checkpoint.

## 1. Governança

- **Checkpoint crítico mais recente:** `docs/RECOVERY-CHECKPOINT-20261006-CRITICAL-OWNER-UI.md`. Os REDs registrados nessa rodada estão fechados no estado atual, mas toda nova instância deve lê-lo imediatamente após esta âncora para não reintroduzi-los.
- Projeto mutável: `YouTube Final`.
- `Conexão Youtube` é origem histórica ASTRA para auditoria/comparação; não editar durante convergências.
- Antes de qualquer edição: `git status --short`, `git log -5 --oneline`, ler `AGENTS.md`, esta âncora, `PROJECT_STATUS.md` e as skills de continuidade/recuperação.
- Nunca reset/clean/stash ou descarte de WIP sem autorização explícita.
- Git, testes e handoffs validados têm precedência sobre memória do agente.
- Heartbeat ao usuário em marcos importantes e no máximo aproximadamente 5 minutos em execução prolongada.
- Estado de candidatura pendente nunca pode sobrepor a etapa Owner: ao escolher “Acessar com outro número”, o pedido continua no servidor/localStorage, mas sua reapresentação automática é suprimida apenas no estado em memória da sessão React atual. Fechar/reabrir a página permite retomar o acompanhamento persistido novamente.
- Segredos, telefones reais e tokens nunca são versionados; ficam no `.env` ignorado.

## 2. Identidades e acesso

- Tela de entrada é neutra: nome + WhatsApp internacional. Participante comum não digita grupo; o servidor resolve o grupo pelo WhatsApp e pelos vínculos/evidências aprovados.
- Nunca forçar `+55`; telefone é internacional. O login usa um controle único moderno: seletor de país/DDI com bandeira, DDD brasileiro quando aplicável e uma única caixa numérica para o restante do telefone. País/DDD usam popovers, não `<select>` nativo.
- Nome de Owner é comparado sem diferenciar maiúsculas/minúsculas, acentos e alias final `0`.
- Owners principais: `Fábio/Fabio` e `Rafael` são ambos `ROOT_OWNER` com acesso total. Nomes configurados com sufixo `0` permanecem aceitos apenas como aliases de compatibilidade quando o WhatsApp correspondente também confere. `ADMIN_OWNER` é reservado a administradores adicionais promovidos e restritos.
- Telefones Owner reais ficam em `OWNER_FABIO_WHATSAPP` e `OWNER_RAFAEL_WHATSAPP`.
- Durante homologação, ambos os Owners podem ser usados; a ausência física de Rafael não bloqueia testes com a conta Fábio.
- Somente Owner identificado vê o campo `Credencial`; em desenvolvimento, `sosyout` é a credencial de teste.
- O dashboard Owner mostra o alias efetivamente digitado no login, sem reescrevê-lo para o nome canônico.
- `#` é marcador interno; nunca aparece como credencial, grupo ou instrução na UI.

## 3. Cadastro de participante

- Existe uma única CTA principal `Quero participar`.
- Fluxo: dados → solicitação pendente persistente → dashboard Owner + bot → aprovação → mesma tela muda para `Cadastro aprovado` → usuário escolhe `Voltar ao acesso` → login direto.
- Participante comum nunca recebe campo de Credencial/OTP no fluxo principal. Owner identificado continua obrigado a informar `Credencial`.
- Tentativa de login ainda não aprovada vira cadastro pendente amigável; não apresentar 403 cru ao usuário.
- A solicitação recebe token opaco de acompanhamento, persistido no navegador por até 30 dias e validado no servidor. A página consulta o status periodicamente e também possui `Verificar situação`.
- O usuário pode fechar a página. Manter os dados do site permite reencontrar automaticamente a tela pendente/aprovada. Apagar cache/storage não apaga o pedido do servidor.
- Todo novo pedido grava `retry_block_until` de 120 minutos. Reenvio do mesmo WhatsApp enquanto o pedido está pendente responde `423 REQUEST_RETRY_BLOCKED`, não cria outra solicitação e não gera novo alerta aos Owners.
- A regra dos 120 minutos também vale quando o mesmo número tenta reiniciar o cadastro pelo bot WhatsApp; VPN/IP/navegador novo não zeram o registro porque a chave canônica é o WhatsApp normalizado. Esse prazo é proteção contra **cadastro repetido**, não penalização por senha/credencial errada. O cooldown de 30 minutos é uma regra distinta e só nasce após concluir uma tarefa de Fila.
- Número já ativo em `group_memberships` não abre nova solicitação: responde `409 ALREADY_REGISTERED` com mensagem amigável “Esse número já foi registrado...”.
- Aprovação preserva nome, WhatsApp, grupo, saldos e histórico. A tela de acompanhamento passa a exibir a aprovação sem redirecionar automaticamente.
- Login aprovado resolve o grupo server-side a partir do WhatsApp; não exige que o participante redigite o grupo. Vínculo Owner/manual e prova externa devem continuar semanticamente separados.
- A meta do modo verificado é dupla checagem: aprovação Owner + presença real no grupo informado + confirmação de que pelo menos um Owner configurado é administrador do grupo. Presença/admin nunca devem conceder aprovação sozinhos.

## 4. WhatsApp — arquitetura

### Estado oficial

- O código possui adaptador Meta Cloud API, webhook assinado, outbox persistente, retry/backoff, alertas Owner e sincronização oficial de grupos.
- O dashboard Owner possui a seção `CONFIGURAR BOT SOS YOUTUBE` e um modal persistente com quatro modos: **Meta Oficial**, **Meta + Grupos**, **Evolution Gateway** e **Desativado**. Na UI os rótulos são em português (`ID da conta do WhatsApp Business`, `ID do número do WhatsApp`, `Credencial de acesso da Meta`, `Chave secreta do aplicativo`, `Token de verificação`) e termos técnicos aparecem apenas nas explicações abertas por `?`. A escolha visual usa o estado atual do formulário imediatamente; textos/status não podem continuar descrevendo o modo salvo anterior.
- Segredos informados no modal são criptografados **no servidor** com AES-256-GCM e nunca retornam em texto puro pela API; a UI recebe apenas indicadores configurado/não configurado. Verify Token gerado pelo app é mostrado uma única vez.
- Configuração Meta/WPPConnect salva pelo Owner é aplicada ao runtime correspondente sem exigir reinício; valores do `.env` permanecem como fallback. Evolution Gateway já possui persistência segura e UI próprias, mas seu transporte/eventos ainda precisam de adaptador e validação antes de serem considerados ativos.
- O painel deve deixar explícito, em linguagem amigável, quando a conexão oficial está pendente ou quando a credencial da Meta ainda é necessária; após uma chamada real à Graph API, grava a data da validação e passa a mostrar o estado validado.
- Números Owner podem estar configurados mesmo quando o transporte Meta ainda não está conectado.
- `OWNER_WHATSAPP` dedicado é opcional; na ausência, Rafael é o contato público de fallback.
- Aprovação de participante não gera OTP; após aprovação, nome + WhatsApp bastam no fluxo normal e o grupo é resolvido pelo servidor.

### Provedores

Quatro modos de operação são suportados pelo dashboard:

1. **Meta Oficial** — mensagens e webhooks pela WhatsApp Business Platform.
2. **Meta + Grupos** (valor persistido `META_GROUPS`) — Meta como canal oficial de comunicação + WPPConnect como complemento para grupos tradicionais/membros/admins. Configuração histórica `HYBRID` é migrada automaticamente para `META_GROUPS`.
3. **Evolution Gateway** (valor `EVOLUTION`) — configuração independente de URL, instância e API key da Evolution API. A API key é cifrada com o mesmo mecanismo AES-256-GCM das demais credenciais e nunca retorna em texto puro. A configuração/persistência é real; transporte/eventos Evolution só podem ser marcados como ativos após adaptador e validação próprios.
4. **Desativado** — nenhuma automação externa; dashboard/manual permanece disponível.

- O modo complementar Meta + Grupos deve trazer aviso amigável: usa WhatsApp Web, pode exigir QR, pode quebrar após mudanças do WhatsApp e pode causar restrições na conta; nunca ativar silenciosamente.
- Fábio e Rafael são contas Owner autorizadas para homologar o modo complementar quando houver pareamento explícito; seus números reais continuam somente no ambiente local.
- Não deixar Meta e WPPConnect enviarem a mesma mensagem sem deduplicação/roteamento explícito.
- WPPConnect deve preferencialmente atuar como prova complementar de grupo/admin; Meta continua sendo o transporte oficial sempre que disponível.
- A prova de presença em grupo não deve ser confundida com aprovação Owner.
- O modal e armazenamento de configuração WPPConnect já existem; sessão/QR e verificação real de grupos tradicionais ainda são pendência consciente e não devem ser apresentados como ativos antes do pareamento.

## 5. Credenciais Meta necessárias

Nunca versionar valores. Variáveis previstas:
- `WHATSAPP_PHONE_NUMBER_ID`
- `WHATSAPP_BUSINESS_ACCOUNT_ID`
- `WHATSAPP_ACCESS_TOKEN` (preferir System User)
- `WHATSAPP_APP_SECRET`
- `WHATSAPP_VERIFY_TOKEN`
- `WHATSAPP_OWNER_ALERT_TEMPLATE`
- `WHATSAPP_DECISION_TEMPLATE`
- `WHATSAPP_GRAPH_VERSION`
- URLs públicas HTTPS para webhook/API.

Ações manuais do responsável Meta: login/consentimento, eventual verificação do negócio, verificação do telefone por SMS/voz, obtenção do System User Access Token e aprovação de templates. O restante pode ser preenchido no modal Owner ou configurado via DC quando autorizado. Enquanto o token não existir, o painel deve dizer explicitamente que ele ainda é necessário; depois de salvo, `Validar token/API` consulta a Graph API e grava a data da validação.
## 6. Filas, URLs e persistência

- Internamente o banco usa `rounds`; para o usuário o termo preferido é **Fila**.
- Cada Fila contém exatamente 10 posições sequenciais.
- Cada URL aceita deve ser do YouTube e é salva com autor, grupo e horário.
- Vídeo já utilizado em qualquer Fila anterior ou atual não pode ser salvo novamente.
- Cada URL salva consome 1 moeda.
- Ao completar 10 URLs, a Fila vira READY e uma nova Fila OPEN é criada automaticamente.
- Fechar/atualizar navegador nunca apaga usuários, filas, URLs, moedas, autoria, exportações ou progresso.
- Quem não participou de uma Fila encerrada vê normalmente a Fila OPEN atual.
- Quem participou de uma Fila READY permanece vinculado à tarefa daquela Fila até finalizá-la e não pode contribuir na Fila seguinte.

## 7. Playlist, acompanhamento e conclusão

- Participante da Fila pode criar playlist privada em sua própria conta via OAuth Google/YouTube explícito. A interface oferece **um único CTA “Criar playlist” por usuário/Fila**, no card principal; nunca repetir o botão em cada URL que a mesma pessoa salvou com passes extras.
- Acompanhamento atual usa IFrame Player API: tempo natural, aba visível, grandes saltos ignorados e persistência por usuário/Fila.
- Cada marco consolidado de 10% concede 1 moeda interna, máximo de 10 por Fila; ledger `WATCH_PROGRESS` é idempotente.
- Fechar a janela de acompanhamento apenas pausa; o estado continua salvo.
- Botão `Concluir tarefa` exige confirmação amigável:
  - encerra a tarefa no percentual atual;
  - mantém somente recompensas já alcançadas;
  - não apaga progresso;
  - inicia cooldown persistente de 30 minutos.
- 100% finaliza automaticamente e também inicia cooldown.
- Cooldown é gravado no servidor e espelhado localmente; apagar storage/atualizar não deve burlá-lo.
- Durante cooldown, login responde `423 COOLDOWN_ACTIVE` e a UI exibe contagem regressiva até 00:00.
- Após o prazo, a conta volta ao fluxo normal e pode entrar na Fila OPEN atual.

## 8. Moedas

- Moeda é crédito interno do SOS YouTube; não é saque nem pagamento em dinheiro por visualização.
- Saldo possui origens distintas:
  - promocional/inicial;
  - comprado;
  - recompensa/bônus por tarefa.
- Dashboard Owner deve mostrar total e origem.
- Compra pode conceder passe extra conforme regra vigente; moedas promocionais/recompensas não geram passe.
- Débitos e créditos são persistidos em ledger e devem ser idempotentes.
- **Premissa fixa:** o sistema de moedas virtuais, compra de pacotes, passes, carteira e ledger permanece parte central do produto. Integrações financeiras não substituem nem recalculam esse motor; apenas processam o pagamento externo que pode gerar créditos/passes conforme a regra vigente.

### 8.1 Pagamentos e provedores Pix

- O Owner escolhe **um provedor ativo para novas compras**: Mercado Pago, Asaas, PagBank ou Desativado.
- Trocar o provedor não altera transações antigas. Cada pagamento conserva `provider` e `provider_payment_id` originais e continua sendo conciliado pelo adaptador que o criou.
- Credenciais são salvas server-side em `integration_settings` e cifradas com AES-256-GCM; o navegador recebe somente indicadores configurado/não configurado.
- `Produção` × `Teste/Sandbox` refere-se **à conta/credenciais do provedor**, não ao estado do backend SOS YouTuber. O backend já pode estar online enquanto um provedor financeiro usa sandbox.
- Mercado Pago: Pix por Checkout API + confirmação assinada.
- Asaas: cobrança Pix + QR dinâmico; ao salvar credenciais completas o servidor tenta criar/atualizar o webhook de pagamentos automaticamente.
- PagBank: pedido Pix + URL de notificação; webhook é validado por assinatura sobre o corpo original antes de conciliar.
- Webhooks devem ser idempotentes; eventos Asaas/PagBank usam `payment_webhook_events` para evitar dupla aplicação.
- Receita/Pacotes Pix mensais no Owner contam **qualquer provedor real** aprovado e excluem apenas `DEMO`.
- Em produção sem provedor ativo/configurado, novas compras reais são recusadas; em desenvolvimento, `PAYMENTS_DEV_MODE` mantém o fluxo DEMO existente.
- O popup Pix segue a mesma regra premium: blur no fundo, body travado, scroll interno, rodapé de ações preso ao modal e `?` contextual em termos técnicos. Não usar `header` global dentro desse modal.

## 9. UX Premium ASTRA

- Preservar navy/vermelho/creme, Manrope + DM Sans, cards arredondados, profundidade sutil e boa hierarquia.
- Premium = refinamento e consistência; não trocar identidade sem aprovação.
- Lockup `SOS YOUTUBER` horizontal.
- `Quero participar` usa novamente o botão vermelho simples da identidade original ASTRA. Ele e a ação principal do login mantêm a mesma altura, eixo vertical, raio e tipografia; a diferença de centro vertical medida no desktop deve permanecer ≤1 px. O texto de segurança desce/sobe junto com o botão. Não adicionar gradiente/neon especial sem nova aprovação.
- O bloco “Sem views automáticas / Sem reprodução oculta / Você mantém o controle” é somente textual. Não usar escudo ou outro ícone verde nesse bloco nem no cartão de solicitação. Apenas “Você mantém o controle.” fica em negrito.
- Uma CTA de participação; sem duplicação apelativa.
- “Voltar para tela de login” usa seta e linguagem neutra.
- Erros devem ser explicados em PT-BR; não exibir mensagens nativas em inglês.
- **Owner pode ser extremamente leigo.** Texto principal deve responder “o que é / para que serve / está funcionando?”. Termos como token, webhook, API Key, Access Token, assinatura, Git e WIP ficam atrás de ajuda `?` com explicação simples e, quando útil, instrução de onde obter o dado.
- Todo modal administrativo abre sobre fundo borrado e bloqueia o scroll da página; quem rola é o popup. Essa regra vale para Pix, WhatsApp, participante, ajuda administrativa e gerenciamento de grupo.
- O seletor de mês no Owner exibe PT-BR (`Outubro de 2026`) mesmo que utilize o `input[type=month]` nativo por baixo. Abas mobile centralizam a aba ativa.
- “Painel sincronizado com o servidor” significa apenas atualização dos dados exibidos a cada 10 s. “Conferir versão online” consulta a versão servida; não instala, reinicia, atualiza APIs nem faz deploy. Detalhes Git ficam na ajuda `?`.
- Estados de pendência, tarefa e cooldown devem parecer parte do design ASTRA, não telas técnicas.
- O seletor internacional de telefone nunca pode expandir/quebrar a página: países ficam em viewport interno com rolagem suave e setas ↑/↓; o DDD brasileiro usa trilho horizontal com ‹/›. O viewport DDD mostra exatamente **5 colunas × 3 linhas (15 DDDs completos)** por página visual, sem cards parcialmente cortados, e as setas avançam aproximadamente uma página inteira. Com o seletor DDD aberto, a digitação numérica funciona como busca incremental invisível (`7` → DDDs 7x; `71` → DDD 71), sem campo de busca extra. **A busca digitada permanece aplicada enquanto o popover estiver aberto**; não existe mais timer que apaga `71` após 1,2 s. O E2E espera 1,6 s e exige que DDD 71 continue filtrado. Ambos fecham com `Esc`; o E2E deve falhar se DDI/DDD criarem overflow horizontal no documento.
- O modal `Configurar integração` tem scroll interno próprio, bloqueia o scroll da página ao fundo e responde a `Esc`: primeiro fecha a ajuda contextual aberta e, no próximo `Esc`, fecha o modal. O título do modal não pode usar a tag global `header` nem herdar a barra navy do app; `.astra-modal-title` deve permanecer transparente e com altura natural. O E2E valida o modal também em 1366×768 para impedir sobreposição/overflow. O botão que abre a integração permanece **vermelho ASTRA**, independentemente do modo. Meta Oficial usa azul; Meta + Grupos usa gradiente vaporwave azul/roxo/magenta e mostra Meta + YouTube em metades geométricas 50/50 sem recorte; Evolution Gateway usa navy/índigo próprio; Desativado usa cinza. A composição principal usa superfícies brancas/creme e separadores suaves; os cards-resumo de estado também permanecem brancos, com acento lateral vermelho ASTRA, nunca blocos vermelhos agressivos. `apps/client/src/integration.css`, carregado após `styles.css`, é a skin canônica desta integração e deve impedir que CSS legado volte a dominar o modal. Termos técnicos, campos Meta + Grupos e campos Evolution devem ter ajuda `?` em linguagem leiga.
- Dashboard Owner: pendente usa `Novo Usuário!` verde + `🔴 Registro pendente`; após aprovação, a pendência desaparece e vira `🟢 Usuário aprovado!`, preservando o registro. A área do bot separa **Modo escolhido**, **Chave de acesso** e **Envio automático**. O envio mostra `FUNCIONANDO` somente quando `whatsapp.configured` estiver verdadeiro; caso contrário mostra `PARADO`. Não usar “token/API” como texto principal para Owner leigo; o termo técnico fica na ajuda `?`.
- Aba `Participantes` mostra data/hora e Owner responsável pela aprovação. O nome abre popup administrativo restrito ao Owner com cadastro editável, carteira, compras somente leitura, ledger e ações administrativas auditáveis.
- `Grupos e acesso` cobre virtualmente todos os grupos `1–999` em páginas de carrossel, sem renderizar 999 cards ao mesmo tempo. O painel **não pode chamar um grupo de “ativo” como sinônimo de existir no WhatsApp**. Cada grupo separa: `Habilitado no SOS` (acesso interno), vínculo externo confirmado, provedor de verificação, última prova/sincronização e link de entrada opcional. `whatsapp_group_id` é somente leitura e só vem de integração/prova externa. O Owner pode salvar/remover `join_url`; salvar apenas um link em grupo ainda inexistente não o habilita automaticamente. Há navegação anterior/próxima e salto direto para um número. `Autorização manual excepcional` reutiliza o mesmo seletor internacional de WhatsApp do login e um seletor visual de grupo 1–999; ao autorizar, habilita o grupo escolhido se necessário e grava data/Owner responsável. Os controles `Nome` e `WhatsApp` devem compartilhar o mesmo topo e altura visual de 50 px no desktop; isso é protegido por E2E.

## 10. Gate obrigatório

Antes de checkpoint:
```bash
git diff --check
npm test
npm run lint
npm run build
npm run test:e2e -w @conexao/client
```

Mudança visual deve regenerar/revisar evidências em `docs/evidencias/`.

## 11. Estado validado em 06/10/2026

- Owner alias preservado no JWT/dashboard.
- Cadastro pendente persistente → decisão Owner → mesma tela acompanha o resultado; após todas as verificações necessárias, muda para `Cadastro aprovado` e o usuário escolhe `Voltar ao acesso`.
- Botões Login/Owner alinhados por teste visual.
- Meta: adaptador existe; o Owner possui modal de configuração e validação com dados persistidos no servidor. Sem credencial real da Meta, o painel mantém explícito que a conexão oficial ainda está pendente.
- Contato público usa Rafael como fallback quando `OWNER_WHATSAPP` não existe.
- Filas sequenciais preservadas.
- Duplicata global de vídeo bloqueada.
- Participante de Fila READY bloqueado de nova contribuição até finalizar.
- Conclusão manual e automática persistentes.
- Cooldown de 30 minutos aplicado no servidor.
- Saldo por origem exposto ao dashboard Owner.
- Teste de conclusão manual prova 37% → 3 moedas → cooldown 30 min → liberação após prazo.
- Gate mais recente do WIP `sol/user-premium-20261006` em 07/10/2026: **73/73 API, 10/10 cliente, `git diff --check`, lint/TypeScript, build API + React/PWA e Playwright E2E 1/1** verdes no Inspiron. O E2E cobre DDI/DDD incremental, Owner → participante administrativo → Owner sem falso cooldown de 120 min, badges ADMIN/OWNER, FILA 1, avatar circular, Loja/Pix demo, segunda URL após compra, fila de 10, criação de playlist e acompanhamento.
- O launcher Xubuntu canônico é `scripts/launch-xubuntu.sh`: inicia os serviços quando necessário, abre URL com cache-bust e prefere Firefox explicitamente, usando `xdg-open` somente como fallback. O atalho local deve ser apenas um wrapper para esse script versionado.

## 12. Pendências conscientes

- Parear/implementar a sessão WPPConnect real e sua leitura de grupos/admins; o modal e armazenamento seguro já existem.
- Obter prova real de Owner-admin pelo provedor. Presença no grupo, Owner-admin e aprovação Owner já são estados separados no motor; sem prova de admin a verificação externa não libera acesso.
- Conectar credenciais Meta reais e webhook HTTPS.
- Parear sessão WPPConnect somente após consentimento explícito no dashboard.
- Preview frontend público deve usar o repositório `Fabiomtt2/sosyt` e GitHub Pages em `https://fabiomtt2.github.io/sosyt/`; `VITE_PUBLIC_BASE=/sosyt/` é obrigatório no build Pages.
- A build pública nunca pode cair no `localhost:3333` do visitante. O backend Railway já existe; qualquer build (incluindo Pages) que não receba `VITE_API_URL` público deve apenas informar que **essa publicação** ainda não está conectada ao servidor, sem tentar localhost.
- Backend HTTPS está publicado no Railway em `https://sos-youtuber-api-production.up.railway.app`, com volume persistente para SQLite e healthcheck `/health`. O frontend full-stack está em `https://sos-youtuber-web-production.up.railway.app`. Após o merge desta rodada, ambos foram repontados para `checkpoint de aplicação 65d5b2c` e ficaram `SUCCESS/online`, 1/1 réplica, sem alertas ou falhas; a API respondeu healthcheck 200. GitHub Pages continua sendo frontend estático/PWA.
- Validar Google/YouTube e **cada provedor financeiro escolhido com credenciais reais** antes de declarar produção financeira: Mercado Pago, Asaas ou PagBank. Adaptadores/server-side e testes controlados existem; não afirmar movimentação real sem teste da conta correspondente.
- Políticas de privacidade, termos, retenção/exclusão, backup/restore e observabilidade.

## 13. Infraestrutura e recuperação — 06/10/2026

- Git local canônico no Inspiron: `~/Documents/Codex/2026-10-04/gostar/YouTube Final`. A rodada Owner control plane partiu de `02f3e4b`, passou gate + revisão visual e foi convergida em `main` no checkpoint de aplicação `65d5b2c`. A branch histórica é `sol/owner-control-plane-20261006`.
- GitHub canônico: `Fabiomtt2/sosyt`. O GitHub App do ChatGPT pode continuar somente-leitura/403; no Xubuntu, `gh` está autenticado como `Fabiomtt2` com escopos `repo` e `workflow`, portanto push/checks/merge devem preferir essa rota quando necessário.
- Desktop Commander secundário está operacional no Inspiron e deve ser a rota local preferida enquanto estiver online; não depender da conta antiga sem cota.
- Railway: projeto `SOS YouTuber`, API `sos-youtuber-api-production.up.railway.app`, frontend `sos-youtuber-web-production.up.railway.app`, SQLite persistente em volume. API e Web estão online no canônico `65d5b2c`; API preserva o volume e passou healthcheck 200. Commits posteriores somente de documentação não exigem rebuild do Railway.
- Recuperação Vercel independente: sandbox persistente `sosyt-sol-20261006`, snapshot `snap_Kg3VFafm7lvEcrJXCFXYYeYL9hNs`. O checkpoint Sandbox mais completo era `6b29eb6`; `951bf7b`/`0dccc7d` foram intermediários. Nenhum desses hashes foi publicado no GitHub; a recuperação local atual os supersede e deve ser a fonte para o novo commit canônico.
- Não criar infraestrutura paga para contornar conectores quando houver rota local/gratuita disponível.

## Regra de atualização

Se uma decisão deste arquivo mudar, não apagar silenciosamente a regra anterior: atualizar a seção correspondente, registrar a nova decisão em `PROJECT_STATUS.md` e proteger a mudança com teste quando aplicável.


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

## Convergência ASTRA — 12/10/2026, checkpoint posterior à reancoragem
- Worktree isolada dentro de YouTube Final: .local-tmp/convergencia-claude-20261012, branch astra/convergencia-20261012 @ 8a1962f (27 commits Claude herdados). Original sol/user-premium-20261006 @ 6d09b6f permanece intacto com seu WIP; bot-automations.ts e teste continuam untracked exclusivamente na árvore Claude.
- Integrados seletivamente 9 arquivos de WIP original com resolução dos conflitos App, OwnerDashboard, OwnerDeskMenu, PhoneField, styles. Seleção DDI/DDD ainda exige clique explícito; preenchimento do número e erros preservados.
- Gate anterior à correção atual: API 215 testes, cliente 21, lint e build verdes; visual-convergence E2E 1/1 verde em Chromium 1440/390. Teste comunitário ainda em rerun após adaptar navegação à aba Integrações; NÃO declarar gate total verde.
- Loja Owner: tabela antiga cortava preço e ações no celular e o botão Editar no desktop. Cartões responsivos substituíram a tabela; captura fresca conferida em 390 px, preço, benefícios e ações inteiros; Playwright valida geometria e edição.
- RED operacional descoberto: as flags de bot.ts não são consumidas pelos fluxos de envio. botStatus e UI da aba Bot agora deixam as funções pendentes mesmo com credenciais prontas; texto não promete automação implantada. Meta teste temporário do usuário não equivale a produção do Business. Claude desenvolve automação em sua árvore própria.
- Revisão adicional da Loja: catálogo conforme decisão Fábio/Claude, sem migração que acrescente passes. Totais de compras classificam por benefício efetivo, incluindo COINS_10 e produtos configuráveis.
- Corrigida rota /admin/store/products: o schema descartava imageDataUrl, grantsItem, grantsItemQty e subscriptionDays apesar do formulário. Remoção explícita de arte agora salva NULL. Dashboard participante expõe arte, item e assinatura; Loja apresenta benefícios reais e fallback visual neutro. Testes de banco persistente, rota real e serialização adicionados.
- Gate unitário do checkpoint anterior passou após atualização de expectativas (API 216, cliente 21); houve novas alterações na rota/Loja desde então, portanto repetir gate integral. E2E community está em execução neste momento. Não publicar até passar.
- Railway produção API dddb1c3c/Web 1bf687bd SUCCESS antes desta convergência. Nenhum commit/push/merge/deploy feito nesta worktree até este checkpoint. Próximo: fechar community, gate integral, revisar diffs e capturas, commits lógicos, PR e coordenação de release sem sobrescrever /data.

## Checkpoint commit 57825525e1f9 — 12/10/2026
- fix(auth): preserve complete phone entry and explicit country selection
- Gate do conjunto: API 234/234, cliente 21/21, lint/build GREEN, E2E 4/4 GREEN. Original e árvore Claude preservados.
- Ainda NÃO merge/deploy: corrigir snapshot de item/SUPER nas compras pendentes e validar antes de publicar.

## Checkpoint commit bf06b21af27a — 12/10/2026
- fix(store): persist product benefits and artwork through owner and participant APIs
- Gate do conjunto: API 234/234, cliente 21/21, lint/build GREEN, E2E 4/4 GREEN. Original e árvore Claude preservados.
- Ainda NÃO merge/deploy: corrigir snapshot de item/SUPER nas compras pendentes e validar antes de publicar.

## Checkpoint commit a047f81c955f — 12/10/2026
- feat(ui): converge owner navigation and responsive store presentation
- Gate do conjunto: API 234/234, cliente 21/21, lint/build GREEN, E2E 4/4 GREEN. Original e árvore Claude preservados.
- Ainda NÃO merge/deploy: corrigir snapshot de item/SUPER nas compras pendentes e validar antes de publicar.

## Checkpoint commit 17ca6ee9ba11 — 12/10/2026
- feat(bot): preserve Claude automation catalog and distinguish runtime readiness
- Gate do conjunto: API 234/234, cliente 21/21, lint/build GREEN, E2E 4/4 GREEN. Original e árvore Claude preservados.
- Ainda NÃO merge/deploy: corrigir snapshot de item/SUPER nas compras pendentes e validar antes de publicar.

## Checkpoint commit 30ac52922d64 — 12/10/2026
- test(e2e): verify approved commerce rules and integrated owner panels
- Gate do conjunto: API 234/234, cliente 21/21, lint/build GREEN, E2E 4/4 GREEN. Original e árvore Claude preservados.
- Ainda NÃO merge/deploy: corrigir snapshot de item/SUPER nas compras pendentes e validar antes de publicar.

## Última proteção de compra — snapshot e backup — WIP posterior a 30ac529
- Source atual preserva a decisão de catálogo do commit Claude 1d8b50d, confirmada por Fábio em 12/10. Sem restauração de passe/seed.
- Pagamentos novos guardam product_benefits_json (item, quantidade, dias SUPER) na criação do Pix; settlement usa o retrato da compra, não o catálogo editado depois. Moedas/passes já eram registrados no pagamento.
- Migração aditiva captura benefícios das compras antigas pendentes/rejeitadas uma única vez, identificada como LEGACY_AT_MIGRATION. Não altera saldo nem marca pagamento como aprovado.
- Em produção, server.ts faz backup consistente do SQLite antes desta migração quando a coluna ainda não existe. Backup privado em pasta backups ao lado do banco; se o backup falhar, startup para antes de migrar. Migração compatível com rollback de código.
- Três regressões novas: edição/ocultação de Pular durante Pix; alteração de dias SUPER e replay; upgrade de SQLite antigo com backup preservado e backfill idempotente. Gate final3 em execução; ainda não publicar este WIP.
- Snapshots CLI não usados: railway não está instalado no PATH deste DC. Publicação planejada via conector Railway existente, retirando pin antigo 65d5b2c depois do merge auditado em main. Fontes API/Web serão staged no mesmo environment, conferidas antes de accept-deploy.

## Compra protegida — commit fc811bad3006f404addc9e931331e2033d9e4166
- Gate final3 GREEN: API 237/237, cliente 21/21, lint, build e E2E 4/4. Snapshot de benefícios e backup pré-migração testados.
- Próximo: push/PR/merge e retirada coordenada do pin antigo Railway, com observação dos dois deploys e do backup no /data.

## Merge confirmado — 12/10/2026
- PR #2 MERGED: https://github.com/Fabiomtt2/sosyt/pull/2
- Local main == GitHub main == b684f236ebf50766b02aacabedc122c82c9111b1. Worktree de convergência avançada por fast-forward; original sol/user-premium e WIP preservados.
- Ainda não afirmar deploy: próximo stage de source API/Web no Railway, retirando pin 65d5b2c, verificar backup e SUCCESS.

## Railway — source staged e revisada — 12/10/2026
- Patch d1be5c2e-d014-4ee2-bfab-9f295ea61286: somente source API/Web, main Fabiomtt2/sosyt, removendo pin 65d5b2c. Sem volume, variáveis ou rede alterados; destructive=false.
- Release de código b684f236ebf50766b02aacabedc122c82c9111b1, PR #2 merged. Gate 237 API/21 cliente/4 E2E e lint/build GREEN.
- Aplicação autorizada pela missão de merge/publicação; ainda aguardar SUCCESS e confirmação do backup/smoke.

## Publicação bloqueada pelo conector — 12/10/2026
- GitHub PR #2 MERGED; release de código b684f236ebf50766b02aacabedc122c82c9111b1. Gate final: API 237/237, cliente 21/21, E2E 4/4, lint/build/diff GREEN.
- Consulta após interrupção confirmou patch d1be5c2e-d014-4ee2-bfab-9f295ea61286 ainda STAGED, somente fontes API/Web; nenhum novo deploy.
- accept-deploy devolveu exatamente: “Cancelled — the user did not approve this action. No changes were made.” Não contornar ou repetir sem confirmação.
- Produção segue Online/SUCCESS 1/1 em cada serviço: API dddb1c3c-44b1-4ab6-be04-35b3a9b90de3; Web 1bf687bd-4bd6-41f5-bd4d-b472fc6f4f6c. Volume da API permanece conectado. Backup/migração novos ainda NÃO confirmados em produção.
- Próximo: confirmar publicação, reler staged/status, aplicar uma vez, observar SUCCESS, confirmar backup e smoke público. Não usar redeploy do build antigo.


## Retomada factual — 18/10/2026, rodada de publicação do bot
- Fonte editável: cofre Claude, branch auditoria/hybrid-plus-convergencia. Worktree antiga preservada sem sobreposição.
- Commits locais: 2d2e1b3 (runtime integrado, autenticação/admissão e relay humano) e 027b1f7 (mensagens longas e pausa do atendimento). Ainda não publicados neste checkpoint.
- Gate consolidado atual: API 663/663, cliente 36/36, lint e build completos verdes; diff sem erros. E2E 12/14: compra excedeu estabilidade/rolagem em 15s na máquina de pouca memória; banner dependia de índice inicial apesar do autoplay. Reexecução focada em andamento, sem clique forçado.
- Atendimento humano permanece na conversa do BOT: operador configurado responde com RESPONDER ID texto; usuário pode VOLTAR AO BOT. Não exige migrar para conversa humana separada. Arquivos de mídia ainda exigem descrição em texto, explicitamente informada.
- Evolution verificado open; bot com permissão administrativa nos dois grupos pareados. Consulta agregada de grupos 500; fallback restrito aos grupos pareados foi implementado e testado. Nenhum replay em massa de outbox.
- Produção ainda precisa receber API e Web coordenadas, seguida de health com oito capacidades, confirmação do backup consistente e testes reais SELF/HUMAN com recibos. Testes sintéticos não comprovam recebimento real.
- Pendências posteriores continuam explícitas: integração de Passe/filas durante cooldown, amigos/bloqueios e presentes com origem, painel de atendimento, 12 faixas visuais e revisão visual completa. Preintro LaunchFlash existe como arquivo isolado, não integrado e fora desta publicação urgente. Não declarar sistema 100% concluído.


## Publicação do backend confirmada — 18/10/2026
- GitHub main avançou sem force para 027b1f7c2f19632dbea2b215cc01bddf349db991. Fonte Railway continua Fabiomtt2/sosyt@main, sem pin.
- API deployment 9ffd980e-1707-4f9d-8b78-ee3ba7b94654 SUCCESS. Health público HTTP200, release bot-convergencia-20261018 e oito capacidades confirmadas.
- Backup pré-migração confirmado no log: /data/backups/pre-bot-runtime-1792342312839-92bb6c21-ab41-4e1d-bf6c-439964f85c1c.sqlite. Volume preservado.
- Login Root real renovado HTTP200. Testes administrativos SELF e HUMAN: HTTP202, depois SENT com providerConfirmed=true, sem envio direto ou bypass dos freios. HUMAN abre ticket administrativo; resposta real do operador ainda não comprovada.
- Evolution open e webhook habilitado no backend, com autenticação configurada, foram conferidos nesta retomada.
- Gate: API 663/663, cliente 36/36, lint/build completos verdes. E2E consolidado anterior 12/14; os dois casos corrigidos passaram em reexecuções focadas (compras e cenário completo community). Portanto os 14 cenários têm aprovação acumulada; não foi uma nova execução única 14/14.
- Cenário community isolou o modo legado DEV depois de explorar Evolution; autoplay não determina mais o frame inicial; ações limitadas a 30s e expectativas a 15s nessa auditoria longa com capturas na máquina de 4GB. Retorno ao Owner exige também HTTP200 do overview. Nenhuma asserção funcional removida ou clique forçado.
- Cliente de produção ainda precisa avançar para os commits de frontend. Pré-intro e demais pendências funcionais/visuais continuam fora desta publicação urgente.


## API + Web publicadas e smoke público — 18/10/2026
- Web af25a7e1-505c-45e1-8409-8f89dab629fe SUCCESS, fonte 6fda9d5e6656f71993b7b3be3d01630611ad6852. Log confirmou verificação das capacidades da API antes de expor o cliente.
- API permanece 9ffd980e-1707-4f9d-8b78-ee3ba7b94654 SUCCESS, fonte 027b1f7. O código apps/api é idêntico entre esse commit e 6fda9d5; commits posteriores acrescentaram cliente, testes e documentação. Sem necessidade de reconstruir a API por alterações exclusivas de docs.
- Smoke real via Chromium na URL pública PASS: senha padrão; modo Evolution sem atalho de chave Meta; cadastro abre o contato público correto do bot; mobile sem overflow; nenhum pageerror. Capturas públicas desktop/mobile abertas visualmente e mantidas em pasta privada ignorada, fora do commit.
- Testes reais SELF e HUMAN SENT, providerConfirmed=true. Isso confirma aceite pelo transporte, não leitura humana. Ida e volta humana ainda depende de resposta real do operador ao ticket administrativo recebido.
- Lint completo reexecutado após os ajustes finais, EXIT0; diff check limpo. Chaves/sessões e screenshots excluídas do staged.
- Este marco encerra a publicação urgente do bot. Próxima frente: integrar correções preparadas de filas/Passe/cooldown, amigos/bloqueio/presentes e painel; depois pré-intro e convergência visual. Não confundir essas pendências com funcionalidades publicadas.
