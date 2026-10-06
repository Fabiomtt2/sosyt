# ÂNCORA CANÔNICA — YOUTUBE FINAL

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

- Tela de entrada é neutra: nome + WhatsApp internacional + grupo SOS YOUTUBER 1–999.
- Nunca forçar `+55`; telefone é internacional. O login usa um controle único moderno: seletor de país/DDI com bandeira, DDD brasileiro quando aplicável e uma única caixa numérica para o restante do telefone. País/DDD usam popovers, não `<select>` nativo.
- Nome de Owner é comparado sem diferenciar maiúsculas/minúsculas, acentos e alias final `0`.
- Owners canônicos: `Fabio0` e `Rafael0`; aliases `Fábio/Fabio` e `Rafael` são válidos quando o WhatsApp correspondente também confere.
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
- Login aprovado exige grupo compatível com o cadastro.
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
- Aprovação de participante não gera OTP; após aprovação, nome + WhatsApp + grupo bastam.

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

## 9. UX Premium ASTRA

- Preservar navy/vermelho/creme, Manrope + DM Sans, cards arredondados, profundidade sutil e boa hierarquia.
- Premium = refinamento e consistência; não trocar identidade sem aprovação.
- Lockup `SOS YOUTUBER` horizontal.
- `Quero participar` usa novamente o botão vermelho simples da identidade original ASTRA. Ele e a ação principal do login mantêm a mesma altura, eixo vertical, raio e tipografia; a diferença de centro vertical medida no desktop deve permanecer ≤1 px. O texto de segurança desce/sobe junto com o botão. Não adicionar gradiente/neon especial sem nova aprovação.
- O bloco “Sem views automáticas / Sem reprodução oculta / Você mantém o controle” é somente textual. Não usar escudo ou outro ícone verde nesse bloco nem no cartão de solicitação. Apenas “Você mantém o controle.” fica em negrito.
- Uma CTA de participação; sem duplicação apelativa.
- “Voltar para tela de login” usa seta e linguagem neutra.
- Erros devem ser explicados em PT-BR; não exibir mensagens nativas em inglês.
- Estados de pendência, tarefa e cooldown devem parecer parte do design ASTRA, não telas técnicas.
- O seletor internacional de telefone nunca pode expandir/quebrar a página: países ficam em viewport interno com rolagem suave e setas ↑/↓; o DDD brasileiro usa trilho horizontal com ‹/›. O viewport DDD mostra exatamente **5 colunas × 3 linhas (15 DDDs completos)** por página visual, sem cards parcialmente cortados, e as setas avançam aproximadamente uma página inteira. Com o seletor DDD aberto, a digitação numérica funciona como busca incremental invisível (`7` → DDDs 7x; `71` → DDD 71), sem campo de busca extra. Ambos fecham com `Esc`; o E2E deve falhar se DDI/DDD criarem overflow horizontal no documento.
- O modal `Configurar integração` tem scroll interno próprio, bloqueia o scroll da página ao fundo e responde a `Esc`: primeiro fecha a ajuda contextual aberta e, no próximo `Esc`, fecha o modal. O título do modal não pode usar a tag global `header` nem herdar a barra navy do app; `.astra-modal-title` deve permanecer transparente e com altura natural. O E2E valida o modal também em 1366×768 para impedir sobreposição/overflow. O botão que abre a integração permanece **vermelho ASTRA**, independentemente do modo. Meta Oficial usa azul; Meta + Grupos usa gradiente vaporwave azul/roxo/magenta e mostra Meta + YouTube em metades geométricas 50/50 sem recorte; Evolution Gateway usa navy/índigo próprio; Desativado usa cinza. A composição principal usa superfícies brancas/creme e separadores suaves; os cards-resumo de estado também permanecem brancos, com acento lateral vermelho ASTRA, nunca blocos vermelhos agressivos. `apps/client/src/integration.css`, carregado após `styles.css`, é a skin canônica desta integração e deve impedir que CSS legado volte a dominar o modal. Termos técnicos, campos Meta + Grupos e campos Evolution devem ter ajuda `?` em linguagem leiga.
- Dashboard Owner: pendente usa `Novo Usuário!` verde + `🔴 Registro pendente`; após aprovação, a pendência desaparece e vira `🟢 Usuário aprovado!`, preservando o registro. O cartão `Transporte nesta execução` é cinza com `AINDA INATIVO` quando o backend/provedor não está ativo e verde com `ATIVO ✅` quando `whatsapp.configured` estiver verdadeiro no servidor.
- Aba `Participantes` mostra data/hora e Owner responsável pela aprovação. O nome abre popup administrativo restrito ao Owner com cadastro editável, carteira, compras somente leitura, ledger e ações administrativas auditáveis.
- `Grupos e acesso` cobre virtualmente todos os grupos `1–999` em páginas de carrossel, sem renderizar 999 cards ao mesmo tempo. Grupo ainda não persistido aparece como `Disponível` e o próprio card pode ativá-lo no servidor. Há navegação anterior/próxima e salto direto para um número. `Autorização manual excepcional` reutiliza o mesmo seletor internacional de WhatsApp do login e um seletor visual de grupo 1–999; ao autorizar, ativa o grupo escolhido se necessário e grava data/Owner responsável. Os controles `Nome` e `WhatsApp` devem compartilhar o mesmo topo e altura visual de 50 px no desktop; isso é protegido por E2E.

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
- Gate mais recente da recuperação local em 06/10/2026: 65/65 API, 9/9 cliente, TypeScript/API + React/PWA verdes e E2E Playwright 1/1 no próprio Inspiron. O E2E prova também que buscar `Brasil` no seletor DDI retorna somente Brasil e que alternar Meta + Grupos ↔ Evolution atualiza contexto/status imediatamente sem resíduos Meta.
- O launcher Xubuntu canônico é `scripts/launch-xubuntu.sh`: inicia os serviços quando necessário, abre URL com cache-bust e prefere Firefox explicitamente, usando `xdg-open` somente como fallback. O atalho local deve ser apenas um wrapper para esse script versionado.

