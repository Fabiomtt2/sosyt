# Conexão Youtube

Webapp/PWA para participantes aprovados dos grupos SOS YOUTUBER montarem ciclos globais de 10 vídeos e criarem, voluntariamente, uma playlist privada na própria conta Google. Android/Capacitor está preservado; APK permanece fora desta consolidação.

## Fluxo implementado

- Uma única tela de login usa nome, WhatsApp com código do país e grupo SOS YOUTUBER de 1 a 99. O backend identifica automaticamente se o cadastro corresponde a participante ou Owner; `#` permanece apenas como detalhe interno da API e nunca é exibido na interface.
- `Quero participar!` registra solicitação no painel. Com `OWNER_WHATSAPP` configurado, abre uma conversa WhatsApp com mensagem preenchida; o usuário confirma o envio. A Cloud API pode responder e alertar os Owners quando as credenciais/templates Meta estiverem configurados.
- A associação ao grupo SOS YOUTUBER é automatizada quando a Groups API oficial expõe grupos elegíveis: o worker reconhece `SOS YOUTUBER N`, sincroniza participantes e webhooks de entrada/saída atualizam o acesso. Grupos que a Meta não expõe permanecem disponíveis para conferência Owner.
- Todos os grupos veem o mesmo quadro persistente, com URL, autor, grupo e horário de cada contribuição. Apenas o próximo espaço pode ser preenchido; URL e autoria histórica ficam permanentes no ciclo.
- Só URLs estruturais do YouTube são aceitas. Com `YOUTUBE_API_KEY`, o servidor também consulta a API para confirmar existência/acessibilidade.
- Cada usuário começa com 10 créditos. Salvar custa 1; a primeira contribuição de cada ciclo usa o direito-base. Uma compra confirmada de R$20 concede 20 créditos e 1 passe adicional. Créditos promocionais/recompensas não geram passes.
- Ao completar 10 links, o ciclo fica pronto, um novo ciclo abre e cada participante distinto recebe 1 crédito interno de curadoria. Participantes do ciclo podem conferir os 10 registros e acionar `Criar playlist`. Depois da criação, o acompanhamento de reprodução consolida 1 moeda interna a cada 10% de progresso, até 10 por usuário/ciclo, sem duplicar marcos já creditados.
- Antes do OAuth, um modal informa que o usuário será levado à autenticação oficial Google/YouTube e que a playlist será criada como privada. A criação é explícita e voluntária.
- Painel Owner: aprova/revoga números, gerencia grupos, lista usuários/compras, exporta CSV, acompanha solicitações, ciclos, playlists, Pix e situação da fila WhatsApp.

## Executar no computador

Requer Node 22 ou superior. Dentro desta pasta:

```sh
npm install --legacy-peer-deps --cache .npm-cache
node scripts/setup-local.mjs
npm run dev
```

Abra http://localhost:5173. O script local cria segredos separados para `OWNER_FABIO_SECRET` e `OWNER_RAFAEL_SECRET` e preserva configuração já existente. Os nomes padrão são `Fabio0` e `Rafael0`; ambos usam `#` como marcador/palavra-chave de Owner. O telefone configurado para cada Owner é a identidade de login e deve permanecer apenas no `.env` local. Nunca publique o `.env`.

Em desenvolvimento, `AUTH_DEV_MODE=true` mostra o OTP na interface e `PAYMENTS_DEV_MODE=true` permite Pix DEMO sem movimentação financeira. Em produção esses modos são recusados pelo carregador de configuração. Para entrega real de OTP e automação de atendimento, configure a Cloud API Meta conforme `docs/WHATSAPP-INTEGRACAO.md`.

A API lê o `.env` da raiz e mantém o banco em `apps/api/data/conexao-youtube.db`. O cliente usa `VITE_API_URL=http://localhost:3333` por padrão.

## Verificação

```sh
npm test
npm run lint
npm run build
npm run test:e2e --workspace apps/client
```

Na consolidação final de 05/10/2026: 56 testes de API, 5 testes do cliente, TypeScript, build React/PWA e 1 cenário Playwright ponta a ponta passaram. As capturas fictícias ficam em `docs/evidencias`.

## Integrações e limites atuais

Google OAuth/YouTube Data API, Mercado Pago e WhatsApp Cloud API possuem adaptadores e testes controlados, mas ainda exigem credenciais e validação real. Sem `YOUTUBE_API_KEY`, a validação do link é estrutural. Sem credenciais Meta, não há entrega real de OTP/bot.

A automação de grupos está implementada para a Groups API oficial: descoberta por nome `SOS YOUTUBER N`, sincronização de participantes, webhook de entrada/saída e fallback manual. A ativação real depende de a conta Meta e os grupos existentes serem elegíveis e retornados pela API.

O acompanhamento de reprodução após a playlist ser criada usa a IFrame Player API: o percentual avança com reprodução natural e aba visível, ignora saltos grandes e é sincronizado por conta/ciclo. Cada 10% consolidado gera 1 moeda interna de capacidade de contribuição, até 10 por playlist/ciclo; o ledger impede duplicação. Essas moedas não têm saque ou conversão em dinheiro. O percentual exibido durante `Criar playlist` continua sendo apenas o progresso técnico de inclusão dos 10 itens.

Antes de produção ainda faltam: validação real dos provedores, reconciliação de pagamentos órfãos/estornos, migração de eventuais telefones legados para a forma canônica internacional, política de privacidade/termos e exclusão/retenção de dados, monitoramento e revisão operacional. Consulte `PROJECT_STATUS.md`, `docs/ESPECIFICACAO-CANONICA-YOUTUBE-FINAL-20261005.md`, `docs/ARQUITETURA.md` e `docs/WHATSAPP-INTEGRACAO.md`.
