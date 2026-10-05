# Especificação canônica — YouTube Final

Data: 05/10/2026. Esta especificação consolida a intenção de produto do usuário com a implementação auditada e com os limites atuais das APIs.

## Requisitos incorporados

| Requisito | Estado final |
| --- | --- |
| Owners Fabio0 e Rafael0 | Implementado; contas independentes, marcador `#` e credenciais separadas |
| Marcador Owner `#` | Implementado |
| Nome/WhatsApp/grupo para participante | Implementado |
| Quadro compartilhado entre todos os grupos | Implementado |
| Exatamente 10 posições sequenciais | Implementado |
| Link salvo torna-se permanente no ciclo | Implementado |
| Autor, grupo e horário ao lado do link | Implementado |
| Rejeitar URL fora do YouTube | Implementado |
| Criar playlist apenas após 10 links | Implementado |
| Apenas participantes daquele ciclo podem criar | Implementado |
| Modal/consentimento antes do OAuth Google | Implementado |
| Playlist privada na conta do usuário | Implementado |
| Solicitação “Quero participar!” | Implementado |
| Mensagem WhatsApp preenchida para início | Implementado via click-to-chat; o usuário confirma o envio |
| Resposta automática acolhedora | Adaptador implementado; depende de Meta real |
| Capturar nome autodeclarado pelo WhatsApp | Implementado no webhook |
| Mostrar solicitação pendente ao Owner | Implementado |
| Alertar Fabio0/Rafael0 sobre novas pendências | Implementado via template/fila; depende de Meta real e de contato válido configurado |
| OTP via WhatsApp | Adaptador implementado; depende de template/credenciais Meta |
| Pix e créditos/passes | Implementado; teste real ainda pendente |

## Requisito ainda condicionado

A ideia de identificar automaticamente o grupo SOS YOUTUBER pela presença do número em um grupo WhatsApp é desejável, mas não deve ser simulada. A implementação atual mantém `group_memberships` como autorização do Owner. Só substituir essa etapa por sincronização automática quando a conta Meta, os grupos existentes e a API oficial comprovarem suporte ao caso de uso.

O número/grupo digitado pelo usuário nunca deve, sozinho, ser considerado prova de pertencimento.

## Watch time, OCR e espelhamento de tela

Não integrar ao produto recompensas baseadas em assistir vídeos, ainda que a verificação use Python, OCR, screenshot periódico, espelhamento da tela, QtScrcpy, foco da janela ou progresso do player.

Motivos:
- o YouTube proíbe incentivos/recompensas por assistir ou interagir com vídeos;
- o YouTube proíbe background playback em clientes da API;
- observar a tela do usuário cria uma camada adicional de privacidade e segurança sem resolver o conflito de política;
- OCR/progresso visual não prova atenção humana de forma confiável.

A alternativa canônica é recompensar ações independentes de consumo de vídeo, como curadoria/contribuição válida. A implementação atual concede recompensa de curadoria ao fechar o ciclo.

## Progresso permitido na interface

Há dois indicadores distintos:

1. No modal `Criar playlist`, a barra representa somente o progresso técnico de inclusão dos 10 itens (0–10 / 0–100%).
2. Depois de uma playlist criada, `Acompanhar reprodução` usa a IFrame Player API oficial para exibir progresso local informativo. Só contabiliza avanço natural enquanto o player está em estado de reprodução e a aba está visível; saltos grandes/seek não são creditados. A continuidade é salva localmente por usuário, ciclo e playlist.

O segundo indicador não é prova absoluta de atenção humana e não pode ser convertido automaticamente em moedas/recompensa por visualização.

## Segurança e privacidade

Antes de produção:
- publicar política de privacidade acessível e termos;
- informar uso da YouTube API e linkar termos/políticas exigidos;
- oferecer processo de exclusão/revogação de dados;
- definir retenção de telefones, solicitações, mensagens/outbox e tokens Google;
- manter segredos exclusivamente no servidor;
- validar integrações reais antes de anunciar automação completa.

## Referências oficiais de política

- https://developers.google.com/youtube/terms/developer-policies
- https://developers.google.com/youtube/terms/developer-policies-guide
- https://developers.google.com/youtube/terms/api-services-terms-of-service/
- `docs/WHATSAPP-INTEGRACAO.md` registra as referências Meta consultadas para Cloud API e grupos.

## Regra de continuidade

Mudanças futuras que reintroduzam recompensa por watch time, reprodução oculta/background, automação de views ou falsa comprovação de pertencimento ao grupo devem ser tratadas como regressão de produto/compliance e não incorporadas sem uma nova base oficial que altere essas restrições.
