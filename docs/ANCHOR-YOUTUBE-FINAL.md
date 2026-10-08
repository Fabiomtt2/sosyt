# ÂNCORA CANÔNICA — YOUTUBE FINAL

## Retomada ASTRA — 08/10/2026 02:42 -03
- Conferência final: PR #1 OPEN/DRAFT, sem conflito; não há CI configurado nesta branch (gate local comprovado acima). Railway API/Web online SUCCESS, 1/1, zero ocorrências e zero mudanças pendentes em 08/10. Comparação integral contra main encontrou apenas uma linha extra no EOF de watch-rewards.ts, removida sem alteração de comportamento.
- PR em rascunho: https://github.com/Fabiomtt2/sosyt/pull/1. Manter sem merge até homologar o login real e coordenar API/Web. Código/evidências em ba1ce1ab; ponta documental da branch obtida com git rev-parse HEAD.
- Branch sol/user-premium-20261006, base c0b8172. WIP consolidado em 11 commits temáticos; código/evidências validados em ba1ce1abf7e2748131ce1e96e45704dd667c2919. Documentação vem em commit posterior na mesma branch (resolver HEAD com git rev-parse). Main/GitHub ainda c0b8172 e produção 65d5b2c. Branch publicada e conferida no GitHub; push inicial f434ab6d08de0a73666fd874ef066ffdc489053f, seguido deste checkpoint documental. Sem merge/deploy.
- Gate final GREEN: .local-tmp/gate-reviewed-20261008T053328Z/results.json — 112 testes API, 10 cliente, lint, build, Playwright 3/3, diff e cached-check. Python 5/5 GREEN com OCR/GUI reais em Xvfb isolado. Fixtures de telefone agora sintéticas.
- Login: chave WhatsApp 5 min/uso único ou Google alternativo; aprovação e carteira preservadas. Business +5571993978956 central/editável/persistido. Alertas e decisões agora consultam templates salvos; contagem inclui associações Google pendentes.
- Companion novo real em companion/sos_companion.py; opt-in, região explícita, OCR local, metadados apenas, sem automação do player/ledger. API com token restrito, expiração e revogação web/local. E2E executa cliente Python contra API real de teste. Não foi recuperado um runtime IFtp histórico.
- WATCH_TIME: 1 moeda interna/20 min acumulados, perfil e detalhe Owner usando mesma fonte. Legado preservado sem fabricar tempo. Corrigidas pausa, corrida de inicialização YouTube e conclusão por percentual legado.
- Visual: intro sem carrossel/background ilustrado; banners só no dashboard; novas artes de loja; lifecycle de modais com foco/Tab/Escape/body lock. Avatar persistente e badge ADMIN auditados. Screenshot do cartão detectou SOS YOUTUBER #; corrigido para Participação administrativa no cartão e no detalhe.
- Impedimento de publicação: prontidão do login real não comprovada. Google sem variáveis no Railway; Meta pode existir no banco. Credenciais Owner locais retornaram 401 na API de produção (health 200). Não inventar credenciais nem habilitar DEV para contornar.
- Main dispara publicação Pages automaticamente, então não fazer merge enquanto API/provedores não estiverem prontos. Railway mantém fonte fixada em 65d5b2c e volume /data. Pilha validada como conjunto, não cada commit intermediário como release.
- Auditoria detalhada: docs/AUDITORIA-ASTRA-20261008.md. Próximo: confirmar configuração real Meta/Google com acesso administrativo de produção, homologar login, só então coordenar merge/publicação e smoke público. Não recriar o número Business nem reabrir decisões já registradas.
- Snapshot imediatamente anterior aos commits: .local-tmp/astra-precommit-20261008T053653Z (115 arquivos + patches + hashes).


## Regra mais recente — Fábio, 07/10/2026 13:25 Bahia
- WhatsApp Business público inicial aprovado: +5571993978956. Fonte: mensagem explícita do usuário; pode constar no modelo do projeto. Contatos privados/credenciais dos Owners continuam separados.
- Número central em apps/api/src/project-defaults.ts, seed inicial em integration_settings e edição persistente pelo painel ROOT_OWNER. Valor persistido prevalece após restart/deploy. Links públicos e effectiveWhatsAppConfig consultam o mesmo estado. Mudar telefone não descobre credenciais Meta; conferência cruza telefone público e Phone Number ID antes de liberar envio após alterações.
- NÃO usar carrossel nem ilustração de background na intro/login: removida a montagem de IntroVisualCarousel. Componente antigo preservado no WIP para rastreabilidade, sem uso na tela.
- Carrossel aprovado apenas na área do participante, em formato banner informativo sobre o projeto. Artes não são finais: ASTRA autorizado a redesenhar loja e demais ilustrações, afastando estética gamer; motores continuam prioritários.
- Na retomada, encontrada e lida integralmente docs/AUDITORIA-SOL-MOTOR-20261007.md. Sol implementou watch-observation/WATCH_TIME enquanto ASTRA estava parado. Não reconstruir o motor duplicado: auditar estado atual, inclusive protocolo legado.
- Snapshot anterior a esta edição: .local-tmp/astra-business-entry-20261007T162833Z (88 arquivos WIP + patches + hashes). HEAD continua c0b8172, branch sol/user-premium-20261006. Sem commit/push/merge/deploy nesta etapa.


