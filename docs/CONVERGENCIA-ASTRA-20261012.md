# Convergência ASTRA / Claude — 12/10/2026

## Decisão atual do usuário

Fábio confirmou em 12/10/2026, 14:10 Bahia, que a mudança de catálogo feita com Claude foi deliberada. As ofertas antigas com passe bônus não devem ser restauradas. A tentativa de restauração feita nesta auditoria foi retirada antes de commit/deploy; a cópia intermediária está em .local-tmp/catalogo-antes-correcao-usuario. Nenhum banco de produção foi alterado.

O seed e LAUDO-16 do Claude mostram COINS_10 de R$20, 10 moedas e zero passes; SKIP_1 separado; SUPER_30 por R$45. Catálogo persistido/editado pelo Owner prevalece sobre defaults de código.

## Âncoras preservadas

- Original YouTube Final: sol/user-premium-20261006 @ 6d09b6f + WIP preservado.
- Convergência: .local-tmp/convergencia-claude-20261012, astra/convergencia-20261012 @ 8a1962f + WIP revisado. Herda os 27 commits Claude.
- Fonte Claude: AUDITORIA-CLAUDE-SOSYT/01-ESPELHO/trabalho @ 8a1962f, sem alterações nossas.
- GitHub main ainda c0b8172 na última consulta; PR #1 ainda em rascunho @ 6d09b6f. Reconsultar antes do push/merge.
- Railway consultado nesta retomada: API dddb1c3c e Web 1bf687bd SUCCESS, 1/1 Online, zero ocorrências e zero trabalho pendente. API conserva volume. Nenhuma publicação feita por esta convergência.

## Integração encontrada e correções

| Área | Ligação real | Resultado da auditoria |
|---|---|---|
| Telefone | PhoneField → normalização → autenticação/identidade/associação de grupo | DDI/DDD/subscriber separados, seleção explícita preservada, erros não apagam os campos |
| Owner | guards server-side → painel e participante administrativo | Fábio/Rafael continuam ROOT; permissões de ADMIN preservadas |
| Loja | painel → rota ROOT → store_products → dashboard → modal participante | Corrigido schema que descartava arte/item/assinatura; corrigida serialização que descartava estes dados no dashboard |
| Arte | upload compacto → image_data_url → Loja | Arte chega ao participante; remoção explícita apaga a arte no servidor; omissão de campo conserva a arte existente |
| Compra | catálogo server-side → snapshot de pagamento → settlement/ledger | Preço/benefícios continuam definidos no servidor; moedas não concedem passe automaticamente |
| Indicadores | pagamentos confirmados → perfil/Owner | Classificação por benefício efetivo inclui produtos configuráveis, em vez de depender apenas de códigos legados |
| Visual | cartões Loja Owner + modal Loja participante | Preço e ações deixam de ser cortados; modal acima do chat; zero opcional removido dos benefícios; tipografia com espaçamento mais legível |

## Preparação do bot: respeitar a decisão de manter este trabalho em aberto

O usuário confirma que o teste com número temporário Meta passou. Isto é evidência do fluxo de API testado, sem exigir refazê-lo ou inventar credenciais do número definitivo.

A implementação existente de WhatsApp contém outbox durável, OTP, alerta a Owners, decisão de cadastro, verificação de assinatura, recebimento de nome e pendência no painel. Ela utiliza as configurações WhatsApp efetivas e o número Business persistido.

O painel novo bot.ts guarda modos e preferências. Seus controles ainda não são consumidos pelos fluxos acima. A UI diferencia configuração de execução enquanto a ligação é concluída; nenhuma preferência foi descartada. O transporte Evolution e os eventos periódicos ainda precisam de conexão/integração. Não duplicar o trabalho ativo do Claude.

Incorporados sem modificar o original:
- bot-automations.ts: catálogo puro de 19 eventos, mensagens e placeholders. SHA256 03a55cf53e0b796142f9b51eb2dd171376793da83be56b977dd7fd304a94b683.
- bot-automations.test.ts: SHA256 bbdc90d091bcb4573d73c12711dfe5d3271a0d46fa98cb1f7d9ec8d89a6a4bec.

Próxima integração: conectar as preferências e mensagens persistidas aos eventos reais de cadastro/filas/recompensas, usando a outbox/idempotência existente, e finalizar o transporte de grupos. Eventos de XP ficam pendentes até existir a camada de gamificação. Não declarar eventos periódicos agendados apenas por constarem no catálogo.

## Evidências e gate

- npm test atual: API 237/237 e cliente 21/21 GREEN.
- TypeScript e build finais GREEN.
- E2E completo final3 4/4 GREEN: Business persistente, cenário comunitário, chave WhatsApp e painéis novos. Compra de moedas sem passe e contribuição de outra pessoa verificadas.
- scripts/e2e-youtube-fixture.mjs simula somente a fronteira externa YouTube para a API de teste isolada. Importação exige NODE_ENV=test e a chave sintética específica; o aplicativo e launchers de produção não o importam.
- E2E visual valida preços/ações em 1440/390, edição real do produto e acesso aos painéis.
- Captura participante-loja-compra-mobile.png e teste elementFromPoint comprovam compra acima do chat. Capturas finais refeitas após o último ajuste visual.
- Não realizar merge/deploy antes de gate completo e revisão dos diffs.

## Última proteção de compra — snapshot e backup — WIP posterior a 30ac529
- Source atual preserva a decisão de catálogo do commit Claude 1d8b50d, confirmada por Fábio em 12/10. Sem restauração de passe/seed.
- Pagamentos novos guardam product_benefits_json (item, quantidade, dias SUPER) na criação do Pix; settlement usa o retrato da compra, não o catálogo editado depois. Moedas/passes já eram registrados no pagamento.
- Migração aditiva captura benefícios das compras antigas pendentes/rejeitadas uma única vez, identificada como LEGACY_AT_MIGRATION. Não altera saldo nem marca pagamento como aprovado.
- Em produção, server.ts faz backup consistente do SQLite antes desta migração quando a coluna ainda não existe. Backup privado em pasta backups ao lado do banco; se o backup falhar, startup para antes de migrar. Migração compatível com rollback de código.
- Três regressões novas: edição/ocultação de Pular durante Pix; alteração de dias SUPER e replay; upgrade de SQLite antigo com backup preservado e backfill idempotente. Gate final3 em execução; ainda não publicar este WIP.
- Snapshots CLI não usados: railway não está instalado no PATH deste DC. Publicação planejada via conector Railway existente, retirando pin antigo 65d5b2c depois do merge auditado em main. Fontes API/Web serão staged no mesmo environment, conferidas antes de accept-deploy.

## Compra protegida — commit fc811bad3006f404addc9e931331e2033d9e4166
- Gate final3 GREEN: API 237/237, cliente 21/21, lint, build e E2E 4/4. Snapshot de benefícios e backup pré-migração testados.
- Próximo: push/PR/merge e retirada coordenada do pin antigo Railway, com observação dos dois deploys e do backup no /data.
