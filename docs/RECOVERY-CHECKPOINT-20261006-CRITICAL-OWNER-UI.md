# CHECKPOINT DE RECUPERAÇÃO — REDs críticos após 88a4b33

Data: 06/10/2026 · origem: auditoria visual do usuário + confirmação no Git/código.

## Estado Git confirmado

- Repositório local canônico: `/home/ubuntu-desktop-bootstrap-ubuntu-/Documents/Codex/2026-10-04/gostar/YouTube Final`
- Branch: `main`
- HEAD antes deste checkpoint: `88a4b33d2035147fcf42b06ff1ae8ab419c8fa32`
- `origin/main`: mesmo commit.
- Ahead/behind antes deste checkpoint: `0/0`.
- Árvore estava limpa.
- Remoto: `https://github.com/Fabiomtt2/sosyt.git`.
- GitHub Pages do frontend: `https://fabiomtt2.github.io/sosyt/`.

## Preservar — já validado e NÃO regredir

- DDI internacional com bandeira e lista contida.
- DDD brasileiro em carrossel horizontal.
- grupos SOS YOUTUBER 1–999.
- botão `Quero participar` sem escudo/ícone verde no bloco de segurança.
- alinhamento geométrico do botão principal protegido por E2E <= 1 px.
- tela Owner com credencial `sosyout` em desenvolvimento.
- solicitação persistente + decisão Owner + aprovação.
- Filas persistentes, moedas, ledger, reprodução/progresso, conclusão e cooldown de tarefa.
- modal/configuração Meta + modo Híbrido + persistência server-side.
- backend local e frontend Pages são coisas diferentes; Pages não hospeda Fastify/SQLite/BOT.

## RED P0 — Owner pode herdar solicitação pendente/120 min de outra identidade

**CONFIRMADO NO CÓDIGO.**

`App.tsx` lê `PENDING_REQUEST_KEY` do `localStorage` no mount e restaura `joined` sem vincular o token à identidade/telefone digitado no login atual. Como a renderização prioriza `joined`, um Owner pode visualizar `Solicitação em análise`/contador de 120 min mesmo estando no fluxo de credencial administrativa.

Correção mínima exigida:
1. escopar o acompanhamento pendente ao WhatsApp/identidade correspondente;
2. nunca deixar `joined` sobrepor `step=credential` de Owner;
3. erro de credencial Owner deve permanecer apenas como erro de credencial, sem cadastro/penalização;
4. teste de regressão obrigatório: Owner reconhecido + credencial errada NÃO cria nem exibe solicitação, NÃO grava retry block e permanece na etapa Credencial;
5. explicar a tela de bloqueio somente quando for realmente um reenvio de solicitação do mesmo participante.

## RED P1 — DDD não possui filtro por digitação

**CONFIRMADO NO CÓDIGO.**

País/DDI já possui busca, mas `BRAZIL_DDDS` é renderizado integralmente no trilho. Digitar `71`, `55` etc. não filtra/salta para o DDD.

Correção desejada:
- permitir teclado/digitação no próprio seletor sem criar um campo visual pesado;
- ao digitar sequência numérica, filtrar ou saltar suavemente para DDD compatível;
- manter ‹/›, carrossel e layout atual;
- `Esc` continua fechando;
- teste de teclado/DDD 71.

## RED P1 — Configurar integração / modal WhatsApp visualmente inconsistente

Relato visual do usuário e indício estrutural no CSS: há múltiplas regras sucessivas para `.integration-modal`, `.astra-integration-modal`, cards e modos, favorecendo conflito/sobreposição.

Direção confirmada:
- botão `Configurar Integração` volta à paleta/layout vermelho ASTRA;
- modal deve ser redesenhado como composição única, sem caixas pretas/vermelhas desconexas nem tabelas sobrepostas;
- scroll interno deve funcionar; fundo permanece travado; `Esc` fecha ajuda primeiro e modal depois;
- termos técnicos ficam em português e usam `?` para explicação leiga + técnica;
- `CONFIGURAR BOT SOS YOUTUBE` em caixa alta com ícone pertinente;
- `AINDA INATIVO` sem emoji;
- ativo = verde + `ATIVO ✅`, derivado do estado do servidor.