Data-base: 06/10/2026.

> LEITURA OBRIGATÓRIA. Este arquivo é a fonte de verdade de produto e continuidade do repositório YouTube Final.
> Toda instância/agente deve lê-lo antes de editar. Mudança de regra validada pelo usuário deve atualizar esta âncora no mesmo checkpoint.

## 1. Governança

- **Checkpoint crítico mais recente:** `docs/RECOVERY-CHECKPOINT-20261006-CRITICAL-OWNER-UI.md`. Os REDs registrados nessa rodada estão fechados no estado atual, mas toda nova instância deve lê-lo imediatamente após esta âncora para não reintroduzi-los.
- Projeto mutável: `YouTube Final`.
- `Conexão Youtube` é origem histórica ASTRA para auditoria/comparação; não editar durante convergências.
- Antes de qualquer edição: `git status --short`, `git log -5 --oneline`, ler `AGENTS.md`, esta âncora, `PROJECT_STATUS.md` e as skills de continuidade/recuperação.
- Nunca reset/clean/stash ou descarte de WIP sem autorização explícita.
- Git, testes e handoffs validados têm precedência sobre memória do agente.
- Heartbeat ao usuário em marcos importantes e no máximo aproximadamente 5 minutos em execução prolongada.
- Estado de candidatura pendente nunca pode sobrepor a etapa Owner: ao escolher “Acessar com outro número”, o pedido continua no servidor/localStorage, mas sua reapresentação automática é suprimida apenas no estado em memória da sessão React atual. Fechar/reabrir a página permite retomar o acompanhamento persistido novamente.
- Segredos, telefones reais e tokens nunca são versionados; ficam no `.env` ignorado.

## 2. Identidades e acesso

- Tela de entrada é neutra: nome + WhatsApp internacional. Participante comum não digita grupo; o servidor resolve o grupo pelo WhatsApp e pelos vínculos/evidências aprovados.
- Nunca forçar `+55`; telefone é internacional. O login usa um controle único moderno: seletor de país/DDI com bandeira, DDD brasileiro quando aplicável e uma única caixa numérica para o restante do telefone. País/DDD usam popovers, não `<select>` nativo.
- Nome de Owner é comparado sem diferenciar maiúsculas/minúsculas, acentos e alias final `0`.
- Owners principais: `Fábio/Fabio` e `Rafael` são ambos `ROOT_OWNER` com acesso total. Nomes configurados com sufixo `0` permanecem aceitos apenas como aliases de compatibilidade quando o WhatsApp correspondente também confere. `ADMIN_OWNER` é reservado a administradores adicionais promovidos e restritos.
- Telefones Owner reais ficam em `OWNER_FABIO_WHATSAPP` e `OWNER_RAFAEL_WHATSAPP`.
- Durante homologação, ambos os Owners podem ser usados; a ausência física de Rafael não bloqueia testes com a conta Fábio.
- Somente Owner identificado vê o campo `Credencial`; em desenvolvimento, `sosyout` é a credencial de teste.
- O dashboard Owner mostra o alias efetivamente digitado no login, sem reescrevê-lo para o nome canônico.
- `#` é marcador interno; nunca aparece como credencial, grupo ou instrução na UI.

## 3. Cadastro de participante

- Existe uma única CTA principal `Quero participar`.
- Fluxo: dados → solicitação pendente persistente → dashboard Owner + bot → aprovação → mesma tela muda para `Cadastro aprovado` → usuário escolhe `Voltar ao acesso` → login direto.
- Participante comum nunca recebe campo de Credencial/OTP no fluxo principal. Owner identificado continua obrigado a informar `Credencial`.
- Tentativa de login ainda não aprovada vira cadastro pendente amigável; não apresentar 403 cru ao usuário.
- A solicitação recebe token opaco de acompanhamento, persistido no navegador por até 30 dias e validado no servidor. A página consulta o status periodicamente e também possui `Verificar situação`.
- O usuário pode fechar a página. Manter os dados do site permite reencontrar automaticamente a tela pendente/aprovada. Apagar cache/storage não apaga o pedido do servidor.
- Todo novo pedido grava `retry_block_until` de 120 minutos. Reenvio do mesmo WhatsApp enquanto o pedido está pendente responde `423 REQUEST_RETRY_BLOCKED`, não cria outra solicitação e não gera novo alerta aos Owners.
- A regra dos 120 minutos também vale quando o mesmo número tenta reiniciar o cadastro pelo bot WhatsApp; VPN/IP/navegador novo não zeram o registro porque a chave canônica é o WhatsApp normalizado. Esse prazo é proteção contra **cadastro repetido**, não penalização por senha/credencial errada. O cooldown de 30 minutos é uma regra distinta e só nasce após concluir uma tarefa de Fila.
- Número já ativo em `group_memberships` não abre nova solicitação: responde `409 ALREADY_REGISTERED` com mensagem amigável “Esse número já foi registrado...”.
- Aprovação preserva nome, WhatsApp, grupo, saldos e histórico. A tela de acompanhamento passa a exibir a aprovação sem redirecionar automaticamente.
- Login aprovado resolve o grupo server-side a partir do WhatsApp; não exige que o participante redigite o grupo. Vínculo Owner/manual e prova externa devem continuar semanticamente separados.
- A meta do modo verificado é dupla checagem: aprovação Owner + presença real no grupo informado + confirmação de que pelo menos um Owner configurado é administrador do grupo. Presença/admin nunca devem conceder aprovação sozinhos.

