# Operação do bot — rodada de 18/10/2026

## Atendimento na mesma conversa

A pessoa continua falando com o número do bot. Ao pedir atendimento humano, o servidor abre um ticket e avisa o telefone humano configurado em Integrações → WhatsApp. O operador responde ao bot com `RESPONDER ID texto`; a resposta chega à conversa original, identificada como equipe humana. `ENCERRAR ID` encerra o atendimento. A pessoa pode enviar `VOLTAR AO BOT` para retomar o menu.

O telefone do operador autoriza essas ações; conhecer o ID de um ticket não autoriza uma terceira pessoa a responder. Alterar o número do atendimento pelo painel altera o operador autorizado, sem trocar o número público do bot. Pausar a função de atendimento humano impede encaminhamentos nos dois sentidos. Mensagens longas devem ser divididas em trechos de até 3.000 caracteres. Arquivos de mídia ainda precisam de descrição em texto; a interface não promete que o arquivo foi encaminhado.

## Cadastro, senha e grupo

A senha recebida do bot permite entrar na conta e alterar a própria senha. A entrada no grupo é acompanhada separadamente. Estar cadastrado não comprova presença em grupo; participar de filas exige o vínculo real. A admissão só termina depois da consulta de participantes confirmar a presença. Se a entrada automática não for possível, o estado deve indicar convite ou necessidade de suporte.

Identidades WhatsApp LID não são telefones. As portas de entrada usam o telefone alternativo enviado pelo provedor; identificadores LID nunca viram contas ou números do sistema.

## Automação e limites

O processo da API executa os agendamentos e processa a outbox no servidor, sem depender do computador de Fábio aberto. A sessão Evolution deve continuar pareada. Reiniciar o serviço não deve duplicar eventos: as referências de origem, entregas e relógios persistem no SQLite.

Toda mensagem passa pela outbox única e pelos freios do Evolution. Não executar `runGroupPlan`, não reenviar a outbox em massa e não contornar cadência, aquecimento, silêncio noturno ou breaker de sessão. Bom dia e boa noite usam as janelas configuradas; um teste fora da janela não justifica antecipar mensagens reais para grupos.

Os comandos de ranking, nível, carteira e filas consultam o estado atual da conta. Consultar não concede XP ou moedas. Root permanece fora da competição. Despacho global manual exige ativação e confirmação próprias; não se ativa para testar mensagens individuais.

## Conferência após publicação

- API e Web precisam terminar SUCCESS no Railway, com a fonte correta.
- Health da API precisa anunciar as oito capacidades da rodada, incluindo `human-relay-v1` e `bot-live-progress-v1`.
- Confirmar registro do backup consistente anterior à migração e volume `/data` preservado.
- Confirmar sessão Evolution `open`, webhook habilitado no backend e autenticação do retorno.
- Testes administrativos SELF e HUMAN usam referência única e destinatários fixos. Verificar recibo: queued significa apenas enfileirado; SENT com ID do provedor confirma aceite pelo transporte, sem provar leitura humana.
- Um teste humano administrativo abre um ticket de teste identificável. A confirmação de ida e volta exige uma resposta real do operador autorizado.

Este documento descreve os contratos implementados. Não certifica publicação ou teste real antes do registro correspondente nos checkpoints.
