# Estado verificável — YouTube Final

Data de consolidação: 05/10/2026.

## Linhagem e auditoria

A fonte histórica ASTRA permanece em `Conexão Youtube`, branch `main`, HEAD `0f09c7b` mais WIP não commitado. Ela foi auditada novamente antes desta convergência: `git diff --check`, 47 testes de API, 3 do cliente, TypeScript e build/PWA passaram.

O primeiro merge isolado `ae26bf1` incorporou por hash todos os arquivos de código/texto modificados ou criados pelo WIP ASTRA. Nenhum código ASTRA foi perdido nesse checkpoint. As diferenças posteriores são evolução na árvore isolada `YouTube Final`.

Histórico principal:
- `37f915c` — checkpoint/auditoria ASTRA inicial;
- `14f584e` — motor web compartilhado e controles Owner;
- `0f09c7b` — âncora documental ASTRA;
- `ae26bf1` — primeiro merge isolado;
- `361c87a` — Owners refinados e acompanhamento de reprodução;
- `974443a` — login Owner por WhatsApp formatado;
- `02249e3` — evidências UI;
- `9978481` — auditoria externa de integrações.

A governança corrente está em `AGENTS.md`. `.env` é local/ignorado e não deve ser exibido ou versionado.

## Produto consolidado

- Quadro global entre todos os grupos SOS YOUTUBER com 10 posições sequenciais, URL, autor, grupo e horário permanentes.
- URL precisa ser YouTube; validação estrutural sempre e consulta externa quando `YOUTUBE_API_KEY` existe.
- `Fabio0` e `Rafael0`: contas Owner separadas, identificadas automaticamente por nome + WhatsApp configurado; em desenvolvimento usam a credencial administrativa `sosyout`. Em produção o servidor exige segredo Owner forte. O `#` permanece apenas como detalhe interno da API.
- Login neutro: nome + WhatsApp internacional + SOS YOUTUBER 1–99. O backend resolve automaticamente participante/Owner. Se o participante ainda não estiver aprovado, a UI registra a solicitação pendente e mostra confirmação amigável; após aprovação, entra diretamente quando `group_memberships` confirma telefone + grupo. Não há Credencial/OTP no fluxo principal.
- 10 moedas iniciais; Save custa 1; Pix de R$20 adiciona 20 moedas compradas e 1 passe; moedas naturais não concedem passe.
- Ao fechar o ciclo, recompensa de curadoria existente permanece.
- Participantes daquele ciclo podem criar playlist privada na própria conta via OAuth Google/YouTube.
- Acompanhamento de reprodução usa IFrame Player API, conta avanço natural com aba visível, ignora saltos grandes e sincroniza progresso por usuário/ciclo.
- Regra confirmada pelo usuário: cada marco de 10% consolidado gera 1 moeda interna, máximo 10 por playlist/ciclo. Ledger `WATCH_PROGRESS` torna os marcos idempotentes.
- Moedas são crédito interno para controlar capacidade de contribuição; não são saque ou pagamento em dinheiro.

## WhatsApp

Fluxo desejado/implementado no motor: `Quero participar` → tela de dados → pendência no dashboard → continuidade pelo WhatsApp → bot pergunta “Como gostaria de ser chamado?” → decisão Owner/sincronização de grupo → participante entra diretamente quando telefone + grupo constam em `group_memberships`. OTP não é requisito do login principal.

A decisão do Owner responde por mensagem livre quando a janela de serviço está ativa; fora dela usa `WHATSAPP_DECISION_TEMPLATE` quando configurado. Fila persistente, HMAC, deduplicação, lease, retry/backoff e OTP por template permanecem.

Automação de grupos:
- worker descobre grupos oficiais cujo subject é `SOS YOUTUBER N`;
- grava `whatsapp_group_id` e modo `META_GROUPS_API`;
- sincroniza participantes para `group_memberships`;
- webhook `group_participants_update` concede/revoga acesso em entrada/saída;
- eventos são deduplicados;
- painel permite sincronização imediata;
- grupos que a Meta não expõe/para os quais a conta não é elegível permanecem em fallback `OWNER_VERIFIED`.

Isso não simula acesso a grupos comuns não expostos pela API oficial. A validação real depende da conta Meta, OBA/eligibilidade e IDs retornados pelo provedor.

## Continuidade e UI Premium — 05/10/2026

