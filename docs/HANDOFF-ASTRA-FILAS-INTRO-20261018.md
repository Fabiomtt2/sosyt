# Checkpoint — filas, inventário e pré-intro — 18/10/2026

## Marco publicado e comprovado
- Fonte editável é o cofre Claude existente em /home/ubuntu-desktop-bootstrap-ubuntu-/AUDITORIA-CLAUDE-SOSYT/01-ESPELHO/trabalho; branch auditoria/hybrid-plus-convergencia. HEAD e GitHub main/branch f4d91ac no início desta segunda rodada. Não criar clone/worktree nem alterar árvore antiga.
- API deployment 9ffd980e-1707-4f9d-8b78-ee3ba7b94654 SUCCESS, commit027b1f7. Web af25a7e1-505c-45e1-8409-8f89dab629fe SUCCESS, commit6fda9d5. Backend idêntico atéf4d91ac.
- Health público release bot-convergencia-20261018, oito capacidades. Backup pré-bot-runtime no /data confirmado. Evolutionopen/webhookbackendautenticadoconfirmados.
- LoginRoot200. Testes reais SELF/HUMAN enviados pela outbox normal: SENT e providerConfirmed=true. Não prova leitura ou resposta humana. Smoke Chromium público desktop/mobile passou e capturas foram abertas. Sessão administrativa pode expirar; credencial verificada permanece no arquivo privado canônico, nunca expor.

## WIP desta segunda rodada — ainda não publicado
- queues.ts: renumeração seletiva3→1semalterar2; closed/finalized guard; sem bootstrapFREE no alvo pago; reentrada preserva histórico. currentRoundFor limita ingressoFREE durante intervalo, exceção administrativa explícita apenas no servidor.
- pass-queue.ts/active-access.ts portados seletivamente; tabela queue_pass_requests aditiva, reciboUUID e consumo atômico. Novo backup WAL consistente antes desta migração, com teste de quick_check/permissão/idempotência.
- app.ts: conta/grupo ativos sem bloqueio global de cooldown; login por senha/DEV/setup e Google durante intervalo; PASS e saída por HTTP; apenas ingressoFREE novo respeita30min. Finalização não apaga outros acessos. Abandonar outra fila não limpa intervalo existente.
- Pular consumia referência porfila/usuário: nova intenção agora usaUUID; retries reutilizamrecibo, nova reentrada paga outra unidade.
- OAuth/export revalidam identidade/grupo/admin e tarefa ativa antes/depois de awaits. helperYouTube tem beforeRequest antes de cada requisição externa; uma requisição já em voo não pode ser desfeita, mas não inicia outra após revogação.
- Cliente mantémdashboard após concluir; seletor Passe/Pular/saída com confirmação e retries; Root abre como administrador sem inventário fictício.
- InventoryOverview compartilhado em carteira/correio/loja, quatro itens e SUPERstatus/expiração real. SUPERprimeiro, preços/quantidades/descriçõesOwnerpreservados. CópiaPasse explica nova fila OU contribuiçãoextra.
- LaunchFlash integrado só no ramo público com Index já montada,1.9s, uma vez/aba, semsom e com redução de movimento. Quadros visuais ainda aguardam execução/abertura nesta rodada.
- Health WIP planeja release filas-comunidade-20261018 e maisduascapacidades queue-pass-v1/independent-queue-access-v1. Script frontend agora exigeessas capacidades; publicar APIantesWeb. Produção ainda temsomenteas8anteriores.

## Validação real
- npmtest consolidado: API709/709 e cliente36/36 verdes (.local-tmp/queue-full-test2.log). Posteriormente só metadados health/capacidades e copy/seletores de E2E foram ajustados, sem alterar o motor.
- Cliente36/36 reexecutado, lint completo e build completo EXIT0 após os últimos ajustes.
- Antes disso,18falhas históricas eram fixtures sem adesão ou contratos de cooldown/navegação antigos; fixtures e assertivas foram corrigidas, sem afrouxar tempo/ledger/segurança. Não reintroduzir bootstrapFREE/globalcooldown para satisfazer esses testes.
- E2E focado iniciado PID390742: intro-flash(4),queue-continuity(1),commerce-feedback(1),premium-community(1). Log .local-tmp/queue-visual-focused.log. Não iniciar outro browser/teste pesado simultâneo. PLAYWRIGHT_BROWSERS_PATH absoluto usa o cache da worktree canônica antiga.
- Ainda pendente: resultadoE2Efocado, abrir frames e capturas; suíteE2Ecompleta19cenários; revisão/stage/commits/push/merge/deploy desta segunda rodada e novo smoke.

## Preservação e próximos blocos
- Nenhum commit desta segunda rodada. Screenshots modificadas ficam fora dos commits, assim como arquivos privados/sessões/chaves.
- Três agentes concluíram raias isoladas: guardas/YouTube, testesparticipante, frontend/intro/inventário. Nenhum deles publicou.
- Não repetir auditoria histórica. Amigos1moeda/aceitegrátis/bloqueio, presentes pororigem e painel social ainda precisam integração seletiva do código canônico.
- Descoberta atual: fonte do cofre já contém12emblemas e12arquivos em apps/api/assets/level-emblems; não gerar duplicatas pelo handoff antigo de6. Falta conferir a aparência corrente de cada faixa. SUPER/Pular ainda usam CommerceArtworkCSS; artes raster reais continuam pendentes. AvatarLightbox está embutido em AvatarModal.tsx, não existe arquivo AvatarLightbox.tsx.