## 4. WhatsApp — arquitetura

### Estado oficial

- O código possui adaptador Meta Cloud API, webhook assinado, outbox persistente, retry/backoff, alertas Owner e sincronização oficial de grupos.
- O dashboard Owner possui a seção `CONFIGURAR BOT SOS YOUTUBE` e um modal persistente com quatro modos: **Meta Oficial**, **Meta + Grupos**, **Evolution Gateway** e **Desativado**. Na UI os rótulos são em português (`ID da conta do WhatsApp Business`, `ID do número do WhatsApp`, `Credencial de acesso da Meta`, `Chave secreta do aplicativo`, `Token de verificação`) e termos técnicos aparecem apenas nas explicações abertas por `?`. A escolha visual usa o estado atual do formulário imediatamente; textos/status não podem continuar descrevendo o modo salvo anterior.
- Segredos informados no modal são criptografados **no servidor** com AES-256-GCM e nunca retornam em texto puro pela API; a UI recebe apenas indicadores configurado/não configurado. Verify Token gerado pelo app é mostrado uma única vez.
- Configuração Meta/WPPConnect salva pelo Owner é aplicada ao runtime correspondente sem exigir reinício; valores do `.env` permanecem como fallback. Evolution Gateway já possui persistência segura e UI próprias, mas seu transporte/eventos ainda precisam de adaptador e validação antes de serem considerados ativos.
- O painel deve deixar explícito, em linguagem amigável, quando a conexão oficial está pendente ou quando a credencial da Meta ainda é necessária; após uma chamada real à Graph API, grava a data da validação e passa a mostrar o estado validado.
- Números Owner podem estar configurados mesmo quando o transporte Meta ainda não está conectado.
- `OWNER_WHATSAPP` dedicado é opcional; na ausência, Rafael é o contato público de fallback.
- Aprovação de participante não gera OTP; após aprovação, nome + WhatsApp bastam no fluxo normal e o grupo é resolvido pelo servidor.

### Provedores

Quatro modos de operação são suportados pelo dashboard:

1. **Meta Oficial** — mensagens e webhooks pela WhatsApp Business Platform.
2. **Meta + Grupos** (valor persistido `META_GROUPS`) — Meta como canal oficial de comunicação + WPPConnect como complemento para grupos tradicionais/membros/admins. Configuração histórica `HYBRID` é migrada automaticamente para `META_GROUPS`.
3. **Evolution Gateway** (valor `EVOLUTION`) — configuração independente de URL, instância e API key da Evolution API. A API key é cifrada com o mesmo mecanismo AES-256-GCM das demais credenciais e nunca retorna em texto puro. A configuração/persistência é real; transporte/eventos Evolution só podem ser marcados como ativos após adaptador e validação próprios.
4. **Desativado** — nenhuma automação externa; dashboard/manual permanece disponível.

- O modo complementar Meta + Grupos deve trazer aviso amigável: usa WhatsApp Web, pode exigir QR, pode quebrar após mudanças do WhatsApp e pode causar restrições na conta; nunca ativar silenciosamente.
- Fábio e Rafael são contas Owner autorizadas para homologar o modo complementar quando houver pareamento explícito; seus números reais continuam somente no ambiente local.
- Não deixar Meta e WPPConnect enviarem a mesma mensagem sem deduplicação/roteamento explícito.
- WPPConnect deve preferencialmente atuar como prova complementar de grupo/admin; Meta continua sendo o transporte oficial sempre que disponível.
- A prova de presença em grupo não deve ser confundida com aprovação Owner.
- O modal e armazenamento de configuração WPPConnect já existem; sessão/QR e verificação real de grupos tradicionais ainda são pendência consciente e não devem ser apresentados como ativos antes do pareamento.

## 5. Credenciais Meta necessárias

Nunca versionar valores. Variáveis previstas:
- `WHATSAPP_PHONE_NUMBER_ID`
- `WHATSAPP_BUSINESS_ACCOUNT_ID`
- `WHATSAPP_ACCESS_TOKEN` (preferir System User)
- `WHATSAPP_APP_SECRET`
- `WHATSAPP_VERIFY_TOKEN`
- `WHATSAPP_OWNER_ALERT_TEMPLATE`
- `WHATSAPP_DECISION_TEMPLATE`
- `WHATSAPP_GRAPH_VERSION`
- URLs públicas HTTPS para webhook/API.

