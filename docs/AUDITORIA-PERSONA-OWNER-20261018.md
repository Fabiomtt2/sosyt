# Auditoria da persona Owner — 18/10/2026

Escopo: leitura do WIP no cofre Claude; Root, automações, transporte, atendimento humano e moderação. Nenhuma mutação em produção, envio externo, ataque, suíte ou navegador adicional. Não certifica deploy. Segredos e contatos reais omitidos.

## Evidência visual aberta

A captura sintética atual docs/evidencias/room-admin-after-1440.png foi aberta como imagem. Sala com leitura clara, mensagens administrativas diferenciadas, acesso à moderação e creme/ameixa coerentes. A captura mostra dashboard com sala, não configurações do bot. Não certifica todas as abas Owner. Área vazia proporcional à pouca atividade da fixture não foi classificada como defeito.

## Achados comprovados por código

### 1. Teste humano usa aviso antigo, não relay — prioridade alta

POST /admin/bot/test-message target HUMAN, em owner.ts, usa humanHandoffAlert, helper com link para conversa direta externa. Fluxo real novo usa openHumanRelay e RESPONDER/ENCERRAR. Um recibo verde desse teste prova aviso operacional, sem provar resposta humana pelo bot à conversa original.

Recomendação: mesmo helper de ticket, texto claramente identificado como teste, origem Root autenticada, destino humano configurado e deduplicação atual. Patch preparado somente em .local-tmp/owner-human-relay-test.patch, não aplicado nem testado. Testes propostos: ticket único, RESPONDER, ausência de wa.me, resposta retornando à origem Root.

### 2. Tickets sem caixa operacional no painel — prioridade alta

bot_support_tickets só é referido pelo helper e testes. Não há endpoint administrativo de listagem/consulta nem painel de tickets. Tabela contém identidade, estado e datas; não operador atribuído nem histórico próprio de mensagens. Autorização pelo número humano atual existe e trocar número revoga o antigo.

Impacto: atendimento pode acontecer pelo WhatsApp, mas Owner não descobre chamados, mede espera ou revisa encerramentos pelo painel. Não corresponde a gerenciamento integrado completo.

Recomendação: caixa Root com estado, última atividade, assumir/encerrar justificados e histórico restrito. Reutilizar outbox e freios; não criar transporte paralelo. Reter conteúdo com política explícita e sem segredos.

### 3. Moderação sem justificativa nem autoria auditável — prioridade alta

owner.ts nas rotas de excluir/fixar/limpar/moderar chat recebe alvo/ação; não motivo nem grava trilha de moderação. global-chat.ts funções adminMute/adminSetCooldown/adminRemoveFromRoom e inversas só atualizam estado.

Impacto: não é possível reconstruir ação com ator, motivo, antes/depois. Histórico de edição de automações não cobre moderação.

Recomendação: motivo obrigatório em punições/limpeza e registro append-only com ator autenticado, alvo, ação, antes/depois e horário. Aplicar hierarquia ao alvo, com testes negativos.

### 4. Humano não recebe anexos nem textos longos — prioridade média

whatsapp.ts trata mídia e textos acima de 500 caracteres antes de routeHumanRelay. Usuário com ticket aberto envia captura de erro: recebe resposta de mídia do bot, sem encaminhamento ao atendente. Prova estática, sem envio real.

Recomendação: informar limitação na abertura ou implementar repasse seguro com tipos/tamanho e retenção. Não prometer encaminhamento de anexo antes de existir.

### 5. HUMAN_HANDOFF desligado não pausa ticket existente — decisão de produto

routeHumanRelay ocorre antes de featureEnabled(HUMAN_HANDOFF). Desligar impede novas aberturas, mantém relay em tickets já abertos. Pode ser continuidade desejável, porém painel deve dizer que o controle trata novos chamados, ou separar abertura de pausa operacional. Não alterar silenciosamente conversa em andamento.

## Controles presentes

- Resposta humana somente do número configurado, com alias brasileiro.
- Ticket desconhecido/encerrado recusa resposta; terceiro não recebe identidade do participante.
- VOLTAR AO BOT e encerramento restauram fluxo automático.
- Teste restrito a Root/humano configurado, UUID e intervalo por tipo.
- Integrações/automações exigem Root; broadcast exige função e evento ativos.
- Runtime distingue fila de recibo; PIN indisponível é declarado.
- Evolution valida identidade real da sessão, sem tratar LID como telefone.

## Limites

Não houve teste de entrega externa. E2E principal em curso. Priorizar achados 1–3 e validar contratos e captura real do painel antes da publicação. Patch é proposta, não código validado.