### Modo Híbrido
- não usar o gradiente atual se visualmente agressivo;
- direção aprovada: estética vaporwave;
- símbolo visual deve mostrar Meta e YouTube de forma 50/50, sem corte;
- explicar claramente diferença:
  - Oficial = WhatsApp Business Platform/Meta;
  - Híbrido = Meta para comunicação + complemento opcional para grupos tradicionais/membros/admins;
  - Desativado = pausa automação externa, preserva dados e gestão manual.
- campos específicos de Híbrido aparecem somente quando esse modo estiver ativo.

## RED P1 — Dashboard Owner / usuários e pendências

Direção canônica:
- solicitação nova: `Novo Usuário!` em verde + `🔴 Registro pendente`;
- após aprovação, texto de pendência desaparece e vira `🟢 Usuário aprovado!`;
- dado do usuário NÃO some;
- aba Participantes deve mostrar `Aprovado em <data> às <hora> por <Owner>`;
- clicar no participante abre popup administrativo restrito ao Owner;
- popup agrega cadastro, grupo, WhatsApp, última atividade, saldo por origem, passes, cooldown, compras (`valor/tipo/status/criado em`) somente leitura e ledger;
- cadastro pode ser editado com validação;
- ações extras devem ser auditáveis: revogar/restaurar acesso, liberar cooldown, colocar/remover revisão da carteira, ajuste de moedas com motivo e autoria;
- transação Pix confirmada não deve ser editada retroativamente.

## RED P1 — Grupos e acesso

- cards têm função real: habilitar/desabilitar grupo e informar modo/estado da verificação;
- UI atual precisa ser explicada por `?` com popup fechável;
- grupos 1–999 continuam funcionais via carrossel/paginação, não apenas exemplos 1,2,10;
- `Autorização manual excepcional` é um fallback Owner para um participante já conferido; precisa de ajuda contextual;
- autorização manual deve pedir nome + WhatsApp + grupo e registrar data/Owner responsável;
- quando prova externa real estiver ativa, presença em grupo ≠ aprovação Owner; são provas distintas.

## P1 — Busca visual e TOC/alinhamento

Mesmo com o E2E anterior verde, o usuário ainda percebe desalinhamento entre `Quero participar` e `Continuar` no XFCE. Portanto:
- antes de mexer, abrir a versão corrente com cache-bust;
- capturar screenshot desktop real e medir os centros no browser;
- comparar não só bounding box, mas baseline visual/sombra/padding;
- não aceitar “teste passou” como prova suficiente se a evidência visual continuar ruim.

## Fechamento dos REDs desta rodada

- ✅ **P0 Owner × solicitação pendente:** corrigido. A candidatura persistente agora pode ser suprimida apenas na sessão atual quando o usuário escolhe outra identidade; Owner reconhecido tem prioridade absoluta para a etapa `Credencial`. Credencial errada não cria solicitação, não altera `blockedUntil` e não exibe cooldown de cadastro.
- ✅ **DDD incremental e contenção:** seletor brasileiro aceita busca invisível por teclado; `7` filtra 7x e `71` leva ao DDD 71, preservando o carrossel ‹/› e sem nova caixa visual. Auditoria visual posterior fixou o viewport em 5 colunas × 3 linhas completas (15 DDDs), sem cards parcialmente cortados e com teste explícito contra overflow horizontal.
- ✅ **Modal de integração:** criado `apps/client/src/integration.css` como skin canônica carregada após o CSS legado. Botão externo permanece vermelho ASTRA; modal branco/creme; cards de status brancos com acento lateral vermelho; Meta Oficial azul; Híbrido vaporwave com Meta/YouTube 50/50; Desativado cinza; scroll interno, Esc em camadas e ajudas contextuais preservados.
- ✅ **E2E:** cenário cobre os três pontos acima; o gate final com `integration.css` realmente carregado fechou verde 1/1 em 36,8 s, além de 65/65 testes de API, 9/9 testes de cliente, TypeScript e build/PWA verdes.

## Próxima ordem de execução

1. Revisar a evidência visual nova no XFCE/GitHub Pages com cache-bust.
2. Continuar refinamento administrativo apenas se a auditoria visual do usuário encontrar nova divergência real.
3. Backend HTTPS público continua sendo a dependência para BOT/SQLite/webhooks reais fora do Xubuntu.

## Regra de heartbeat reforçada

Durante esta rodada, qualquer execução prolongada deve emitir heartbeat ao usuário em cada marco e nunca ultrapassar ~5 minutos sem output.
