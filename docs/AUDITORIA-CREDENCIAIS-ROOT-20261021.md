# Credenciais Root e recuperação de participantes — 21/10/2026

Fonte: cofre `01-ESPELHO/trabalho`, branch `auditoria/hybrid-plus-convergencia`. Intervenção autorizada por Fábio nesta rodada; nenhum reset, clone ou alteração de credencial real.

## Achados recuperados

- `fcb5b66` introduziu credenciais administrativas com hash, bloqueio de tentativas e uma proibição explícita de mudar a credencial do outro Root. A regra explícita mais recente permite a Fábio e Rafael administrar ambos Roots. A proibição antiga foi removida com motivo obrigatório e auditoria.
- `UserAccountMenu` ocultava toda a seção de senha quando `administrative=true`. O Root no modo participante não tinha formulário para sua credencial. Agora possui seção própria, ligada à API administrativa, sem criar uma senha paralela de participante.
- A seção Acesso já permitia trocar a própria credencial, mas o retorno ficava no fim da página longa. Formulários possuem nomes acessíveis, validação e confirmação local.
- A recuperação de membro pelo Root apenas solicitava código ao bot. Há agora uma ação distinta para definir senha provisória, com motivo, troca obrigatória no próximo login e aviso no correio sem incluir segredo.

## Contratos preservados

As senhas existentes nunca são reveladas. Hash scrypt, limite de tentativas, hierarquia e segredo de emergência permanecem. Root pode gerenciar os dois Owners e administradores ativos; ADMIN não ganha acesso às rotas Root. A tela Minha conta confere a associação entre o telefone participante e o token Owner antes de salvar, evitando alterar a conta de outra sessão Root.

A ação de senha provisória não serve para conta administrativa: essas usam credenciais da equipe. Não altera identidade, carteira, grupos ou progresso. Invalida senhas de bot ainda pendentes, instruções antigas e códigos de reset/setup anteriores. A trilha imutável existente `password_reset_audit` recebe ator, alvo e motivo, sem segredo ou hash. As sessões JWT já abertas continuam seguindo a política existente; não foi adicionada revogação global.

## Validação desta frente

- `admin-credentials.test.ts` e `hierarchy.test.ts`: 23/23 verdes, incluindo troca entre os dois Roots, própria credencial, provisória real de membro, bloqueio de ADMIN/participante e rollback quando a auditoria falha.
- `git diff --check`: limpo.
- `npm run lint` API e cliente: exit 0. A suíte completa/build/navegador finais ficam com o responsável pela integração.
- E2E sintético novo `zzzz-root-credentials.spec.ts`: escrito para salvar própria credencial na Minha conta, credencial do outro Root, provisória de participante e login com troca obrigatória; aguarda execução. Evidências previstas em `.local-tmp/benefit-halo-evidence/root-credential-*.png`, sem dados reais.
- Nenhuma inspeção visual nova desta tela ou publicação foi certificada por este parecer; integrar, executar e abrir as capturas antes de declarar concluído.
