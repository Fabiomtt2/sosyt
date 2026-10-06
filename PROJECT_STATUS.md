# Estado verificável — YouTube Final

Data de consolidação: 06/10/2026.

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

A governança corrente está em `AGENTS.md` e a fonte de verdade de produto/continuidade é **`docs/ANCHOR-YOUTUBE-FINAL.md`**. O checkpoint **`docs/RECOVERY-CHECKPOINT-20261006-CRITICAL-OWNER-UI.md`** registra a rodada crítica; o P0 de identidade/solicitação Owner, a busca incremental de DDD e o modal de integração foram fechados no WIP atual e protegidos por E2E. `.env` é local/ignorado e não deve ser exibido ou versionado.

## Produto consolidado

- Quadro global entre todos os grupos SOS YOUTUBER com Filas de 10 posições sequenciais, URL, autor, grupo e horário permanentes. Ao completar 10, a Fila fecha e outra abre sem apagar a anterior.
- URL precisa ser YouTube; validação estrutural sempre e consulta externa quando `YOUTUBE_API_KEY` existe.
- `Fabio0` e `Rafael0`: contas Owner separadas, identificadas automaticamente por nome + WhatsApp configurado; em desenvolvimento usam a credencial administrativa `sosyout`. Em produção o servidor exige segredo Owner forte. Credencial incorreta permanece na etapa Owner e nunca cai em solicitação/cooldown de participante. O `#` permanece apenas como detalhe interno da API.
- Login neutro: nome + WhatsApp internacional + SOS YOUTUBER 1–999. O backend resolve automaticamente participante/Owner. Se o participante ainda não estiver aprovado, a UI registra a solicitação pendente e mostra confirmação amigável; após aprovação, entra diretamente quando `group_memberships` confirma telefone + grupo. Não há Credencial/OTP no fluxo principal.
- 10 moedas iniciais; Save custa 1; Pix de R$20 adiciona 20 moedas compradas e 1 passe; moedas naturais não concedem passe.
- Ao fechar o ciclo, recompensa de curadoria existente permanece.
- Participantes daquele ciclo podem criar playlist privada na própria conta via OAuth Google/YouTube.
- Acompanhamento de reprodução usa IFrame Player API, conta avanço natural com aba visível, ignora saltos grandes e sincroniza progresso por usuário/Fila. Fechar pausa; `Concluir tarefa` encerra no percentual atual. 100% conclui automaticamente.
- Regra confirmada pelo usuário: cada marco de 10% consolidado gera 1 moeda interna, máximo 10 por playlist/ciclo. Ledger `WATCH_PROGRESS` torna os marcos idempotentes.
- Moedas são crédito interno para controlar capacidade de contribuição; não são saque ou pagamento em dinheiro. O Owner vê separadamente origem inicial/promocional, comprada e bônus/recompensa.
- Participante de uma Fila READY não pode contribuir na próxima até finalizar sua tarefa. Após conclusão manual ou 100%, há cooldown persistente de 30 minutos (`423 COOLDOWN_ACTIVE`); depois volta ao fluxo comum.
- O mesmo `video_id` do YouTube não pode ser reutilizado em Filas posteriores.

## WhatsApp

Fluxo atual: `Quero participar` → tela de dados → solicitação persistente → dashboard Owner/bot → decisão Owner → a mesma página acompanha o estado → quando todas as verificações exigidas estiverem concluídas mostra `Cadastro aprovado` → usuário volta ao acesso normal. Reenvio do mesmo WhatsApp fica bloqueado por 120 minutos sem apagar o pedido. OTP não é requisito do login principal.

A decisão do Owner responde por mensagem livre quando a janela de serviço está ativa; fora dela usa `WHATSAPP_DECISION_TEMPLATE` quando configurado. Fila persistente, HMAC, deduplicação, lease, retry/backoff e OTP por template permanecem.

Automação de grupos:
- worker pode descobrir grupos oficiais cujo subject é `SOS YOUTUBER N` e registrar sua evidência externa;
- presença do participante é gravada separadamente da decisão Owner;
- **presença no grupo não aprova cadastro por si só**;
- quando a validação externa estiver ativa, o acesso só é materializado com aprovação Owner + presença do membro + prova de que ao menos um Owner é admin pelo mesmo provedor;
- saída do grupo revoga a prova externa/acesso aplicável sem apagar dados históricos;
- eventos são deduplicados e o painel permite sincronização imediata;
- sem provedor real pareado, o fallback de validação manual Owner continua disponível.

Isso não simula acesso a grupos comuns não expostos pela API oficial. A validação real depende da conta Meta, OBA/eligibilidade e IDs retornados pelo provedor.

