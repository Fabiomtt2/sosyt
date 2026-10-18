# Auditoria — participante curiosa — 18/10/2026

## Método e limite
Persona: participante comum, empática, que pergunta como funciona cada etapa.
Li AGENTS.md e docs/INCIDENTE-BOT-ACESSO-20261018.md. Inspeção efetiva de pixels por DC read_file; nenhum navegador ou teste paralelo iniciado. Capturas sintéticas da rodada iniciada aproximadamente 08:23 são evidência atual da árvore em validação, ainda não evidência de produção publicada. Nenhum dado real foi copiado para este relatório.

## Evidências atuais abertas com os olhos
- docs/evidencias/access-after-1440.png e access-after-390.png, 08:24.
- docs/evidencias/room-admin-after-390.png e room-member-cooldown-390.png, 08:24.
- docs/evidencias/commerce-items-1440.png e commerce-items-390.png, 08:25.
- .local-tmp/bot-runtime-after-390.png, 08:25.

## Achados comprovados nesta rodada
1. **Inventário incompleto na loja.** O resumo visível mostra moedas, passes e Pular, sem SUPER ativo/inativo ou expiração. Pergunta da participante: “Já sou SUPER? Até quando?”. Mostrar os quatro benefícios em resumo consistente, preservando as quantidades e preços existentes.
2. **Hierarquia comercial ainda diverge da decisão.** As capturas mostram 10 moedas primeiro e Pular em seguida; SUPER não aparece acima dos demais produtos no início da loja. Fazer SUPER descobrível no topo, com assinatura/expiração e benefícios concretos, sem esconder moedas e sem trocar preços aprovados.
3. **Chat aberto ocupa grande parte do mobile.** Aproximadamente 43% da captura de 960px, cobrindo o conteúdo principal da fila/banner. O cabeçalho permite recolher, mas a participante precisa descobrir isso. Sugerido abrir recolhido em primeiro acesso móvel, preservar preferência, exibir contagem de novas mensagens e expandir por gesto/clique. Manter sala global fixa e acessível.
4. **Login repete a explicação de grupo.** A frase sobre conta e entrada no grupo aparece na introdução e no bloco informativo. O conjunto é legível e coerente em creme/ameixa, mas a repetição aumenta a altura no celular. Deixar uma instrução de ação junto à senha e um estado de grupo após entrar. “Continuar” poderia ser “Entrar na minha conta” para distinguir cadastro e acesso.
5. **Ações administrativas e competição precisam de distinção na apresentação.** Na captura Root, o dashboard exibe “Sua fila” e “Entrar em outra fila · ∞ Pular”. Isso não prova participação indevida no motor, mas comunica competição pessoal para quem é administrador fora de competição. Usar copy administrativa quando o contexto for Root.

## Propostas criativas úteis, com prioridade
- **Primeiros passos em três fatos reais:** conta criada, presença no grupo confirmada, primeiro vídeo enviado. Cada passo deve mostrar o estado do backend e uma próxima ação; não outro tutorial longo.
- **Atendimento humano no mesmo chat:** indicador “Rafael assumiu o atendimento”, aviso de espera claro, voltar ao bot e encerramento confirmado. A conversa deve continuar pelo número do bot; notificar o humano isoladamente não satisfaz o fluxo.
- **Bot varia contexto, não só sinônimos:** acolhimento inicial, retorno conhecido, próxima ação na fila, progresso verificado e suporte têm famílias próprias. Evitar repetir a última variante por conversa. Mensagens transacionais de senha devem permanecer claras e estáveis.
- **Ranking com caminho de ação:** cartão compacto “sua posição / próximo marco / como é calculado”, com link para ranking global e TOP3 mensal; nunca prometer XP por envio ou abertura sem prova.
- **Artes por função:** Pular precisa comunicar duas filas simultâneas; SUPER precisa identidade vaporwave própria. Emblemas de níveis baixos discretos e progressão visível nas 12 faixas; nova arte deve resolver entendimento, sem poluir cada linha.

## Referência histórica, não certificação da rodada atual
Também abri journey-390.png (08:13), premium-participant-390.png, premium-messages-390.png e premium-store-super-390.png (01:03), além de password-group-pending-390.png (01:01). Nelas há grade uniforme dos próximos níveis, repetição do destinatário no correio, e arte de SUPER/Pular pouco distinta. Esses pontos precisam ser recapturados após o gate; não os classifico como defeitos confirmados da versão final atual.

## Não verificado
Não naveguei pessoalmente pela carteira completa, ranking, perfil/avatar ampliado, catálogo, faixas de emblemas, fluxo de amizade, correio atual, cooldown completo ou todas as abas Owner. Captura da sala com cooldown de chat não equivale à página de cooldown de filas. Não confirmei nitidez do avatar ampliado nem número de emblemas disponíveis. Não afirmo auditoria visual completa ou funcionamento real do WhatsApp a partir de screenshot.
