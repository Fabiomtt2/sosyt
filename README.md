# Conexão Youtube

Webapp/PWA para participantes aprovados dos grupos SOS YOUTUBER montarem ciclos globais de 10 vídeos e criarem, voluntariamente, uma playlist privada na própria conta Google. Android/Capacitor está preservado; APK permanece fora desta consolidação.

## Fluxo implementado

- Uma tela de login: participante usa nome, celular brasileiro e grupo aprovado; Owners `Fabio0` e `Rafael0` usam nome, WhatsApp no formato `+55 DD [9]XXXX-XXXX` (espaço após `[9]` também aceito), marcador/palavra-chave `#` e credencial exclusiva.
- `Quero participar!` registra solicitação no painel. Com `OWNER_WHATSAPP` configurado, abre uma conversa WhatsApp com mensagem preenchida; o usuário confirma o envio. A Cloud API pode responder e alertar os Owners quando as credenciais/templates Meta estiverem configurados.
- A conferência de pertencimento ao grupo SOS YOUTUBER permanece administrativa até existir comprovação de que a conta/grupos atuais são elegíveis para automação oficial de grupos.
- Todos os grupos veem o mesmo quadro persistente, com URL, autor, grupo e horário de cada contribuição. Apenas o próximo espaço pode ser preenchido; URL e autoria histórica ficam permanentes no ciclo.
- Só URLs estruturais do YouTube são aceitas. Com `YOUTUBE_API_KEY`, o servidor também consulta a API para confirmar existência/acessibilidade.
- Cada usuário começa com 10 créditos. Salvar custa 1; a primeira contribuição de cada ciclo usa o direito-base. Uma compra confirmada de R$20 concede 20 créditos e 1 passe adicional. Créditos promocionais/recompensas não geram passes.
- Ao completar 10 links, o ciclo fica pronto, um novo ciclo abre e cada participante distinto recebe 1 crédito interno de curadoria. Participantes do ciclo podem conferir os 10 registros e acionar `Criar playlist`.
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

Na consolidação de 05/10/2026: 49 testes de API, 5 testes do cliente, TypeScript, build React/PWA e 1 cenário Playwright ponta a ponta passaram. As capturas fictícias ficam em `docs/evidencias`.

## Integrações e limites atuais

Google OAuth/YouTube Data API, Mercado Pago e WhatsApp Cloud API possuem adaptadores e testes controlados, mas ainda exigem credenciais e validação real. Sem `YOUTUBE_API_KEY`, a validação do link é estrutural. Sem credenciais Meta, não há entrega real de OTP/bot.

A associação automática “número presente no grupo WhatsApp → código SOS YOUTUBER” não é tratada como concluída: depende da elegibilidade e das APIs oficiais disponíveis para os grupos reais. Até essa comprovação, o Owner confirma o vínculo.

O produto oferece um acompanhamento local e informativo de reprodução após a playlist ser criada, usando a IFrame Player API oficial: o percentual avança apenas com o player em reprodução e a aba visível, preserva continuidade no navegador e ignora saltos grandes de timeline. Não há OCR, captura de tela ou reprodução oculta/background. Esse percentual não altera saldo nem gera recompensa; as políticas do YouTube proíbem oferecer incentivos/recompensas por assistir vídeos. O percentual exibido durante `Criar playlist` continua sendo o progresso técnico de inclusão dos 10 itens.

Antes de produção ainda faltam: validação real dos provedores, reconciliação de pagamentos órfãos/estornos, migração de eventuais telefones legados para a forma canônica internacional, política de privacidade/termos e exclusão/retenção de dados, monitoramento e revisão operacional. Consulte `PROJECT_STATUS.md`, `docs/ESPECIFICACAO-CANONICA-YOUTUBE-FINAL-20261005.md`, `docs/ARQUITETURA.md` e `docs/WHATSAPP-INTEGRACAO.md`.