## Continuidade e UI Premium — 06/10/2026

- `docs/ANCHOR-YOUTUBE-FINAL.md` é a âncora canônica obrigatória; `docs/SKILL-CONTINUIDADE-YOUTUBE-FINAL.md` define o protocolo operacional.
- Intro preserva a identidade ASTRA com lockup horizontal da marca e uma única CTA `Quero participar`. O botão voltou ao vermelho simples anterior; o bloco de segurança é textual, **sem escudo/ícone verde**.
- A CTA `Quero participar` abre a tela intermediária; o envio cria uma página persistente `Solicitação em análise`, com acompanhamento automático/manual. Após aprovação, a mesma página muda para `Cadastro aprovado`; o usuário escolhe quando voltar ao acesso.
- Login continua universal: `WhatsApp` internacional e grupo SOS YOUTUBER 1–999; sem +55 automático, sem rótulos Owner e sem `#` visível. `Credencial administrativa` só aparece para Owner.
- Texto auxiliar do login é uma linha no desktop e responsivo no mobile.
- País/DDI fica contido em popover com rolagem interna e setas ↑/↓; DDD brasileiro usa trilho horizontal ‹/› e busca incremental por teclado sem caixa extra (`7` filtra 7x; `71` localiza 71). Ambos fecham com `Esc` e não alteram a altura da página.
- `Grupos e acesso` pagina funcionalmente o espaço 1–999 em carrossel; grupos não persistidos podem ser ativados diretamente. A autorização manual usa o mesmo `PhoneField` internacional e seletor visual 1–999.
- Modal do BOT possui scroll interno, fecha por `Esc` em camadas e explica Oficial/Híbrido/Desativado. O botão `Configurar integração` usa sempre vermelho ASTRA; Meta Oficial usa azul e o Híbrido usa vaporwave azul/roxo/magenta com Meta + YouTube 50/50. O conteúdo do modal usa fundo branco/creme e separadores suaves; transporte inativo mostra `AINDA INATIVO` sem emoji.
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
- backend: 65/65 testes;
- cliente: 9/9 testes;
- TypeScript API e cliente: aprovado;
- build API + React/PWA: aprovado;
- Playwright E2E: 1/1 aprovado no fluxo completo;
- Android: sync aprovado e APK debug gerado com SDK 35 local do projeto.

## Estado operacional local — Xubuntu · 05/10/2026

- Web/API locais respondem em `http://localhost:5173` e `http://localhost:3333`.
- `/auth/login` é o fluxo principal do participante: só concede sessão se telefone + grupo já estiverem ativos em `group_memberships`; caso contrário retorna 403 em português.
- Owner identificado por nome/alias + WhatsApp recebe apenas o campo `Credencial`; em `AUTH_DEV_MODE=true`, `sosyout` é aceito para teste local.
- Banco local, no diagnóstico desta rodada, tinha `0` memberships ativos e `0` usuários cadastrados; por isso nenhum participante real conseguia entrar antes de aprovação.
- Grupos públicos atuais: `1`, `2`, `10`.
- O contato público usa `OWNER_WHATSAPP` quando definido e, na ausência dele, usa o número Owner Rafael. O dashboard Owner já permite salvar no servidor e validar a configuração oficial Meta; sem credencial real, a conexão permanece explicitamente pendente. O complemento escolhido para grupos tradicionais é WPPConnect, ainda não pareado/ativado.
- O modo dev remove service workers/caches antigos e o launcher XFCE abre URL com cache-bust para reduzir risco de testar bundle PWA obsoleto.

## Publicação web

- Preview estático preparado para GitHub Pages em `https://fabiomtt2.github.io/sosyt/`.
- O build Pages usa `/sosyt/` em assets, manifest, PWA `start_url` e `scope`.
- `VITE_API_URL` é variável do repositório e ficará vazia até existir backend HTTPS; nesse estado a versão pública não tenta o localhost do visitante.
- `vite.config.ts` é a única configuração Vite canônica; scripts nomeiam explicitamente esse arquivo para impedir precedência de artefatos legados.

## Pendências externas/produção

- Credenciais e teste real Meta WhatsApp/Groups API.
- Credenciais e teste real Google/YouTube.
- Credenciais e conciliação real Mercado Pago.
- Política de privacidade, termos, retenção/exclusão e revogação de dados.
- Observabilidade, backup/restauração e implantação.
- Revisar requisitos contratuais/políticas dos provedores antes de produção.
- APK debug atualizado foi gerado; instalação automática no aparelho físico ficou pendente porque o transporte USB/ADB oscilou durante a tentativa. Android WIP histórico não foi destruído.
