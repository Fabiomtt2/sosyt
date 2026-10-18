# Auditoria — participante bughunter — 18/10/2026

Escopo: leitura do cofre Claude, branch auditoria/hybrid-plus-convergencia, WIP atual. Sem ataques à produção, sem mensagens externas, sem mudanças no banco e sem execução paralela de navegador/teste pesado. Não representa certificação da produção nem de toda a interface.

## Achados comprovados

1. **Amigos e bloqueio ainda ausentes nesta fonte (prioridade alta).** Não há social.ts, rotas /friends ou /community. Correio aceita mensagens por identificador; global-chat lista mensagens sem filtro de bloqueio individual. Falta o contrato pedido: convite pendente por perfil/WhatsApp exato, 1 moeda para solicitar, aceite gratuito, notificação, remover amizade e bloquear interações inclusive sala global. Reproduzir em fixture: abrir duas contas, tentar solicitar amizade e bloquear; não há operação disponível. Correção mínima: convergir o módulo social preservado no WIP canônico com débito transacional idempotente e aplicar bloqueio tanto em envio quanto em leituras, mantendo ranks/filas visíveis. Não duplicar a implementação antiga.

2. **Doação limitada a recompensa (alta).** POST /gamification/gift-coins chama giftRewardCoins; a função atualiza somente wallets.reward_millis. Conta com saldo comprado e nenhuma recompensa não consegue presentear, contrariando a regra vigente. A função já protege quantidade, saldo e referência repetida: preservar essas garantias. Correção mínima: convergir transferências com origem purchased/reward no ledger, uma quantidade única na interface e nenhuma nova receita reconhecida no recebimento.

3. **Inventário incompleto visualmente (média).** Imagem docs/evidencias/commerce-items-390.png aberta efetivamente pelo DC: resumo mostra moedas, passes e Pular, sem quarto estado SUPER/expiração. Pular ainda usa composição de cartões, não a ilustração final pedida. Trata-se de captura sintética existente; não certifica a versão após alterações futuras. Correção: componente único de quatro itens com estado ativo/inativo e vencimento, arte real na loja.

4. **Atendimento humano existe agora como relay persistente, mas requer operação humana explícita.** bot-human-relay.ts mantém o participante na conversa original do bot e encaminha mensagens ao número humano configurado. Só esse número pode RESPONDER/ENCERRAR; mudança de configuração revoga o anterior e VOLTAR AO BOT encerra o chamado. Não é ingresso de um terceiro número no chat privado do WhatsApp. A pessoa atendente responde via comandos no seu próprio chat com o bot. Isso satisfaz a conversa contínua para o participante, mas falta comprovar a experiência real e torná-la clara no painel. Não prometer automação da própria resposta humana. Sugestão: caixa de atendimento com assumir/responder/encerrar e recibo real, reutilizando o mesmo ticket/outbox.

## Garantias observadas na fonte

- Entrada participante exige sessão com identidade e prova; permissão administrativa é revalidada no servidor.
- Grupo pendente permite dashboard e troca da própria senha, sem liberar ingresso em filas.
- Mensagens de chat são texto puro, links restritos a staff, cooldown/mute/remoção aplicados pelo servidor.
- Correio de conversa filtra participante remetente/destinatário; não foi identificado acesso horizontal simples pelo otherId na leitura.
- Presente de recompensa usa transação, débito condicional e referência idempotente.
- Relay impede resposta por terceiro mesmo conhecendo ID; não trata LID como identidade.

## Hipóteses que exigem teste focado

- Reciclagem da sessão após troca/reemissão de senha: verificar se sessões já emitidas precisam ser revogadas por versão de credencial; o guard observado valida identidade, não versão do hash.
- Ticket humano longo/áudio/anexo: limite global de 500 caracteres e resposta genérica de mídia são aplicados antes do relay. Participante que envia relato longo ou áudio pode achar que falou com a pessoa, mas conteúdo não chega a ela. Definir comportamento explícito e seguro antes de ampliar o suporte.
- Picos de fila: não certificar ausência de corrida somente por testes de unidade; verificar ingresso/consumo simultâneo e idempotência usando banco sintético.

## Próximo bloco recomendado

Primeiro finalizar gate/deploy do incidente; depois convergir amizade/bloqueio e origem de presentes preservados no WIP canônico, com testes HTTP de duas sessões. Em seguida, caixa de atendimento real e inventário de quatro itens. Não reabrir auditorias históricas nem repetir os três gaps de numeração/PASSE/cooldown já reportados pela coordenação.

Nenhum teste novo foi executado por esta persona: a janela pesada estava reservada ao E2E consolidado da coordenação. Achados de fonte estão separados de hipóteses e evidência visual.