Ações manuais do responsável Meta: login/consentimento, eventual verificação do negócio, verificação do telefone por SMS/voz, obtenção do System User Access Token e aprovação de templates. O restante pode ser preenchido no modal Owner ou configurado via DC quando autorizado. Enquanto o token não existir, o painel deve dizer explicitamente que ele ainda é necessário; depois de salvo, `Validar token/API` consulta a Graph API e grava a data da validação.
## 6. Filas, URLs e persistência

- Internamente o banco usa `rounds`; para o usuário o termo preferido é **Fila**.
- Cada Fila contém exatamente 10 posições sequenciais.
- Cada URL aceita deve ser do YouTube e é salva com autor, grupo e horário.
- Vídeo já utilizado em qualquer Fila anterior ou atual não pode ser salvo novamente.
- Cada URL salva consome 1 moeda.
- Ao completar 10 URLs, a Fila vira READY e uma nova Fila OPEN é criada automaticamente.
- Fechar/atualizar navegador nunca apaga usuários, filas, URLs, moedas, autoria, exportações ou progresso.
- Quem não participou de uma Fila encerrada vê normalmente a Fila OPEN atual.
- Quem participou de uma Fila READY permanece vinculado à tarefa daquela Fila até finalizá-la e não pode contribuir na Fila seguinte.

## 7. Playlist, acompanhamento e conclusão

- Participante da Fila pode criar playlist privada em sua própria conta via OAuth Google/YouTube explícito. A interface oferece **um único CTA “Criar playlist” por usuário/Fila**, no card principal; nunca repetir o botão em cada URL que a mesma pessoa salvou com passes extras.
- Acompanhamento atual usa IFrame Player API: tempo natural, aba visível, grandes saltos ignorados e persistência por usuário/Fila.
- Cada marco consolidado de 10% concede 1 moeda interna, máximo de 10 por Fila; ledger `WATCH_PROGRESS` é idempotente.
- Fechar a janela de acompanhamento apenas pausa; o estado continua salvo.
- Botão `Concluir tarefa` exige confirmação amigável:
  - encerra a tarefa no percentual atual;
  - mantém somente recompensas já alcançadas;
  - não apaga progresso;
  - inicia cooldown persistente de 30 minutos.
- 100% finaliza automaticamente e também inicia cooldown.
- Cooldown é gravado no servidor e espelhado localmente; apagar storage/atualizar não deve burlá-lo.
- Durante cooldown, login responde `423 COOLDOWN_ACTIVE` e a UI exibe contagem regressiva até 00:00.
- Após o prazo, a conta volta ao fluxo normal e pode entrar na Fila OPEN atual.

## 8. Moedas

- Moeda é crédito interno do SOS YouTube; não é saque nem pagamento em dinheiro por visualização.
- Saldo possui origens distintas:
  - promocional/inicial;
  - comprado;
  - recompensa/bônus por tarefa.
- Dashboard Owner deve mostrar total e origem.
- Compra pode conceder passe extra conforme regra vigente; moedas promocionais/recompensas não geram passe.
- Débitos e créditos são persistidos em ledger e devem ser idempotentes.
- **Premissa fixa:** o sistema de moedas virtuais, compra de pacotes, passes, carteira e ledger permanece parte central do produto. Integrações financeiras não substituem nem recalculam esse motor; apenas processam o pagamento externo que pode gerar créditos/passes conforme a regra vigente.

### 8.1 Pagamentos e provedores Pix

- O Owner escolhe **um provedor ativo para novas compras**: Mercado Pago, Asaas, PagBank ou Desativado.
- Trocar o provedor não altera transações antigas. Cada pagamento conserva `provider` e `provider_payment_id` originais e continua sendo conciliado pelo adaptador que o criou.
- Credenciais são salvas server-side em `integration_settings` e cifradas com AES-256-GCM; o navegador recebe somente indicadores configurado/não configurado.
- `Produção` × `Teste/Sandbox` refere-se **à conta/credenciais do provedor**, não ao estado do backend SOS YouTuber. O backend já pode estar online enquanto um provedor financeiro usa sandbox.
- Mercado Pago: Pix por Checkout API + confirmação assinada.
- Asaas: cobrança Pix + QR dinâmico; ao salvar credenciais completas o servidor tenta criar/atualizar o webhook de pagamentos automaticamente.
- PagBank: pedido Pix + URL de notificação; webhook é validado por assinatura sobre o corpo original antes de conciliar.
- Webhooks devem ser idempotentes; eventos Asaas/PagBank usam `payment_webhook_events` para evitar dupla aplicação.
- Receita/Pacotes Pix mensais no Owner contam **qualquer provedor real** aprovado e excluem apenas `DEMO`.
- Em produção sem provedor ativo/configurado, novas compras reais são recusadas; em desenvolvimento, `PAYMENTS_DEV_MODE` mantém o fluxo DEMO existente.
- O popup Pix segue a mesma regra premium: blur no fundo, body travado, scroll interno, rodapé de ações preso ao modal e `?` contextual em termos técnicos. Não usar `header` global dentro desse modal.

