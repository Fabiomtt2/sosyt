# Auditoria de comércio e identidade — 14/10/2026

Estado: implementação validada localmente, sem merge ou deploy desta rodada. Base: `f730ecf`, branch `astra/convergencia-20261012`, PR #3. Este relatório complementa `AUDITORIA-PRODUTO-ASTRA-20261013.md`.

## Regras preservadas

- Moedas, Passe, Pular e SUPER são benefícios diferentes. O pacote atual de 10 moedas por R$20 não recupera o passe bônus antigo. Preços e estados configurados pelos Owners prevalecem.
- Pular abre outra fila e mantém a participação na anterior; Passe permite contribuição extra na mesma fila, ainda consumindo uma moeda ao salvar.
- O selo público é ADMIN. Fábio e Rafael continuam ROOT_OWNER; nomes de roles internos não foram renomeados.
- SUPER destaca a identidade enquanto a assinatura está ativa. A imagem escolhida pelo usuário permanece a mesma.
- Número Business público e integrações anteriores preservados. Nenhuma credencial, saldo ou configuração de produção alterados.

## Problemas encontrados e correções

| Problema real | Correção | Evidência |
|---|---|---|
| Banco antigo já preenchido não recebia novos produtos | Seed aditivo por código, sem sobrescrever preços, imagens ou ativação | Teste de migração com oferta editada pelo Owner |
| Avatar e moldura confundiam tier da arte com assinatura | Apresentação pública derivada do servidor, compartilhada por perfil, fila, chat e DM | API e Chromium com avatar 17, ativação e expiração |
| Mensagens SUPER herdavam contraste inadequado | Texto escuro em fundo lavanda, avatar consistente e selo | Capturas desktop/mobile |
| Compra não tinha recibo dos benefícios realmente aplicados | Recibo autenticado por usuário, baseado em ledger e concessões imutáveis | Compra de cada produto; histórico não muda após editar catálogo |
| Fechar/recarregar checkout perdia acompanhamento visual | IDs pendentes persistidos por usuário e reconciliação com servidor | Aprovação após fechar, reload e confirmação única |
| Repetir webhook após erro poderia perder conciliação | Evento registrado somente depois da consulta e aplicação bem-sucedidas | Falha transitória Asaas seguida de retry e deduplicação |
| Repetir uma ação Pular poderia consumir outra unidade | Identificador de intenção, consumo e entrada em transação | Retry retorna a mesma fila e consome uma unidade |
| SUPER recém-ativado ainda recebia espera visual de 180 s | Sincronização da assinatura e uso do papel confirmado pelo servidor | Duas mensagens consecutivas no navegador |
| Inventário afastava a conversa no celular | Recolhimento ao selecionar uma conversa | DM em 390 px com compositor visível |
| Armazenamento que permite leitura mas recusa gravação repetia confirmação | Histórico em memória para falhas de escrita | Teste com quota recusada |
| Retorno do participante administrativo restaurava nome legado | Sessão Owner mantém o nome público no mesmo usuário e considera o telefone efetivo persistido | API com nome legado e alteração do telefone; E2E exige Fábio após o retorno |

## Experiência entregue

Loja lateral com quatro tipos de benefício e artes coerentes com o catálogo. A revisão visual final encontrou a antiga arte do Passe com preço gravado e estética de jogo; o fallback foi substituído por um bilhete vetorial/CSS sem preço ou quantidade embutidos. Imagens personalizadas do Owner continuam prevalecendo. Explicações recolhíveis reduzem texto repetido; preço, título, imagem e quantidades continuam vindos do servidor. O SUPER mantém convite animado e moldura própria. A confirmação apresenta a quantidade efetivamente recebida, com partículas e incremento junto ao saldo/inventário quando o destino está visível. SUPER recebe uma confirmação visual especial. Preferência de movimento reduzido desliga as animações decorativas.

Nenhuma celebração se baseia apenas no aumento do saldo: recompensas, presentes e recargas do painel não são confundidos com uma compra. O servidor permanece responsável pelo crédito. A deduplicação visual no aparelho não substitui a idempotência financeira.

## Revisão visual real

Capturas desta rodada abertas e inspecionadas: loja mobile, confirmação de moedas desktop, boas-vindas SUPER desktop, chat público desktop e DM mobile. Foram avaliados contraste, recortes, legibilidade, molduras, posição do incremento e compositor da conversa. Outros fluxos são cobertos pelos cenários integrados Owner/participante; isso não significa 100% de estados possíveis ou certificação da produção.

Evidências principais em `docs/evidencias/commerce-*.png`. Screenshots são de Chromium local com usuários e pagamentos de teste; não demonstram pagamento real, OAuth real ou transporte WhatsApp ativo.

## Gate e publicação

API **259/259**, cliente **25/25**, lint/TypeScript e build passaram. E2E conjunto **6/6 GREEN**, incluindo a repetição após corrigir a arte do Passe encontrada na inspeção visual. Capturas novas premium-store-pass-1440.png e premium-store-pass-390.png, com geometria conferida no teste e inspeção visual manual do celular. O build preserva um aviso de bundle principal acima de 500 kB (652 kB minificado); divisão por rotas fica como melhoria posterior, sem relaxar o limite. A primeira execução conjunta expôs colisões de seletores entre cenários e logins de preparação repetidos. A sessão de preparação passou a ser compartilhada e validada, mantendo o teste de login inválido/válido na interface e os limitadores reais. Verificações antigas do selo, catálogo e mensagem de compra foram atualizadas para as regras atuais.

Não publicar isoladamente o frontend: o novo contrato de recibos e apresentação exige a API correspondente. Railway permanece bloqueado pelo cancelamento anterior na camada de aprovação, apesar da autorização do usuário e da configuração Allow all actions. A causa específica não foi informada pelo conector. Nenhuma tentativa de contorno foi executada. Consulta nova em 14/10 confirmou Web e API online, SUCCESS, 1/1 réplica cada, sem falhas recentes, volume de 500 MB em /data. O patch d1be5c2e-d014-4ee2-bfab-9f295ea61286 continua staged, apenas removendo a fixação ao commit 65d5b2c; não foi aplicado.

## Limites e próximos passos de produto

- Um produto que o Owner já desativou continua desativado. O Passe é ativo em novos bancos/linhas ausentes; uma linha legada inativa deve ser revisada no painel, sem alteração silenciosa de configuração.
- Pendências de compra são retomadas neste navegador; limpar os dados locais remove o acompanhamento visual, mas não remove pagamento, inventário ou ledger no servidor.
- Eu priorizaria para o Owner uma visão de conciliação com pedido, confirmação e benefício entregue na mesma linha, antes de adicionar novos fornecedores. Para o participante, um acesso direto ao inventário separado das conversas ajudaria quando o catálogo crescer. Não acrescentei telas extras nesta rodada.

## Commits e publicação da branch

Código e capturas publicados e verificados em `d2f37dc43ef012bd639fd69b61c1f3006a0acf11`. Documento consolidado em commit posterior da mesma branch; consultar HEAD/origin. PR #3 permanece draft; main e Railway não foram alterados.

- `bb50160` — fix(api): reconcile purchases and subscription identity
- `82de447` — fix(auth): preserve owner identity across participant sessions
- `840903a` — feat(web): celebrate purchases and unify premium community identity
- `d2f37dc` — test(e2e): verify commerce and refresh responsive visual evidence