- `docs/SKILL-CONTINUIDADE-YOUTUBE-FINAL.md` é a âncora operacional obrigatória para novas instâncias/agentes.
- Intro preserva a identidade ASTRA com lockup horizontal da marca, uma única CTA `Quero participar` e segurança integrada por escudo verde ilustrado em SVG, ancorado à base do bloco de texto.
- A CTA `Quero participar` abre a tela intermediária já validada; o envio registra os dados no painel e a etapa de sucesso oferece o WhatsApp com mensagem pronta para iniciar o bot. A CTA não deve pular diretamente para o WhatsApp.
- Login continua universal: `WhatsApp` internacional e grupo SOS YOUTUBER 1–99; sem +55 automático, sem rótulos Owner e sem `#` visível. `Credencial administrativa` só aparece para Owner.
- Texto auxiliar do login é uma linha no desktop e responsivo no mobile.
- Passe Premium global foi limitado a profundidade, consistência de cartões, botões, slots, dashboard e modais, preservando paleta navy/vermelho/creme e tipografia ASTRA.
- Webapp/XFCE é a prioridade corrente; APK não é prioridade desta rodada.

## Recuperação por Git — 05/10/2026

Uma regressão de contexto foi identificada e recuperada pelo histórico:
- `53e6d87` consolidou o onboarding internacional + bot;
- `9ac044a` preservou a CTA como entrada para a tela intermediária;
- `e4f1bf2` voltou a permitir link direto ao WhatsApp quando `whatsappJoinUrl` existia, pulando a tela já validada;
- a decisão recuperada agora é protegida por E2E mesmo quando um WhatsApp fictício está configurado;
- `docs/SKILL-RECUPERACAO-MEMORIA-GIT.md` tornou-se obrigatória quando o usuário disser que algo já havia sido corrigido/validado ou que a instância perdeu contexto.

A intro também fixa por teste: botão `Quero participar` isolado e com a mesma métrica de `Continuar`, sem retângulo externo; frase `Sempre por escolha sua.` em nova linha; peso normal nas duas primeiras linhas de segurança e negrito apenas na última.

## Verificação do WIP de convergência

Gate completo executado após recuperação por Git e refinamento visual:
- `git diff --check`: aprovado;
- backend: 59/59 testes;
- cliente: 6/6 testes;
- TypeScript API e cliente: aprovado;
- build API + React/PWA: aprovado;
- Playwright E2E: 1/1 aprovado no fluxo completo;
- Android: sync aprovado e APK debug gerado com SDK 35 local do projeto.

## Estado operacional local — Xubuntu · 05/10/2026

- Web/API locais respondem em `http://localhost:5173` e `http://localhost:3333`.
- `/auth/login` é o fluxo principal do participante: só concede sessão se telefone + grupo já estiverem ativos em `group_memberships`; caso contrário retorna 403 em português.
- Owner identificado por nome/alias + WhatsApp recebe apenas o campo `Credencial administrativa`; em `AUTH_DEV_MODE=true`, `sosyout` é aceito para teste local.
- Banco local, no diagnóstico desta rodada, tinha `0` memberships ativos e `0` usuários cadastrados; por isso nenhum participante real conseguia entrar antes de aprovação.
- Grupos públicos atuais: `1`, `2`, `10`.
- O contato público usa `OWNER_WHATSAPP` quando definido e, na ausência dele, usa o número Owner Rafael. Os números Owner/alerta já estão configurados neste Xubuntu; o que falta para o transporte oficial são as credenciais da Meta Cloud API. O fallback estudado é WAHA/NOWEB, sem Chromium.
- O modo dev remove service workers/caches antigos e o launcher XFCE abre URL com cache-bust para reduzir risco de testar bundle PWA obsoleto.

## Pendências externas/produção

- Credenciais e teste real Meta WhatsApp/Groups API.
- Credenciais e teste real Google/YouTube.
- Credenciais e conciliação real Mercado Pago.
- Política de privacidade, termos, retenção/exclusão e revogação de dados.
- Observabilidade, backup/restauração e implantação.
- Revisar requisitos contratuais/políticas dos provedores antes de produção.
- APK debug atualizado foi gerado; instalação automática no aparelho físico ficou pendente porque o transporte USB/ADB oscilou durante a tentativa. Android WIP histórico não foi destruído.