## 9. UX Premium ASTRA

- Preservar navy/vermelho/creme, Manrope + DM Sans, cards arredondados, profundidade sutil e boa hierarquia.
- Premium = refinamento e consistência; não trocar identidade sem aprovação.
- Lockup `SOS YOUTUBER` horizontal.
- `Quero participar` usa novamente o botão vermelho simples da identidade original ASTRA. Ele e a ação principal do login mantêm a mesma altura, eixo vertical, raio e tipografia; a diferença de centro vertical medida no desktop deve permanecer ≤1 px. O texto de segurança desce/sobe junto com o botão. Não adicionar gradiente/neon especial sem nova aprovação.
- O bloco “Sem views automáticas / Sem reprodução oculta / Você mantém o controle” é somente textual. Não usar escudo ou outro ícone verde nesse bloco nem no cartão de solicitação. Apenas “Você mantém o controle.” fica em negrito.
- Uma CTA de participação; sem duplicação apelativa.
- “Voltar para tela de login” usa seta e linguagem neutra.
- Erros devem ser explicados em PT-BR; não exibir mensagens nativas em inglês.
- **Owner pode ser extremamente leigo.** Texto principal deve responder “o que é / para que serve / está funcionando?”. Termos como token, webhook, API Key, Access Token, assinatura, Git e WIP ficam atrás de ajuda `?` com explicação simples e, quando útil, instrução de onde obter o dado.
- Todo modal administrativo abre sobre fundo borrado e bloqueia o scroll da página; quem rola é o popup. Essa regra vale para Pix, WhatsApp, participante, ajuda administrativa e gerenciamento de grupo.
- O seletor de mês no Owner exibe PT-BR (`Outubro de 2026`) mesmo que utilize o `input[type=month]` nativo por baixo. Abas mobile centralizam a aba ativa.
- “Painel sincronizado com o servidor” significa apenas atualização dos dados exibidos a cada 10 s. “Conferir versão online” consulta a versão servida; não instala, reinicia, atualiza APIs nem faz deploy. Detalhes Git ficam na ajuda `?`.
- Estados de pendência, tarefa e cooldown devem parecer parte do design ASTRA, não telas técnicas.
- O seletor internacional de telefone nunca pode expandir/quebrar a página: países ficam em viewport interno com rolagem suave e setas ↑/↓; o DDD brasileiro usa trilho horizontal com ‹/›. O viewport DDD mostra exatamente **5 colunas × 3 linhas (15 DDDs completos)** por página visual, sem cards parcialmente cortados, e as setas avançam aproximadamente uma página inteira. Com o seletor DDD aberto, a digitação numérica funciona como busca incremental invisível (`7` → DDDs 7x; `71` → DDD 71), sem campo de busca extra. **A busca digitada permanece aplicada enquanto o popover estiver aberto**; não existe mais timer que apaga `71` após 1,2 s. O E2E espera 1,6 s e exige que DDD 71 continue filtrado. Ambos fecham com `Esc`; o E2E deve falhar se DDI/DDD criarem overflow horizontal no documento.
- O modal `Configurar integração` tem scroll interno próprio, bloqueia o scroll da página ao fundo e responde a `Esc`: primeiro fecha a ajuda contextual aberta e, no próximo `Esc`, fecha o modal. O título do modal não pode usar a tag global `header` nem herdar a barra navy do app; `.astra-modal-title` deve permanecer transparente e com altura natural. O E2E valida o modal também em 1366×768 para impedir sobreposição/overflow. O botão que abre a integração permanece **vermelho ASTRA**, independentemente do modo. Meta Oficial usa azul; Meta + Grupos usa gradiente vaporwave azul/roxo/magenta e mostra Meta + YouTube em metades geométricas 50/50 sem recorte; Evolution Gateway usa navy/índigo próprio; Desativado usa cinza. A composição principal usa superfícies brancas/creme e separadores suaves; os cards-resumo de estado também permanecem brancos, com acento lateral vermelho ASTRA, nunca blocos vermelhos agressivos. `apps/client/src/integration.css`, carregado após `styles.css`, é a skin canônica desta integração e deve impedir que CSS legado volte a dominar o modal. Termos técnicos, campos Meta + Grupos e campos Evolution devem ter ajuda `?` em linguagem leiga.
- Dashboard Owner: pendente usa `Novo Usuário!` verde + `🔴 Registro pendente`; após aprovação, a pendência desaparece e vira `🟢 Usuário aprovado!`, preservando o registro. A área do bot separa **Modo escolhido**, **Chave de acesso** e **Envio automático**. O envio mostra `FUNCIONANDO` somente quando `whatsapp.configured` estiver verdadeiro; caso contrário mostra `PARADO`. Não usar “token/API” como texto principal para Owner leigo; o termo técnico fica na ajuda `?`.
- Aba `Participantes` mostra data/hora e Owner responsável pela aprovação. O nome abre popup administrativo restrito ao Owner com cadastro editável, carteira, compras somente leitura, ledger e ações administrativas auditáveis.
- `Grupos e acesso` cobre virtualmente todos os grupos `1–999` em páginas de carrossel, sem renderizar 999 cards ao mesmo tempo. O painel **não pode chamar um grupo de “ativo” como sinônimo de existir no WhatsApp**. Cada grupo separa: `Habilitado no SOS` (acesso interno), vínculo externo confirmado, provedor de verificação, última prova/sincronização e link de entrada opcional. `whatsapp_group_id` é somente leitura e só vem de integração/prova externa. O Owner pode salvar/remover `join_url`; salvar apenas um link em grupo ainda inexistente não o habilita automaticamente. Há navegação anterior/próxima e salto direto para um número. `Autorização manual excepcional` reutiliza o mesmo seletor internacional de WhatsApp do login e um seletor visual de grupo 1–999; ao autorizar, habilita o grupo escolhido se necessário e grava data/Owner responsável. Os controles `Nome` e `WhatsApp` devem compartilhar o mesmo topo e altura visual de 50 px no desktop; isso é protegido por E2E.

