# Convergência funcional — 18/10/2026

## Fonte e preservação
A integração atual está no cofre Claude, branch auditoria/hybrid-plus-convergencia:
~/AUDITORIA-CLAUDE-SOSYT/01-ESPELHO/trabalho.
A árvore YouTube Final/.local-tmp/convergencia-claude-20261012 permanece preservada,
com funcionalidades e artes ainda não portadas. Não copiar a árvore por cima.

## Estado verificável deste checkpoint
- Backend local commit 2d2e1b3: 659 testes API e 36 cliente passaram; lint/build passaram.
- Frontend e complemento de atendimento humano continuam em validação.
- E2E consolidado: 11/14; três falhas diagnosticadas e corrigidas, reexecução pendente.
- Produção ainda API 6b35c3b e Web anterior. Não afirmar publicação do WIP.

## Atendimento humano: contrato confirmado por Fábio
A pessoa continua na conversa original do BOT. O atendente autorizado responde através
do BOT, com identificação de equipe humana. O número humano configurado identifica
o operador; não é um convite para o usuário abrir uma segunda conversa.
O relay persiste chamado, permite responder/encerrar e retomar o bot. O painel deve
refletir configuração, responsáveis e estado real. Anexos não devem ser anunciados
como encaminhados sem implementação e confirmação desse transporte.

## Lacunas atuais confirmadas
| Área | Estado |
|---|---|
| Conta e senha antes do grupo | Backend corrigido; cliente novo em validação |
| LID e prova real de grupo | Telefone convertido na entrada; DONE exige presença real |
| Ranking, XP, carteira no bot | Consultas usam motores persistidos; sem novo crédito |
| Eventos e agendamentos | Outbox única, freios Evolution; runGroupPlan não religado |
| Humano na conversa do bot | Relay implementado; diagnóstico/pause/texto longo em revisão |
| Passe e cooldown | Source ainda não tem nova fila por Passe; bloqueio global persiste |
| Numeração de filas | Source ainda compacta todas; portar regra de reutilização seletiva |
| Amigos | Módulos canônicos ainda não integrados: custo 1, aceite 0, pendência e bloqueio |
| Presentes | Source só debita recompensa; falta origem comprada com auditoria correta |
| Carteira e loja | Falta SUPER no resumo e SUPER primeiro na loja |
| Root e atendimento | Falta caixa de chamados e trilha de ações humanas |
| Moderação | Falta motivo e auditoria por ação |
| Visual | Pré-intro 1,9s escrita sem wiring; 12 faixas e artes finais ainda em revisão |

## Auditorias desta rodada
Três personas executaram revisão delimitada, com achados e limites nos arquivos:
- AUDITORIA-PERSONA-PARTICIPANTE-20261018.md
- AUDITORIA-PERSONA-OWNER-20261018.md
- AUDITORIA-PERSONA-CURIOSA-20261018.md

Capturas de fixtures sintéticas foram abertas. Capturas antigas foram separadas
das evidências atuais. Nenhum teste ou exame parcial certifica o sistema inteiro.

## Próxima operação
Concluir validação do hotfix, commits temáticos, push da branch e fast-forward seguro
de main, publicação coordenada API/Web, backup consistente e smoke público.
Depois continuar porte seletivo dos módulos pendentes e inspeção página por página.
Autorização de Fábio para esse fluxo já foi dada; não pedir confirmação genérica.
