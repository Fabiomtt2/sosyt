# CHECKPOINT DE RECUPERAÇÃO — 06/10/2026 02:47 -03

Estado Git comprovado antes de qualquer nova edição:
- branch: `main`
- HEAD local: `88a4b33d2035147fcf42b06ff1ae8ab419c8fa32`
- `origin/main`: `88a4b33d2035147fcf42b06ff1ae8ab419c8fa32`
- ahead/behind: `0/0`
- árvore: limpa
- remoto: `https://github.com/Fabiomtt2/sosyt.git`

## Recuperado e deve ser preservado

- GitHub Pages/publicação frontend já configurada para `/sosyt/`.
- Login internacional moderno: país/DDI + bandeira, DDD brasileiro quando aplicável, número numérico.
- País/DDI contido no layout com rolagem interna; DDD brasileiro em trilho horizontal.
- Grupo SOS YOUTUBER 1–999.
- `Quero participar` no botão vermelho simples ASTRA; sem escudo/ícone verde no bloco de segurança.
- E2E mede alinhamento de `Quero participar` × `Continuar` e `Entrar` com diferença máxima de 1 px.
- Modal de integração já possui scroll interno e fechamento por Esc em camadas.
- Dashboard Owner já diferencia Meta/Híbrido/Desativado e transporte ativo/inativo.
- Grupos e acesso já cobre 1–999 virtualmente.
- Autorização manual já usa o seletor internacional e seletor de grupo 1–999.
- Motor de filas, moedas, acompanhamento, cooldown de 30 min, persistência, bot/outbox/webhooks e verificação de grupo não deve ser reescrito nesta rodada.

## REDs críticos observados pelo usuário em 06/10/2026

1. **Owner não pode cair em solicitação/cooldown de 120 min por erro de credencial.**
   - Depois de nome + WhatsApp reconhecerem Owner, errar `sosyout` deve permanecer na etapa Owner e mostrar erro de credencial.
   - Fluxo de candidato/participante jamais deve ser acionado nesse caso.

2. **DDD precisa de busca incremental por teclado.**
   - Com seletor DDD brasileiro aberto, digitar `7` deve aproximar/filtrar para 7x; digitar `71` deve levar diretamente ao DDD 71.
   - Sem caixa de busca adicional.

3. **Modal “Configurar integração” exige revisão visual completa ASTRA.**
   - Botão de entrada volta à paleta/layout vermelho ASTRA.
   - Híbrido deve usar estética vaporwave refinada, não gradiente vermelho alto/estreito.
   - Ícones Meta e YouTube devem aparecer inteiros, 50/50, sem recorte.
   - Evitar sobreposição, tabelas/caixas agressivas e blocos pretos com texto vermelho.
   - Termos técnicos devem usar ajuda `?` contextual e linguagem leiga.

4. **Cooldown/penalização deve explicar causa real.**
   - Cooldown de 120 min refere-se apenas a repetição de solicitação/cadastro; nunca a erro de credencial Owner.
   - Cooldown de 30 min refere-se apenas a conclusão de tarefa/fila.
   - UI deve distinguir claramente os dois.

5. **Grupos/Acesso ainda precisa refinamento ASTRA.**
   - Preservar função real 1–999; não regredir para exemplos 1/2/10.
   - Corrigir inconsistências de altura, cores e blocos fora da identidade.
   - Ajuda `?` continua obrigatória para ações administrativas ambíguas.

## Protocolo desta rodada

- Aplicar mudanças mínimas sobre `88a4b33`.
- Não tocar na árvore histórica `Conexão Youtube`.
- Atualizar `docs/ANCHOR-YOUTUBE-FINAL.md`, `PROJECT_STATUS.md` e testes ao fechar os REDs.
- Gate obrigatório: `git diff --check`, `npm test`, `npm run lint`, `npm run build`, E2E.
- Heartbeat em cada marco importante e nunca ultrapassar aproximadamente 5 min em execução prolongada.
