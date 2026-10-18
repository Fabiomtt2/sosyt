# Incidente de acesso e bot — 2026-10-18T00:40:16.563441-03:00

## Estado confirmado antes da publicação
- Fonte: cofre Claude, branch auditoria/hybrid-plus-convergencia, base publicada 6b35c3b.
- API publicada: deployment 193be243-cf74-45b3-bab0-21485ab6eeda SUCCESS.
- Integração maior permanece WIP; não confundir validação parcial com publicação.
- Relato real de Fábio prevalece sobre testes sintéticos anteriores.

## Causas reproduzidas e corrigidas no WIP
- Cliente convertia erro 403 de senha em nova solicitação manual; senha não era o fluxo inicial.
- Dashboard e alteração de senha exigiam grupo após login válido, criando outro bloqueio de onboarding.
- Telefone brasileiro PN sem nono dígito diferia da forma digitada; resolver preserva conta exata e não mescla linhas.
- DECLINED interceptava comandos; WAITING_NAME interceptava opções do menu; palavra Continuar virava nome.
- Cadastro automático para membro já presente prometia senha sem preparar a conta imediatamente.
- Entrada no grupo era considerada DONE por HTTP200 sem verificar status interno nem presença real.
- Descoberta agregada Evolution retorna 500 intermitente; fallback só usa grupos previamente pareados, sem revogação em massa.
- UI de integração ainda descrevia Evolution como não implementado e não expunha papéis bot/humano.

## Contratos
- Senha válida permite abrir dashboard e trocar a própria senha antes da adesão.
- Dashboard groupAccess distingue MEMBER/JOINING/INVITED/NEEDS_SUPPORT.
- Mutação/entrada em filas continua protegida pelo vínculo real com grupo.
- Confirmação de grupo requer leitura de participantes; LID nunca é telefone.
- Senhas continuam cifradas na outbox e somente hash na credencial.
- Root continua separado de níveis/prêmios; eventos reais alimentam notificações e outbox única.
- Human support é configuração persistida separada do telefone do bot.
- Nenhuma chave ou telefone pessoal deve ser incluído neste relatório ou nos commits.

## Validação pendente
- Executar suíte completa, lint, build e E2E consolidado.
- Confirmar backup consistente antes das tabelas novas em produção.
- Publicar API e Web coordenadas; conferir SUCCESS e estado real Evolution.
- Teste real de entrega autorizado exclusivamente para Root; diferenciar queued e receipt.
- Ainda não certificar fluxo real de outra pessoa sem comprovação de recebimento e login.

## Atualização de incidente — 18/10/2026

- Produção permanece 6b35c3b na API; Web anterior. WIP desta rodada ainda não publicado.
- Suíte API/cliente, lint e build passaram antes dos acréscimos de relay humano e comandos personalizados.
- E2E consolidado anterior: 7/14; três respostas HTTP corretas não refletiram em UI no prazo sob servidor Vite DEV. Reexecução usa bundle de produção, sem aumentar prazo das expectativas.
- Quatro contratos E2E históricos corrigidos: modo Meta explicitamente selecionado, copy/senha vigente, fase de animação controlada, capturas sem animação. Ainda requerem reexecução.
- Novo atendimento humano: ticket persistente, RESPONDER/ENCERRAR somente do número humano configurado; usuário continua na conversa original do bot e pode VOLTAR AO BOT. Testes escritos, execução pendente.
- Não declarar 100% ou publicado antes de verificar os dois deployments e recibos reais.


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