## 12. Pendências conscientes

- Parear/implementar a sessão WPPConnect real e sua leitura de grupos/admins; o modal e armazenamento seguro já existem.
- Obter prova real de Owner-admin pelo provedor. Presença no grupo, Owner-admin e aprovação Owner já são estados separados no motor; sem prova de admin a verificação externa não libera acesso.
- Conectar credenciais Meta reais e webhook HTTPS.
- Parear sessão WPPConnect somente após consentimento explícito no dashboard.
- Preview frontend público deve usar o repositório `Fabiomtt2/sosyt` e GitHub Pages em `https://fabiomtt2.github.io/sosyt/`; `VITE_PUBLIC_BASE=/sosyt/` é obrigatório no build Pages.
- A build pública nunca pode cair no `localhost:3333` do visitante. O backend Railway já existe; qualquer build (incluindo Pages) que não receba `VITE_API_URL` público deve apenas informar que **essa publicação** ainda não está conectada ao servidor, sem tentar localhost.
- Backend HTTPS já foi publicado no Railway em `https://sos-youtuber-api-production.up.railway.app`, com volume persistente para SQLite e healthcheck `/health`. O frontend full-stack alternativo está em `https://sos-youtuber-web-production.up.railway.app`. Ambos ainda devem acompanhar o novo HEAD canônico após o merge desta rodada. GitHub Pages continua sendo apenas frontend estático/PWA.
- Validar Google/YouTube e Mercado Pago reais antes de produção.
- Políticas de privacidade, termos, retenção/exclusão, backup/restore e observabilidade.

## 13. Infraestrutura e recuperação — 06/10/2026

- Git local canônico no Inspiron: `~/Documents/Codex/2026-10-04/gostar/YouTube Final`. A recuperação desta rodada parte de `main @ 45ce984` limpo e usa branch isolada `sol/whatsapp-modes-evolution-20261006-recovered`.
- GitHub canônico: `Fabiomtt2/sosyt`. O GitHub App do ChatGPT pode continuar somente-leitura/403; no Xubuntu, `gh` está autenticado como `Fabiomtt2` com escopos `repo` e `workflow`, portanto push/checks/merge devem preferir essa rota quando necessário.
- Desktop Commander secundário está operacional no Inspiron e deve ser a rota local preferida enquanto estiver online; não depender da conta antiga sem cota.
- Railway: projeto `SOS YouTuber`, API `sos-youtuber-api-production.up.railway.app`, frontend `sos-youtuber-web-production.up.railway.app`, SQLite persistente em volume. Os serviços foram inicialmente presos a `45ce984` e precisam ser repontados ao novo HEAD após o merge.
- Recuperação Vercel independente: sandbox persistente `sosyt-sol-20261006`, snapshot `snap_Kg3VFafm7lvEcrJXCFXYYeYL9hNs`. O checkpoint Sandbox mais completo era `6b29eb6`; `951bf7b`/`0dccc7d` foram intermediários. Nenhum desses hashes foi publicado no GitHub; a recuperação local atual os supersede e deve ser a fonte para o novo commit canônico.
- Não criar infraestrutura paga para contornar conectores quando houver rota local/gratuita disponível.

## Regra de atualização

Se uma decisão deste arquivo mudar, não apagar silenciosamente a regra anterior: atualizar a seção correspondente, registrar a nova decisão em `PROJECT_STATUS.md` e proteger a mudança com teste quando aplicável.
