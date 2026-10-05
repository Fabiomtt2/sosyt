# Pesquisa de componentes e integrações — Astra, 2026-10-05

A pesquisa priorizou projetos oficiais e compatibilidade com o motor existente, evitando substituir a aplicação por projetos de procedência desconhecida.

| Fonte | Decisão | Utilidade |
| --- | --- | --- |
| https://github.com/fastify/fastify-rate-limit | Incorporado: versão 10, compatível com Fastify 5 | Limites de tentativas de OTP, Owner e solicitação |
| https://github.com/fastify/fastify-helmet | Incorporado: versão 13, compatível com Fastify 5 | Cabeçalhos de segurança na API |
| https://github.com/fbsamples/whatsapp-api-examples | Referência; nenhum código copiado | Exemplos oficiais Meta de mensagens, templates e webhooks para futura entrega OTP; licença Meta Platform Policy |
| https://github.com/mercadopago/sdk-nodejs | Referência; SDK não instalado | SDK oficial MIT com timeout/idempotência; mantido o adaptador existente, com confirmação e assinatura |
| https://developers.google.com/youtube/v3/docs/playlists/list | Aplicado no adaptador | Procurar playlist de uma tentativa anterior pelo marcador de exportação |
| https://developers.google.com/youtube/v3/docs/playlistItems/list | Aplicado no adaptador | Conferir prefixo remoto e retomar inclusão sem duplicar vídeos já criados |
| https://developers.google.com/youtube/terms/developer-policies-guide | Limite de produto registrado | Proíbe incentivar assistir e reprodução em segundo plano; não construir recompensa de watch time |

A pesquisa não comprovou acesso autorizado aos membros dos grupos comuns já existentes. O MVP usa aprovação manual de telefone e grupo pelo Owner; não adota automação não oficial do WhatsApp Web. Mensagem wa.me depende da confirmação de envio pelo usuário e não equivale a entrega automática.

As integrações externas foram testadas com respostas controladas; não houve criação real de playlist nem recebimento de Pix nesta etapa. A recuperação de exportação reduz duplicações, mas não oferece garantia absoluta frente à consistência eventual da API, remoção da referência pelo usuário ou falhas externas.
