# Estado verificável — YouTube Final, 2026-10-05

## Âncora

Repositório isolado em `/home/ubuntu-desktop-bootstrap-ubuntu-/Documents/Codex/2026-10-04/gostar/YouTube Final`, criado a partir do WIP auditado de `Conexão Youtube`. A pasta de origem não foi alterada durante a consolidação. Esta cópia preserva o histórico Git e o WIP funcional; não herdou o `.env` da origem nem caches/SDKs pesados. Depois da consolidação, recebeu um `.env` local próprio, ignorado pelo Git. Não há remote configurado.

Base histórica: `0f09c7b`. Primeiro checkpoint isolado validado: `ae26bf1` (`feat: consolidate audited YouTube Final integration`). A rodada atual parte desse checkpoint.

O `.env` local permanece ignorado pelo Git e contém os identificadores reais dos Owners. O identificador literal de Rafael0 foi preservado para login, mas seu campo de contato WhatsApp de alertas permanece vazio enquanto não houver um celular completo válido para entrega.

## Produto consolidado

- Quadro global com 10 posições sequenciais, URL permanente, autor, grupo e horário.
- Rejeição de URL não-YouTube e validação externa opcional por YouTube Data API.
- Owners independentes `Fabio0`/`Rafael0` usando `#`, identificadores/segredos separados e JWT com purpose/audience próprios.
- Solicitação de participação via web/WhatsApp, painel de pendências, aprovação/revogação manual e fila WhatsApp persistente.
- Adaptador Cloud API Meta com verificação de webhook, HMAC, deduplicação, retentativa e alertas aos Owners.
- 10 créditos iniciais; débito por contribuição; compra de R$20 = 20 créditos + 1 passe; ledger/idempotência e bloqueio após estorno.
- OAuth Google individual, playlist privada, consentimento explícito, trava de exportação e recuperação de exportação parcial.
- Recompensa atual é de curadoria ao fechar o ciclo, não por watch time. Após a criação da playlist, há acompanhamento local informativo via IFrame Player API, sem vínculo com carteira.

## Verificação executada antes do checkpoint

- `git diff --check`: aprovado.
- Testes API: 49/49.
- Testes cliente: 5/5.
- `npm run lint`: aprovado.
- `npm run build`: aprovado.
- Playwright E2E: 1/1 aprovado.
- `npm audit` e `npm audit --omit=dev`: 0 vulnerabilidades reportadas.
- SQLite local: `integrity_check=ok`, 0 violações de foreign key e 0 inconsistências detectadas nas verificações de rounds, slots, vídeos, carteiras e ledger.
- API local e web local retornaram HTTP 200 na árvore de origem auditada.

## Decisões canônicas da consolidação

1. `#` identifica o fluxo Owner, mas não concede privilégio por si só. Credencial de servidor continua obrigatória.
2. O quadro é global entre grupos SOS YOUTUBER.
3. Só participantes de um ciclo READY podem criar sua playlist daquele ciclo.
4. Ação de YouTube é explícita e autorizada pelo usuário.
5. Não implementar recompensa por assistir, OCR da tela, espelhamento/QtScrcpy para provar visualização ou background playback ligado a recompensas.
6. O percentual de criação mede inclusão dos 10 itens. Separadamente, o monitor de reprodução pode exibir percentual informativo calculado pelo player oficial, sem alterar moedas.
7. Pertencimento ao grupo WhatsApp só será automatizado após comprovação de elegibilidade/API oficial para os grupos existentes; até lá, confirmação pelo Owner.
8. Integrações externas só podem ser chamadas “reais” depois de teste com credenciais e ambiente do provedor.

## Pendências antes de produção

- Política de privacidade, termos, consentimento e processo de exclusão/retenção de dados.
- Teste real Meta WhatsApp, Google/YouTube e Mercado Pago.
- Reconciliação de pagamento criado remotamente sem `provider_payment_id` persistido localmente.
- Telefones de participantes já são canonizados para `55 + DDD + 9 dígitos`; revisar/migrar eventuais registros legados antes de produção.
- Ferramenta administrativa para resolver `payment_hold`.
- Observabilidade, backup, restauração e implantação.
- Se houver múltiplas instâncias de API, substituir/adequar SQLite e coordenação de locks.
- Validar, com conta elegível e documentação oficial, qualquer futura integração de grupos WhatsApp.

Ver `docs/ESPECIFICACAO-CANONICA-YOUTUBE-FINAL-20261005.md` para o confronto requisito por requisito.
