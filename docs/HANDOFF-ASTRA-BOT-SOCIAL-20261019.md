# Continuidade — bot, comunidade e filas — 19/10/2026 UTC

## Âncora e preservação
Cofre existente: ~/AUDITORIA-CLAUDE-SOSYT/01-ESPELHO/trabalho. Branch auditoria/hybrid-plus-convergencia, HEAD f4d91ac antes desta publicação. A árvore antiga convergencia-claude-20261012 permanece preservada. Não criar clone/worktree; não reset/clean/stash nem sobrescrever árvores. Screenshots e segredos ficam fora dos commits.

## Produção antes da rodada
API 9ffd980e-1707-4f9d-8b78-ee3ba7b94654 e Web af25a7e1-505c-45e1-8409-8f89dab629fe SUCCESS, 1/1. Release bot-convergencia-20261018. Esta rodada ainda era WIP quando este checkpoint foi escrito; resultados de publicação devem ser acrescentados abaixo. Rootlogin200, saudações habilitadas ALL_GROUPS. Diagnóstico real: uma GOOD_NIGHT SENT, outra PENDING EVOLUTION_GROUP_DAILY_CAP. Não era apenas configuração de público. Grupo12 configurado sem vínculo externo; não é grupo real descoberto.

## Regras explícitas mais recentes
- Grupo real com menor número e vaga recebe primeiro: 1 vazio é elegível; 1 cheio →2; 1/2 cheios→3 somente se real e disponível. Cadastro com telefone provado no inbound enfileira inclusão antes de login. Privacidade externa pode exigir convite; presença só é aprovada após confirmação.
- Todos concluíram: fila sai das ativas, lacuna1 é reutilizada; com1/2/3,3 pode ocupar1 sem deslocar2. Todas filas ativas são descobríveis, acesso pessoal segue Passe/Pular/participação.
- Validade72h desde criação, sem renovar por uploads/retries. Expiração fecha a fila e cria substituta quando necessário, conservando URLs, progresso e trilhas. Nunca deletar ledger.
- Abandono voluntário aplica60min uma vez. Login não apaga intervalo nem bloqueia outras filas já liberadas. Retomar fila original após prazo conserva progresso e não gera crédito duplicado; Passe/Pular mantém alternativa paga.
- Playlist parcial exige confirmação explícita, snapshot individual fixo, XP por observação verificada e zero moedas dessa seleção. Playlist completa mantém recompensas aprovadas.
- Amizade: convite1moeda, aceite0, recusar/remover/bloquear. Direct exige amizade aceita OU consentimento gratuito separado. Bloqueio simétrico em DM/global/presentes, sem esconder filas/ranks/WhatsApp.

## Integrações WIP concluídas na fonte
Bot: relay aceita código curto+texto/aspas e comando legado, prefixo Admin:, suporte com/sem acento, prioridadeDM, status real atualizado no envio e barrasemoji. Cadência8–20s, fanout45min, warmup/breaker/silêncio/teto preservados. Espaço das saudações reservado DENTRO do teto. Não religar runGroupPlan.
Owner: nomes comuns podem ser ADMIN_OWNER sem virarRoot; suspensão de conta independente de membership, auditável e respeitada no bot/senha/grupos/OAuth/API; Root protegido. SUPER procura usuário por nome/telefone/ID real. Painel comunitárioRoot ligado.
Cliente: correio/amigos/pedidos/notificações/inventário, Launcher composto, chatglobal limitado, feedback de compra/troca,4itens, SUPERprimeiro, categorias de avatar por tier, preview clássico80px sem inventar HD. Pré-intro1.9s sobreIndex, redução de movimento. Carrossel3voltas+fade/colapso. Artes raster reais de SUPER/Pular/Passe e nova ampulheta.
Filas: acesso independente, Passe atômicoUUID, Pular com dedupe porintenção, saída preservaURL, revalidação antes/depois de awaitGoogle/YouTube. BackupSQLite WAL consistente antes das tabelas aditivas; APIantesWeb pelo verify-api-release.

## Validação até este checkpoint
- Suite completa API793/793 +cliente36/36 verdes: .local-tmp/release-final-test.log.
- Lint completo e build completo passaram na rodada (logs release-final-lint/build).
- Novas regras finais: recuperação58/58; política42/43 inicial com um pressuposto errado no teste de retornoqueued (não duplicava registros), corrigido com prova COUNT4; scheduler11/11 final. Nomesdegrupo7, reservaquota4 e HTTP72h cobertos nos focados.
- E2E completo20cenários iniciado PID469838, .local-tmp/release-final-e2e.log. Não rodar segundo browser. CachePlaywright absoluto da árvore antiga. Conferir resultado e abrir screenshots novas antes de certificar visual.
- Não confundir testes de transporte com leitura/resposta humana real. Primeiro release comprovou SELF/HUMAN providerSENT; novo relay tem testesHTTP, retorno real do Rafael ainda exige observação.