## 10. Gate obrigatório

Antes de checkpoint:
```bash
git diff --check
npm test
npm run lint
npm run build
npm run test:e2e -w @conexao/client
```

Mudança visual deve regenerar/revisar evidências em `docs/evidencias/`.

## 11. Estado validado em 06/10/2026

- Owner alias preservado no JWT/dashboard.
- Cadastro pendente persistente → decisão Owner → mesma tela acompanha o resultado; após todas as verificações necessárias, muda para `Cadastro aprovado` e o usuário escolhe `Voltar ao acesso`.
- Botões Login/Owner alinhados por teste visual.
- Meta: adaptador existe; o Owner possui modal de configuração e validação com dados persistidos no servidor. Sem credencial real da Meta, o painel mantém explícito que a conexão oficial ainda está pendente.
- Contato público usa Rafael como fallback quando `OWNER_WHATSAPP` não existe.
- Filas sequenciais preservadas.
- Duplicata global de vídeo bloqueada.
- Participante de Fila READY bloqueado de nova contribuição até finalizar.
- Conclusão manual e automática persistentes.
- Cooldown de 30 minutos aplicado no servidor.
- Saldo por origem exposto ao dashboard Owner.
- Teste de conclusão manual prova 37% → 3 moedas → cooldown 30 min → liberação após prazo.
- Gate mais recente do WIP `sol/user-premium-20261006` em 07/10/2026: **73/73 API, 10/10 cliente, `git diff --check`, lint/TypeScript, build API + React/PWA e Playwright E2E 1/1** verdes no Inspiron. O E2E cobre DDI/DDD incremental, Owner → participante administrativo → Owner sem falso cooldown de 120 min, badges ADMIN/OWNER, FILA 1, avatar circular, Loja/Pix demo, segunda URL após compra, fila de 10, criação de playlist e acompanhamento.
- O launcher Xubuntu canônico é `scripts/launch-xubuntu.sh`: inicia os serviços quando necessário, abre URL com cache-bust e prefere Firefox explicitamente, usando `xdg-open` somente como fallback. O atalho local deve ser apenas um wrapper para esse script versionado.

## 12. Pendências conscientes

- Parear/implementar a sessão WPPConnect real e sua leitura de grupos/admins; o modal e armazenamento seguro já existem.
- Obter prova real de Owner-admin pelo provedor. Presença no grupo, Owner-admin e aprovação Owner já são estados separados no motor; sem prova de admin a verificação externa não libera acesso.
- Conectar credenciais Meta reais e webhook HTTPS.
- Parear sessão WPPConnect somente após consentimento explícito no dashboard.
- Preview frontend público deve usar o repositório `Fabiomtt2/sosyt` e GitHub Pages em `https://fabiomtt2.github.io/sosyt/`; `VITE_PUBLIC_BASE=/sosyt/` é obrigatório no build Pages.
- A build pública nunca pode cair no `localhost:3333` do visitante. O backend Railway já existe; qualquer build (incluindo Pages) que não receba `VITE_API_URL` público deve apenas informar que **essa publicação** ainda não está conectada ao servidor, sem tentar localhost.
- Backend HTTPS está publicado no Railway em `https://sos-youtuber-api-production.up.railway.app`, com volume persistente para SQLite e healthcheck `/health`. O frontend full-stack está em `https://sos-youtuber-web-production.up.railway.app`. Após o merge desta rodada, ambos foram repontados para `checkpoint de aplicação 65d5b2c` e ficaram `SUCCESS/online`, 1/1 réplica, sem alertas ou falhas; a API respondeu healthcheck 200. GitHub Pages continua sendo frontend estático/PWA.
- Validar Google/YouTube e **cada provedor financeiro escolhido com credenciais reais** antes de declarar produção financeira: Mercado Pago, Asaas ou PagBank. Adaptadores/server-side e testes controlados existem; não afirmar movimentação real sem teste da conta correspondente.
- Políticas de privacidade, termos, retenção/exclusão, backup/restore e observabilidade.

