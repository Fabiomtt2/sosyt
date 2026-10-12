# AGENTS.md — Governança do YouTube Final

## Âncora
- Árvore canônica de integração: `YouTube Final`.
- `Conexão Youtube` é a fonte histórica/WIP ASTRA e deve permanecer somente leitura durante o merge.
- Ler antes de agir: `git status`, `git log`, **`docs/CONTINUIDADE-CANONICA.md`**, **`docs/ANCHOR-YOUTUBE-FINAL.md`**, `PROJECT_STATUS.md`, `docs/AUDITORIA-PARTICIPANTE-INFRA-20261006.md`, `docs/SKILL-RECUPERACAO-MEMORIA-GIT.md`, `docs/SKILL-CONTINUIDADE-YOUTUBE-FINAL.md`, `docs/AUDITORIA-ASTRA-20261005.md` e este arquivo. `CONTINUIDADE-CANONICA.md` é o handoff operacional mais recente; a âncora canônica continua obrigatória e deve ser sincronizada no mesmo checkpoint de qualquer mudança de regra.

## Recuperação obrigatória
- Se o usuário disser que algo já foi corrigido/validado, que a instância se perdeu ou pedir retomada exata, interromper edições e executar integralmente `docs/SKILL-RECUPERACAO-MEMORIA-GIT.md` antes de agir.
- Git/testes/handoffs prevalecem sobre memória do agente quando houver divergência.

## Proteção de trabalho
- NÃO usar `git reset`, `git clean`, `git stash` nem descartar WIP sem autorização explícita.
- NÃO alterar a árvore ASTRA ao auditar.
- Preservar patches, evidências, bancos e arquivos não rastreados relevantes.
- Nunca versionar `.env`, tokens, segredos ou telefones pessoais reais.

## Regra de merge
1. Auditar ASTRA/origem antes de convergir.
2. Classificar diferenças como: idêntica/compatível; melhoria nova sem conflito; divergência de regra; RED objetivo.
3. Divergência de regra ou produto: parar e apresentar a escolha ao usuário.
4. RED objetivo (teste/build quebrado, perda de dados, vulnerabilidade, corrupção, regressão inequívoca): corrigir e registrar.
5. Não substituir regras já confirmadas pelo usuário por interpretação nova do agente.
6. Commits pequenos e temáticos somente depois de validação.

## Heartbeat
- Atualizar o usuário em cada marco importante.
- Em execução prolongada, nunca ultrapassar aproximadamente 5 minutos sem atualização.
- Informar: onde estamos, o que foi validado, REDs encontrados/corrigidos, próximo passo.

## Regras atuais — prioridade sobre o histórico abaixo
- Decisões explícitas de Fábio em 07/10/2026 prevalecem sobre os parágrafos históricos de 05/10 e as skills antigas.
- Participante em produção confirma acesso por chave WhatsApp de 5 minutos ou identidade Google vinculada; nome+telefone sem prova é somente DEV. Google não elimina WhatsApp.
- Tempo novo: WATCH_TIME, 1 moeda interna por 20 minutos acumulados, deduplicados pelo motor do servidor. WATCH_PROGRESS antigo preservado; percentual legado não gera moedas nem conclusão automática.
- Business público aprovado: +5571993978956; seed TypeScript único, configuração persistida editável prevalece. Telefones privados dos Owners e segredos continuam fora do Git.
- Intro/login sem carrossel nem fundo ilustrado. Banners informativos somente no dashboard participante. Artes podem ser aprimoradas.
- Companion Python é nova implementação, não runtime IFtp recuperado. Opt-in, região escolhida, metadados sem imagens, autorização revogável. Não comprova atenção humana nem escreve no ledger.
- Estado operacional mais recente está no topo de NEXT-INSTANCE-MANDATORY.md; checkpoints anteriores são histórico.

## Regras de produto confirmadas em 05/10/2026
- Quadro global compartilhado entre os grupos SOS YOUTUBER; 10 posições sequenciais e permanentes por ciclo.
- Owners principais: `Fábio/Fabio` e `Rafael` são ambos `ROOT_OWNER` com acesso total. Nomes configurados legados com sufixo `0` continuam aceitos apenas por compatibilidade; privilégio exige o WhatsApp correspondente configurado no servidor. Administradores adicionais promovidos usam `ADMIN_OWNER` e não podem alterar segredos/configurações sensíveis nem criar/revogar Owners. O marcador `#` é somente interno e nunca deve aparecer como instrução/campo da UI.
- Login participante: nome + `WhatsApp` internacional; o usuário comum não digita grupo. O servidor resolve o grupo pelo vínculo aprovado em `group_memberships` e, quando configurada, pela evidência externa em `whatsapp_member_verifications`. Não existe etapa de Credencial/OTP no fluxo principal; campo de credencial aparece exclusivamente após identificação de Owner.
- Intro: uma única CTA `Quero participar`; ela abre a tela de dados já validada. O envio registra solicitação persistente no dashboard e a própria tela acompanha o resultado. Não criar segunda CTA obrigatória para WhatsApp. Preservar lockup horizontal da marca e o bloco textual de segurança, sem escudo/ícone verde.
- WhatsApp: onboarding/bot/OTP/alertas/decisão automatizados pela Cloud API quando configurada.
- Grupos: associação deve ser automatizada pela Groups API oficial quando a conta/grupo forem elegíveis; eventos reais de participante alimentam `group_memberships`. Fallback Owner permanece para grupos não sincronizados.
- YouTube: criar playlist somente após ciclo pronto, por participante do ciclo e com OAuth explícito.
- Reprodução: monitor do player oficial, continuidade local+servidor, saltos grandes não contam.
- Moedas são créditos internos de capacidade de contribuição, sem saque/conversão financeira. Regra confirmada: cada 10% consolidado de progresso da playlist gera 1 moeda interna, máximo 10 por usuário/ciclo; somente delta novo pode ser creditado.
- Compra Pix e passes continuam separados das moedas naturais/recompensas.

## Gate mínimo antes de checkpoint
- `git diff --check`
- `npm test`
- `npm run lint`
- `npm run build`
- E2E Playwright quando fluxo/UI foi alterado.