## Dependências e pendências verdadeiras
Google OAuth de produção não configurado (auth/options googleConfigured=false); API agora informa isso claramente. ChaveYouTube de validação não substitui clientID/clientsecret. Pix depende credenciaisMercadoPago +assinatura webhook; guia no painel. Não afirmar pagamentos reais ou playlistGoogle online antes dessa configuração.
Ver docs/PENDENCIAS-INTEGRACAO-20261019.md para lacunas restantes do relato, sem reiniciar auditorias históricas.

## Retomada e gates finais — 19/10 UTC
Fonte permanece f4d91ac+WIP. Nova suíte completa: API802/802 e cliente36/36; lint e build passaram. E2E20 iniciado no PID472482, logs release-gates-*-final2. Primeiro cenário acesso/chat/moderação passou. As duas falhas anteriores eram corrida do teste antes do POST de moderação e recibo que desaparecia após6.5s; teste aguarda resposta e recibo agora permanece até fechar/abrir inventário. Nenhuma publicação nova comprovada ainda. Capturas da loja390px abertas: artes raster, preços e ações legíveis; não certificam todoOwner.

## Gates e achados visuais posteriores
Final2: API802/802 +cliente36/36, lint/build verdes. E2E20 terminou13pass,3fail,4nãoexecutados (16.7min). Commerce: clique realizou abertura, espera de navegação15s esgotou; orçamento30s. Community monolítico:360s totais esgotaram no campoURL após muitas telas; agora600s, sem removerasserts. Premium: REDreal de CSS, leitura456px porque max-height:none!important anulava360px; regra antiga removida, paineldesktop limitado650px, teste360preservado. Evidências preservadas em .local-tmp/release-final2-browser-results.
Rodada final3 foi interrompida somente na árvore do PID478280 durante build, antes do E2E, para ligar emblemas. Nenhum app pessoal encerrado. Rodada vigente PID479160, logs release-gates-*-final4: lint, cliente, APIfocados, build, sete cenários faltantes/falhos, sequencial. Não abrir segundo browser.
Inspeção real: loja390/1440 arteslegíveis; Ownerdesktop legível mas abaslongas e cartõesantigos ainda pedemrefino; intro390frames900e1550ms mostram marca correta eIndexportrás. Intro4testespassaram; cenários senha401/403/pendência/convite/Evolution passaram.
Achado de integração adicional: 12artes/rotaAPIexistiam, LevelBadge ainda5SVGs. Agora hook usa catálogo do servidor uma vez (sem duplicar faixas), imagens reais, Rootsemnível, compact32px. Prancha .local-tmp/level-emblems-32-48-current.png aberta: progressão discreta broto→coroa. E2Egamificação agora exige imagem nível30carregada. Isso exige conferir gatesfinal4; não herdar certificação antiga.
Texto padrão antigo do PASS_SINGLE atualizado somente por igualdadeexata; descriçõescustomizadas e preços/quantidades preservados. Ainda nenhumcommit/push/deploy desta rodada.

## Commit local de backend
Backend validado registrado em fcc8b2f (64arquivos,3049adições223remoções). Branch auditoria/hybrid-plus-convergencia; remoto/main ainda f4d91ac, nenhumpush novo. API802tests completos anteriores+16focados após descriçãoPasse; lint completo e buildfinal4 verdes, cliente38/38. Pipeline479160 continua somenteE2Esete pendentes/falhos. Cliente/assets/testes/docs aindaWIPstaged+unstaged. Não publicarAPIisoladamente muito antes do cliente: nova políticaDMprecisa da interface de consentimento.

## Cliente registrado e CI de branch
Cliente registrado localmente756c852. Inclui emblemas reais via catálogo público, sem duplicar thresholds, com teste de contrato2/2 e38/38 totalcliente. ConflitoCSS removido preservando teste360px; imagemchat ampliada32px. Workflowvalidation.yml adicionado para execução isolada de npmtest/lint/build/E2E, sem deploy. Nenhum segredo é usado; fixtures não enviamWhatsAppreal nem cobramPix. A branch será enviada para completar validação, main ficaintacta. E2Elocalfinal4 ainda rodando;6cenários selecionados, não7: falta visual-convergence além de repetiraccess apósCSS.
