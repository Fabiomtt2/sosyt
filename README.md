# Conexão Youtube

Webapp/PWA para participantes aprovados dos grupos SOS YOUTUBER montarem ciclos globais de 10 vídeos e criarem, voluntariamente, uma playlist privada na própria conta Google. Android/Capacitor está preservado; APK adiado a pedido do usuário.

## Fluxo implementado

- Uma tela de login: participante usa nome, WhatsApp e grupo aprovado; Owner usa nome e WhatsApp/ID configurados, grupo 0 e credencial exclusiva.
- Quero participar! registra solicitação no painel. Com OWNER_WHATSAPP configurado, oferece mensagem pronta para o usuário enviar no WhatsApp. A conferência de participação no grupo é manual pelo Owner.
- Todos os grupos veem o mesmo quadro persistente, com URL, autor, grupo e horário de cada contribuição. Apenas o próximo espaço pode ser preenchido; autoria histórica é preservada.
- Cada usuário começa com 10 moedas. Salvar custa 1; a primeira contribuição de cada ciclo usa o direito-base. Uma compra confirmada de R$20 concede 20 moedas e 1 passe adicional. Moedas promocionais/recompensas não geram passes.
- Ao completar 10, o ciclo fica pronto, cada participante distinto recebe 1 moeda interna de curadoria e um novo ciclo abre. Cada participante pode conferir os 10 registros, conectar YouTube e usar Compartilhar em Playlist.
- Painel Owner: aprova/revoga números, gerencia grupos, lista usuários/compras, exporta CSV, conta atividade nos últimos 30 dias, solicitações, ciclos e playlists mensais. Pix real e simulado são separados.

## Executar no computador

Requer Node 22 ou superior. Dentro desta pasta:

```sh
npm install --legacy-peer-deps --cache .npm-cache
node scripts/setup-local.mjs
npm run dev
```

Abra http://localhost:5173. A configuração local usa nome `Owner`, ID `owner`, grupo `0`. A credencial aleatória está no campo OWNER_ADMIN_SECRET do `.env`; o script não sobrescreve configuração existente. Ajuste OWNER_NAME, OWNER_LOGIN_ID e OWNER_WHATSAPP conforme a conta desejada. Nunca publique o `.env`.

O modo local mostra o OTP na tela e permite simular aprovação Pix; não envia WhatsApp nem movimenta dinheiro. Primeiro entre como Owner e autorize um número, ou aprove sua solicitação. Use sempre o mesmo formato de telefone no cadastro e na aprovação, preferencialmente DDI+DDD+número.

A API lê o `.env` da raiz e mantém o banco em `apps/api/data/conexao-youtube.db`, independentemente do diretório de execução. O cliente usa VITE_API_URL=http://localhost:3333 por padrão; para outro endereço, configure essa variável no ambiente do Vite.

## Verificação

```sh
npm test
npm run lint
npm run build
npm run test:e2e --workspace apps/client
```

O teste de navegador usa banco separado em `.local-tmp`. Para instalar o navegador dentro do projeto: `PLAYWRIGHT_BROWSERS_PATH="$PWD/.playwright-browsers" TMPDIR="$PWD/.local-tmp" node node_modules/@playwright/test/cli.js install chromium --only-shell`. Alternativamente, configure PLAYWRIGHT_CHROMIUM_EXECUTABLE com um navegador compatível. As capturas com dados fictícios ficam em docs/evidencias. O cliente inclui testes do contrato HTTP e do isolamento dos tokens; seu fluxo completo é verificado pelo Playwright.

## Integrações e limites atuais

Google OAuth, YouTube Data API e Mercado Pago possuem adaptadores, mas ainda exigem credenciais e teste real. Sem YOUTUBE_API_KEY, a validação é estrutural e não comprova existência/disponibilidade do vídeo. OTP de produção está bloqueado com resposta 501 até implementação do provedor de entrega. Aprovação de grupo é autorização administrativa, sem leitura automática de membros do WhatsApp.

A recompensa por tempo assistido e reprodução em segundo plano do pedido original não estão implementadas: as políticas oficiais do YouTube proíbem esses mecanismos em clientes da API. A moeda atual é de curadoria, não é resgatável em reais, e R$1 é apenas sua taxa de compra. O app não garante visualizações nem tempo assistido.

Antes de produção ainda faltam entrega real de OTP, validação das integrações, reconciliação de estornos, exclusão/retensão de dados, documentação de privacidade, monitoramento e revisão operacional. Consulte PROJECT_STATUS.md, docs/ARQUITETURA.md e docs/AUDITORIA-ASTRA-20261005.md.
