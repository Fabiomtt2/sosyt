# SOS YouTuber

Webapp/PWA para a comunidade SOS YOUTUBER montar filas compartilhadas de 10 vídeos e criar playlists privadas na própria conta YouTube. A versão Android permanece preservada; gerar APK está fora desta rodada.

## Produto atual

- **Identidade:** nome e WhatsApp internacional com DDI/DDD. Em produção, chave WhatsApp de seis dígitos, válida por cinco minutos e uso único, ou Google como alternativa. A associação Google a um telefone existente exige conferência explícita do Owner; ela reutiliza conta, carteira e histórico. Conectar o canal YouTube é uma autorização separada.
- **Grupo:** o participante não digita grupo. O backend consulta autorização persistida e, nos modos externos, a evidência de pertencimento. Owner pode cadastrar e autorizar manualmente. Aprovação Owner não equivale a verificação externa em tempo real.
- **Owners:** Fábio e Rafael são ROOT_OWNER, ambos com acesso total. ADMIN_OWNER tem permissões operacionais delegadas, controladas no servidor. A participação administrativa usa sessão própria revogável.
- **Fila:** dez posições sequenciais, URL e autoria persistentes. Cada contribuição custa uma moeda; contribuição adicional do participante na mesma fila exige passe. A confirmação ocorre em transação para impedir disputa pelo mesmo slot, saldo negativo ou débito após troca de fila. O mesmo vídeo não pode ser reutilizado em outra fila.
- **YouTube:** URLs são validadas estruturalmente; com YOUTUBE_API_KEY, o servidor também consulta existência/acessibilidade e metadados. Ao completar a fila, cada colaborador pode autorizar a criação de uma playlist privada. Canal do participante e canal que publicou o vídeo aparecem separadamente.
- **Tempo e moedas:** dez moedas iniciais; bônus de curadoria ao fechar a fila; uma moeda interna a cada 20 minutos novos aceitos pelo motor de reprodução. O tempo acumula entre sessões e filas, com deduplicação e ledger. Perfil e painel Owner consultam o mesmo total. Créditos antigos WATCH_PROGRESS são preservados, mas o protocolo legado de percentual não gera recompensas novas.
- **Loja:** COINS_LAUNCH custa R$20 e concede dez moedas compradas e um passe bônus; PASS_SINGLE custa R$20 e concede um passe, sem moedas. Crédito somente após confirmação server-side/idempotente do pagamento. Moedas são capacidade interna de contribuição, sem saque/conversão monetária.
- **Experiência:** login sem carrossel/fundo ilustrado; banners informativos na área do participante; loja com ilustrações transparentes; avatar persistente, modais com foco, Escape, rolagem interna e bloqueio do fundo.

## WhatsApp Business

O número público inicial autorizado é **+5571993978956**, definido em `apps/api/src/project-defaults.ts`. A inicialização salva o padrão uma vez; a edição ROOT_OWNER no painel persiste no SQLite e prevalece após reinício. Links públicos consultam esse mesmo valor, atualizado nas telas abertas por polling/foco. Contatos pessoais dos Owners continuam separados.

O telefone público não substitui WABA ID, Phone Number ID, token ou templates aprovados pela Meta. Após alterar a identidade do remetente, o servidor exige conferência de que o número Meta corresponde ao telefone salvo. Templates de chave, alerta e decisão podem ser configurados no painel; novas operações leem a configuração persistida. Um link wa.me abre uma mensagem preenchida: a pessoa ainda precisa enviá-la.

## Companion opcional

`companion/sos_companion.py` é uma implementação nova em Python/Tkinter. A busca histórica não recuperou um runtime IFtp; `.local-tmp/update-watch.py` era um gerador de JSX.

O participante baixa e executa o programa no próprio computador, consente e escolhe uma região da tela. O Tesseract lê o contador localmente; apenas metadados são enviados mediante pareamento revogável. Não são enviados screenshots. O companion não controla o player, não comprova atenção humana e não credita moedas independentemente. Leia `companion/README.md` para instalação e limites.

## Desenvolvimento

Requer Node 22+. Dentro desta pasta:

```sh
npm install --legacy-peer-deps --cache .npm-cache
node scripts/setup-local.mjs
npm run dev
```

Web: http://localhost:5173. API padrão: http://localhost:3333. O `.env` da raiz é local/ignorado. O banco de desenvolvimento fica em `apps/api/data/conexao-youtube.db`; os testes usam bancos próprios, separados. Nunca publicar `.env` ou credenciais.

AUTH_DEV_MODE permite testes locais sem entrega externa; nome+telefone sem prova é exclusivo desse modo. PAYMENTS_DEV_MODE permite Pix DEMO sem movimentação financeira. Ambos são recusados em produção. O build do cliente prepara os downloads do companion sem exigir Python no servidor.

## Verificação

```sh
git diff --check
git diff --cached --check
npm test
npm run lint
npm run build
npm run test:e2e -w @conexao/client
```

Em 08/10/2026: gate final com **112 testes API, dez cliente, lint, build e três E2E GREEN**, registrado em `.local-tmp/gate-reviewed-20261008T053328Z/results.json`. Cinco testes Python passaram, incluindo OCR real e GUI/captura em Xvfb isolado. Os E2E cobrem Business editável, registro por chave e ciclo Owner/participante/loja/playlist; o cliente Python conversa com a API real de teste. OAuth e pagamentos externos usam respostas controladas nos testes. Evidências frescas: `docs/evidencias/`.

## Publicação e limites

- API: https://sos-youtuber-api-production.up.railway.app
- Web: https://sos-youtuber-web-production.up.railway.app
- Railway: fontes ainda fixadas em 65d5b2c, API com volume persistente em /data.
- GitHub Pages publica automaticamente a partir de main. Um merge exige coordenação com a API; não atualizar apenas o frontend enquanto o novo login não estiver pronto.

Google OAuth, Meta e pagamentos precisam de credenciais e validação nas contas reais. As credenciais locais Owner não autenticaram na produção em 08/10; configurações Meta no banco de produção permanecem não verificadas. Não publicar o novo requisito de identidade sem confirmar ao menos um provedor real de acesso.

Groups API só verifica grupos elegíveis realmente retornados pela Meta. Evolution possui configuração/UI, mas seu transporte não deve ser apresentado como ativo. Os adaptadores Pix existentes não substituem homologação e reconciliação operacional. O monitor do player e OCR fornecem sinais de reprodução, não garantia de atenção ou de contagem pública de visualizações pelo YouTube.

## Continuidade

Árvore canônica: `~/Documents/Codex/2026-10-04/gostar/YouTube Final`. A árvore histórica `Conexão Youtube` permanece somente leitura. Leia primeiro `AGENTS.md`, `docs/NEXT-INSTANCE-MANDATORY.md`, `docs/CONTINUIDADE-CANONICA.md` e `docs/ANCHOR-YOUTUBE-FINAL.md`. O topo do handoff registra HEAD, gate, WIP, bloqueios e próximo passo; os documentos antigos abaixo dele são histórico.
