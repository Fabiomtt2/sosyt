# Publicação real do SOS YouTuber — 15/10/2026

A aplicação manual das sete alterações por Fábio concluiu a publicação da versão auditada. O patch pendente desapareceu; API e Web estão online, sem ocorrências, com uma réplica em execução cada.

| Componente | Deployment | Commit | Estado |
|---|---|---|---|
| API | ad9c094f-c783-4c0e-a1ba-8f64147758d5 | 586ca4028b1de20f8b5aa6bbd1396b6948032699 | SUCCESS |
| Web | 27559349-38d7-434c-9107-9a975799c0e8 | 586ca4028b1de20f8b5aa6bbd1396b6948032699 | SUCCESS |

API pronta em 15/10 às 03:19:32 e Web em 03:19:48, America/Bahia. Fonte de ambas: Fabiomtt2/sosyt, main, sem a fixação antiga 65d5b2c. Commits documentais posteriores não mudam o código de produto nem exigem nova implantação.

## Evidência de execução

- Web: https://sos-youtuber-web-production.up.railway.app
- API: https://sos-youtuber-api-production.up.railway.app
- /health público: ok=true, release=jornada-20261014, capacidades gamification-v1, reward-redemption-v1 e bot-password-v1.
- Log API confirmou backup SQLite consistente antes das migrações: /data/backups/pre-payment-benefits-1792045169222-b144ad30-c0c7-4239-8b35-23f245d44629.sqlite.
- Volume existente sos-youtuber-data, 500MB, permanece montado em /data.
- Log Web demonstrou espera pela API compatível e liberação apenas após confirmar suas capacidades.
- Nenhum patch pendente; nenhuma falha recente na consulta final.

## Smoke público

Fábio e Rafael reautenticaram HTTP200. Ambos retornam ROOT_OWNER, canConfigure=true e canManageOwners=true. Não foram trocadas credenciais.

GETs autenticados confirmaram regras de XP, preços de troca de 100 moedas de recompensa para Passe/Pular, probabilidades somando 100%, cinco eventos do bot ligados ao runtime e configuração de senha inicial. Modo participante administrativo abriu dashboard/Jornada/chat/correio, com nível1, cooldown de chat0 e booster indisponível na quinta-feira.

Chromium abriu a URL de produção de verdade, com cache-bust e sessões autenticadas. Verificou login, Jornada Owner, modo participante do Owner, progresso, chat público, loja e ausência da oferta de booster fora da sexta. Desktop1440 e mobile390 sem overflow nos painéis inspecionados. Não houve erro JavaScript nem resposta HTTP5xx nessa navegação. O teste público não realizou compras, resgates, mensagens ou alterações de avatar.

Capturas públicas sem conta identificada:
- docs/evidencias/production-login-1440.png
- docs/evidencias/production-login-390.png

Capturas autenticadas permanecem em arquivos privados ignorados. O integrador abriu as capturas reais mobile de login, Jornada e loja.

## Passe recuperado na configuração

A loja de produção tinha PASS_SINGLE cadastrado, porém active=false. Conforme a instrução explícita de Fábio para oferecer Passe e Pular, em 15/10 às03:39 foi aplicado somente active=true pela API Root.

Preço R$20, concessão de1passe, zero moedas, imagem, descrição, ordem e demais dados foram preservados. A releitura da API e a nova navegação pública confirmaram os quatro produtos: COINS_10, SKIP_1, SUPER_30 e PASS_SINGLE. O pacote legado COINS_LAUNCH com passe bônus permanece inativo. A configuração continua editável pelo Owner e persiste no servidor.

## Configurações externas ainda necessárias

Publicação do código não fornece credenciais de terceiros:

- WhatsApp: modo salvo OFFICIAL, officialReady=false; não foram fabricados tokens, ativado Híbrido+ sem provedores ou prometidos envios. As cinco automações de Jornada e a senha inicial respeitam os pré-requisitos de envio.
- Pix: provider=DISABLED, ambiente PRODUCTION, ready=false. Não há provedor financeiro real ativado.
- YouTube: chave de validação presente, verification=VERIFIED. Google OAuth não configurado; GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET ausentes no ambiente da API e também nos .env locais canônicos/históricos consultados. Conectar canais e criar playlists pela conta do usuário requer esses valores e o redirect autorizado no Google. Login Google também depende deles.

O teste anterior isolado permanece GREEN: 292 API, 25 cliente e8cenários Chromium, lint/TypeScript/build/diff. Ele cobre operações mutáveis com fixtures, não substitui consentimento OAuth ou a configuração de pagamentos/mensagens reais.

## Continuidade

O bloqueio anterior de accept-deploy é histórico: Fábio concluiu a operação no painel. Não repetir a aplicação nem criar serviços/volumes duplicados. Código atual publicado; manter o volume, credenciais e regras dos Root Owners. Próximo trabalho externo: completar as credenciais de integrações e validar seus fluxos reais quando disponíveis.
