# Arquitetura e regras de domínio

## Componentes

- `apps/client`: React + Vite + PWA + Capacitor. O mesmo código atende navegador e Android.
- `apps/api`: Fastify + SQLite no MVP. Centraliza autenticação, quadro, carteira, pagamentos e integrações Google.
- Produção: substituir SQLite por PostgreSQL mantendo transações e restrições únicas equivalentes.

## Fluxo do ciclo

1. Sempre existe um ciclo `OPEN`.
2. Há 10 posições visíveis; só a próxima posição vazia fica disponível.
3. A primeira contribuição de um usuário no ciclo usa seu direito-base.
4. Uma contribuição adicional do mesmo usuário consome um passe proveniente de compra aprovada.
5. Cada gravação custa 1 crédito e é atômica com a ocupação da posição.
6. Ao ocupar a posição 10, o ciclo vira `READY`, cada participante distinto recebe uma recompensa interna de 1 crédito, e um novo ciclo `OPEN` é criado.
7. Participantes de um ciclo pronto podem conectar a própria conta Google e criar uma playlist privada. A ação é explícita e idempotente por usuário/ciclo.

## Saldos

- `promo`: 10 créditos iniciais.
- `purchased`: créditos originados de pagamento aprovado.
- `reward`: recompensas internas de curadoria.
- `extraSlotPasses`: direito separado; saldo natural nunca gera passe.

O débito usa primeiro `promo`, depois `reward`, depois `purchased`.

## Segurança e privacidade

- JWT curto/renovação ainda precisa ser endurecido para produção.
- Códigos OTP são armazenados apenas como hash e expiram.
- Refresh tokens do Google são cifrados com AES-256-GCM.
- CPF e e-mail usados no pagamento são enviados ao PSP e não ficam gravados no banco local.
- Webhooks Pix não são aceitos como prova de pagamento: a API consulta o pagamento no provedor com credencial do servidor antes de creditar a carteira.
- Telefone é dado pessoal; produção exige consentimento, retenção mínima e exclusão sob solicitação.

## Conformidade YouTube

O app não registra nem recompensa watch time, não inicia reprodução automaticamente e não tenta manter o player em segundo plano. A exportação usa OAuth individual e é iniciada claramente pelo usuário. A playlist nasce privada para reduzir risco de spam; o usuário pode gerenciar sua visibilidade no YouTube.