## 13. Infraestrutura e recuperação — 06/10/2026

- Git local canônico no Inspiron: `~/Documents/Codex/2026-10-04/gostar/YouTube Final`. A rodada Owner control plane partiu de `02f3e4b`, passou gate + revisão visual e foi convergida em `main` no checkpoint de aplicação `65d5b2c`. A branch histórica é `sol/owner-control-plane-20261006`.
- GitHub canônico: `Fabiomtt2/sosyt`. O GitHub App do ChatGPT pode continuar somente-leitura/403; no Xubuntu, `gh` está autenticado como `Fabiomtt2` com escopos `repo` e `workflow`, portanto push/checks/merge devem preferir essa rota quando necessário.
- Desktop Commander secundário está operacional no Inspiron e deve ser a rota local preferida enquanto estiver online; não depender da conta antiga sem cota.
- Railway: projeto `SOS YouTuber`, API `sos-youtuber-api-production.up.railway.app`, frontend `sos-youtuber-web-production.up.railway.app`, SQLite persistente em volume. API e Web estão online no canônico `65d5b2c`; API preserva o volume e passou healthcheck 200. Commits posteriores somente de documentação não exigem rebuild do Railway.
- Recuperação Vercel independente: sandbox persistente `sosyt-sol-20261006`, snapshot `snap_Kg3VFafm7lvEcrJXCFXYYeYL9hNs`. O checkpoint Sandbox mais completo era `6b29eb6`; `951bf7b`/`0dccc7d` foram intermediários. Nenhum desses hashes foi publicado no GitHub; a recuperação local atual os supersede e deve ser a fonte para o novo commit canônico.
- Não criar infraestrutura paga para contornar conectores quando houver rota local/gratuita disponível.

## Regra de atualização

Se uma decisão deste arquivo mudar, não apagar silenciosamente a regra anterior: atualizar a seção correspondente, registrar a nova decisão em `PROJECT_STATUS.md` e proteger a mudança com teste quando aplicável.


## Reancoragem ASTRA — 07/10/2026 (em execução)

- Leitura integral dos 13 documentos exigidos concluída antes de editar.
- Local: sol/user-premium-20261006 @ c0b8172; origin/main e GitHub main idênticos após fetch.
- Railway: API/Web SUCCESS, 1 réplica cada, volume /data; ambos fixados em 65d5b2c (push de main sozinho não troca o pin). Nenhum deploy nesta rodada.
- WIP original staged/unstaged/untracked preservado em snapshot privado .local-tmp/astra-entry-*/ com patches separados, arquivos e hashes; index não alterado.
- Assets coins-bag.webp (34940 bytes) e pass-ticket.webp (27094 bytes) presentes; documentos anteriores sobre ausência/tamanho inválido estão superados. Hero community/growth ainda ausentes.
- Histórico pesquisado nas duas árvores, reflogs/branches/objetos órfãos: nenhum runtime Python, .pyc ou IFtp recuperado; update-watch.py é gerador JSX. Três blobs órfãos são handoffs Markdown. Acompanhamento nasceu em 361c87a (React) e ganhou persistência/ledger em 2365736.
- Regra explícita nova do usuário: 1 moeda virtual por 20 minutos acumulados entre sessões e filas; regra histórica de 10% deve ser migrada sem apagar ledger. Ainda NÃO implementada/validada nesta rodada.
- ROOT_OWNER de Fábio e Rafael confirmado no código. Gate antigo não substitui nova validação.
- Próximo: auditoria de motores/UX, recuperação das artes aprovadas, companion opt-in testável, gate completo, commits por domínio, merge/deploy somente após convergência.


### Decisão explícita de identidade — ASTRA 07/10/2026
- Usuário escolheu Google/YouTube (pergunta identity_proof) para confirmar identidade em aparelho novo. Isso supersede acesso público somente por nome/telefone.
- Identificação Google deve usar escopo mínimo separado da permissão YouTube para criar playlists.
- Conta legada sem vínculo Google não pode ser vinculada automaticamente só por telefone: exige aprovação Owner da associação. Sessões posteriores continuam conectadas.
- RED P0 reproduzido em banco isolado: /auth/login comum com telefone de Owner autorizado como participante -> /admin/elevate 200 ROOT_OWNER sem credencial. Corrigir origem/versão da sessão administrativa; não reduzir privilégios de Fábio/Rafael.
- E2E baseline fresco passou 1/1 em 94,5 s. Loja visualmente RED: cartaz + objeto sobreposto, repetição de preços e informação.


