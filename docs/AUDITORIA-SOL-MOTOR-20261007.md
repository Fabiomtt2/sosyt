# AUDITORIA SOL — MOTOR / BACKEND — 07/10/2026

## Papel desta rodada
Sol assumiu temporariamente o papel reservado ao Claude: auditor independente de motor/backend, segurança e consistência. A árvore ASTRA atual foi preservada antes de qualquer edição em `.local-tmp/sol-motor-entry-*` com patches staged/unstaged, tar dos arquivos WIP e hashes.

## Reancoragem
- Local canônico: `~/Documents/Codex/2026-10-04/gostar/YouTube Final`
- Branch: `sol/user-premium-20261006`
- HEAD/origin/main: `c0b8172`
- GitHub: `Fabiomtt2/sosyt`, main em `c0b8172`
- Railway production: API/WEB live; ainda não contém esta WIP.
- Nenhuma sessão Desktop Commander concorrente estava ativa no início da auditoria.

## P0 confirmado — watch-progress/recompensa
O motor atual recebe do navegador `watchedSeconds[10]` + `durations[10]`, calcula percentual e concede 1 moeda por 10%.

Problemas:
1. o servidor confia em vetores arbitrários do cliente para recompensa;
2. o protocolo não atende à regra mais recente: **1 moeda por 20 minutos reais acumulados entre sessões e filas**;
3. múltiplas abas/sessões podem disputar o mesmo progresso;
4. porcentagem e recompensa estão indevidamente acopladas;
5. deduplicação de trechos não é representada no servidor;
6. histórico antigo precisa ser preservado sem ser convertido em “tempo verificado” inventado.

## Arquitetura aprovada para implementação
- percentual continua como métrica de progresso/conclusão;
- recompensa deixa de depender de percentual;
- cliente envia observações pequenas do player, não vetores premiáveis;
- servidor usa seu próprio relógio para limitar segundos aceitos;
- saltos para frente não geram tempo;
- playback rate é considerado para converter mídia avançada em tempo real;
- intervalos de mídia observados são unidos/deduplicados por vídeo;
- uma única sessão ativa por usuário evita dupla contagem em abas concorrentes;
- tempo elegível acumula globalmente por usuário, atravessando sessões e filas;
- cada 1.200 s aceitos gera 1 moeda via ledger idempotente novo;
- lançamentos históricos `WATCH_PROGRESS` permanecem intactos;
- motor novo usa ledger separado `WATCH_TIME`, sem reclassificar moedas antigas;
- tempo novo começa em 0: não inferir minutos históricos a partir de percentuais antigos.

## Critérios de teste
- primeira observação apenas ancora, não credita;
- delta aceito nunca excede relógio do servidor;
- seek/salto grande credita 0;
- trecho já observado não credita de novo;
- sessão concorrente ativa credita 0;
- takeover só após sessão anterior ficar stale;
- 1.199 s = 0 moeda; 1.200 s = 1 moeda; 2.400 s = 2 moedas;
- reload/nova fila continua o acumulador global;
- requests repetidos não duplicam ledger;
- `WATCH_PROGRESS` histórico permanece no banco e na carteira;
- finalização/abandono preservam o progresso já consolidado.

## Demais achados relevantes
- ASTRA fechou CORS PUT/PATCH/DELETE e o avatar 17 passou E2E real.
- ASTRA adicionou autenticação por chave WhatsApp/Google alternativa e corrigiu elevação ROOT.
- O gate completo da rodada ASTRA ainda precisa ser refeito após qualquer mudança deste motor.

## Resultado da implementação P0
Motor server-time implementado e validado. Gate final desta rodada: API 93/93, cliente 10/10, lint/TS, build e Playwright 2/2 GREEN. O endpoint legado continua apenas como compatibilidade de percentual, explicitamente sem novas recompensas. A UI foi atualizada para explicar 1 moeda por 20 minutos reais verificados.

## Curadoria / fechamento de fila
Encontrado padrão menos robusto: carteira era incrementada antes do `INSERT OR IGNORE` de CURATION_REWARD. Corrigido para ledger-first, carteira somente quando `changes===1`. Teste adversarial novo GREEN; API 94/94. `settlePayment()` foi revisado e já é transacional/idempotente pelo ledger PIX_PURCHASE, portanto não foi alterado sem necessidade.

## Segurança de identidade
P1 de privacidade identificado: rota pública legada permitia distinguir telefone já cadastrado e devolvia `groupCode`. Como o fluxo de produção novo já usa chave WhatsApp, a rota foi restrita a `AUTH_DEV_MODE` e o grupo deixou de ser exposto. Também foi adicionado teste explícito de revogação dinâmica ADMIN_OWNER. API 95/95 GREEN.


### ASTRA — Business e revisão do motor Sol — 07/10/2026 13:46 Bahia
Business +5571993978956 centralizado, persistido e editável em todos os modos do painel; propagação sem hardcode no frontend. Troca de identidade de remetente exige confirmação de correspondência na Meta, sem alterar telefones dos Owners. Campo/ajuda/edição/reload/wa.me validados E2E desktop/mobile; captura business-numero-mobile.png inspecionada. Intro sem montagem de imagem/carrossel. Botão de contato na solicitação resolve número do servidor a cada 10 s e ao recuperar foco.
Antes da revisão do watch: API 103/103, client 10/10, lint/build GREEN, E2E 3/3 GREEN. Dois REDs adicionais foram reproduzidos por ASTRA no motor Sol: (1) 100% legado provocava finalização automática na primeira observação, (2) intervalo após amostra pausada podia ser creditado. Correção aplicada: estado anterior active persistido, cobertura de intervalos dos dez vídeos para conclusão, percentuais sem arredondar antecipadamente para 100 e UI deixa de somar reprodução local repetida. Os 6 testes watch-time passaram após correção; acrescentada cobertura do encerramento natural. Novo gate em andamento. Nenhum commit/push/merge/deploy.
