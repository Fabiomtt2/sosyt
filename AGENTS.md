# AGENTS.md — Governança do YouTube Final

## Âncora
- Árvore canônica de integração: `YouTube Final`.
- `Conexão Youtube` é a fonte histórica/WIP ASTRA e deve permanecer somente leitura durante o merge.
- Ler antes de agir: `git status`, `git log`, **`docs/ANCHOR-YOUTUBE-FINAL.md`**, `PROJECT_STATUS.md`, `docs/SKILL-RECUPERACAO-MEMORIA-GIT.md`, `docs/SKILL-CONTINUIDADE-YOUTUBE-FINAL.md`, `docs/AUDITORIA-ASTRA-20261005.md` e este arquivo. A âncora canônica é obrigatória e deve ser atualizada no mesmo checkpoint de qualquer mudança de regra.

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

## Regras de produto confirmadas em 05/10/2026
- Quadro global compartilhado entre os grupos SOS YOUTUBER; 10 posições sequenciais e permanentes por ciclo.
- Owners: nomes configurados `Fabio0` e `Rafael0` aceitam também os aliases `Fábio` e `Rafael`; privilégio exige o WhatsApp correspondente configurado no `.env`. Em desenvolvimento a credencial administrativa é `sosyout`; produção continua exigindo segredo forte configurado no servidor. O marcador `#` é somente interno e nunca deve aparecer como instrução/campo da UI.
- Login participante: nome + `WhatsApp` internacional + grupo SOS YOUTUBER 1–999. Não existe etapa de Credencial/OTP no fluxo principal; o backend só cria sessão se `group_memberships` confirmar telefone + grupo. Campo de credencial aparece exclusivamente após identificação de Owner.
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