### Ajuste do usuário — 07/10/2026 08:43 (Bahia)
A decisão mais recente substitui Google obrigatório: acesso principal por número WhatsApp e chave aleatória de uso único com expiração de 5 minutos, entregue pelo bot. Mesma chave serve para confirmar registro ou login; grupo continua derivado do número, com aprovação manual Owner preservada. Google pode continuar opcional e a autorização YouTube permanece separada. Não acrescentar senha própria nem provedor SMS nesta rodada. Sessão autenticada, aprovação de grupo e conexão YouTube são estados distintos do mesmo user_id; não duplicar carteira, URLs ou histórico. Envio real ainda depende de configuração Meta/template; não anunciar funcionamento externo sem confirmação.
WIP de segurança em andamento: proteção de elevação ROOT e revogação administrativa, módulo Google opcional (ainda sem gate), adaptação OTP 300 s e registro verificado. Nada publicado/deployado.


### Checkpoint ASTRA — autenticação validada, 07/10/2026
Regra confirmada pelo usuário às 08:47 Bahia: Google e chave WhatsApp são alternativas coexistentes; não criar conta/carteira por método. Chave OTP aleatória de 6 dígitos expira em 300 s, uso único, 5 tentativas, reenvio mínimo 60 s. Registro por chave confirma número sem conceder aprovação de grupo. Cadastro manual Owner é preservado. Google exige vínculo aprovado antes de acessar cadastro existente; scopes openid/email separados do YouTube.
GREEN: lint/TS; API 89/89; client 10/10; cenário E2E anterior passou; novo E2E phone-key.spec.ts passou isolado (4,9 s). Captura login-chave-whatsapp-mobile.png inspecionada. Corrigida infraestrutura E2E: limpeza do banco de fixture movida do playwright.config.ts (reimportado pelos workers) para scripts/browser-tests.mjs antes da API iniciar. Gate completo final ainda pendente; nenhuma publicação.
Segurança: login nome/telefone sem prova restrito a AUTH_DEV_MODE; sessões OTP/Google em modo real vinculadas ao número; elevação ROOT exige sessão administrativa emitida com credencial Owner válida; rotação/revogação invalida privilégios.
Próximo: substituir aceitação de vetores arbitrários de watch-progress e recompensa antiga 1 moeda/10% por observações limitadas pelo relógio do servidor, deduplicação de trechos e 1 moeda/20 min acumulados. Histórico e ledger antigos serão preservados sem fabricar tempo observado.


### ASTRA — Business e revisão do motor Sol — 07/10/2026 13:46 Bahia
Business +5571993978956 centralizado, persistido e editável em todos os modos do painel; propagação sem hardcode no frontend. Troca de identidade de remetente exige confirmação de correspondência na Meta, sem alterar telefones dos Owners. Campo/ajuda/edição/reload/wa.me validados E2E desktop/mobile; captura business-numero-mobile.png inspecionada. Intro sem montagem de imagem/carrossel. Botão de contato na solicitação resolve número do servidor a cada 10 s e ao recuperar foco.
Antes da revisão do watch: API 103/103, client 10/10, lint/build GREEN, E2E 3/3 GREEN. Dois REDs adicionais foram reproduzidos por ASTRA no motor Sol: (1) 100% legado provocava finalização automática na primeira observação, (2) intervalo após amostra pausada podia ser creditado. Correção aplicada: estado anterior active persistido, cobertura de intervalos dos dez vídeos para conclusão, percentuais sem arredondar antecipadamente para 100 e UI deixa de somar reprodução local repetida. Os 6 testes watch-time passaram após correção; acrescentada cobertura do encerramento natural. Novo gate em andamento. Nenhum commit/push/merge/deploy.


### Checkpoint ASTRA — 07/10/2026 13:51 Bahia
- Nova regra Business e visual do usuário incorporada. API 106/106 + cliente 10/10, lint e build GREEN após revisão ASTRA dos dois REDs adicionais no motor Sol. Gate E2E final em conferência; execução PID 287244. Build mantém aviso de bundle ~566 kB (não bloqueante).
- Pendente de produto/infra: credenciais oficiais Meta e Google não fabricadas; não confundir número Business existente com Cloud API configurada. Todas as alterações ainda locais, sem deploy.
- Auditoria histórica não encontrou runtime Python IFtp/IFTP nas duas árvores/reflogs/objetos examinados; update-watch.py é gerador JSX, não runtime. Próximo bloco será companion novo, identificado como nova implementação, opt-in, captura apenas região escolhida, sem enviar imagens, com autorização revogável e sinais complementares ao motor web. OCR não provará atenção humana nem autorizará moedas sozinho.
- Preflight do Inspiron: tkinter/Pillow/OpenCV disponíveis; tesseract e xvfb ausentes. Ainda não foi instalado nada neste bloco nem criado companion. Não alegar recuperação de runtime histórico.
