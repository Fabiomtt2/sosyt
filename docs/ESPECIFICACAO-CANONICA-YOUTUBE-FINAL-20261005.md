# Decisões de produto e convergência — YouTube Final

Este arquivo substitui o uso anterior de “especificação canônica” como fonte unilateral. A fonte histórica é `docs/AUDITORIA-ASTRA-20261005.md`; as decisões abaixo foram confirmadas pelo usuário durante o merge.

## Regras confirmadas

| Tema | Decisão |
| --- | --- |
| Owners | `Fabio0` e `Rafael0`, contas independentes |
| Owner marker | `#` no campo/palavra-chave; não concede privilégio sem credencial |
| Telefone Owner | formato brasileiro com `+55`, DDD, `[9]` e hífen; valores reais só no `.env` |
| Quadro | global entre grupos SOS YOUTUBER |
| Ciclo | 10 URLs sequenciais e permanentes, com autoria/grupo/horário |
| YouTube | somente links aceitos; playlist após ciclo completo; OAuth individual |
| Progresso | player oficial, aba visível, continuidade local+servidor, proteção contra regressão e saltos grandes |
| Moedas por progresso | 10% consolidado = +1 moeda interna; máximo 10 por usuário/ciclo; apenas delta novo |
| Natureza das moedas | crédito virtual de controle de capacidade de Save/contribuição; sem saque |
| WhatsApp bot | manter acolhimento, coleta de nome, pendência, alertas, OTP e resposta automática após decisão |
| Grupos | automatizar com Groups API oficial e webhooks quando elegível; fallback Owner para grupos não expostos |
| Governança | auditar ASTRA antes de merge, preservar WIP, divergência volta ao usuário, RED pode ser corrigido |

## Fluxo de progresso e moedas

O acompanhamento é iniciado pelo usuário depois da criação da playlist. O cliente usa a IFrame Player API e acumula progresso por item somente durante reprodução natural. O servidor mantém o maior progresso já consolidado e não aceita regressão lógica.

Os marcos são 10, 20, 30, …, 100%. Cada marco cria no máximo uma entrada de ledger `WATCH_PROGRESS` de 1 moeda. Repetir a mesma sincronização, fechar/reabrir o popup ou enviar um percentual menor não gera crédito extra.

O popup mostra percentual, moedas correspondentes e saldo sincronizado. Ao fechar, o dashboard é recarregado.

## Fluxo automatizado de grupo WhatsApp

Quando a Groups API oficial está habilitada:
1. o worker lista grupos ativos do número Business;
2. subjects no formato `SOS YOUTUBER N` são associados automaticamente ao código N;
3. detalhes do grupo fornecem participantes e sincronizam `group_memberships`;
4. `group_participants_update` atualiza entrada/saída em tempo real;
5. login usa a mesma `group_memberships`, portanto não existe bypass por digitar um número de grupo;
6. o Owner pode disparar sync imediato no painel.

Se a Meta não expuser um grupo existente ou a conta não for elegível, o sistema não inventa o vínculo: aquele grupo continua `OWNER_VERIFIED`.

## Histórico de divergência

Durante a primeira consolidação, documentação criada pelo agente transformou algumas pendências ASTRA em decisões canônicas sem validação suficiente. Isso foi identificado na autoauditoria. `AGENTS.md` agora exige classificação de divergências e retorno ao usuário antes de mudanças de regra.
