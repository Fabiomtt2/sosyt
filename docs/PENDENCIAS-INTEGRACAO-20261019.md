# Pedidos preservados e lacunas atuais

Este registro conserva o relato de Fábio de18/10 e a regra de19/10UTC. Funcionalidade escrita, teste automatizado, inspeção visual e prova em produção são estados diferentes.

| Frente | Convergido nesta rodada | Ainda requer conclusão/prova |
|---|---|---|
| Bot e suporte | Código curto/aspas, Admin:, acentos/sinônimos, senha, prioridadeDM e fila durável | Roundtrip humano real após deploy; não certificar somenteproviderSENT |
| Grupos | Inclusão pós-cadastro, menor grupo real comvaga, múltiplas provas e nomes $N$ | Confirmar inclusão em grupo real e permissõesBot após deploy; não fabricargrupo3 |
| Saudações | Todos grupos ligados, dedupegrupo/dia, reserva dentrodacota | Acompanhar ciclo real seguinte e motivos de supressão; não remover freios |
| Filas | Passe/Pular, diretório ocupação, saída60min, retomar histórico,72h e renovação1 | Navegador após nova integração; perfis acionáveis em todas superfícies de fila/rank ainda devem ser conferidos |
| Playlist e observador | Snapshot parcial, XPsemmoedas, observação por relógio/intervalos/duraçãoYouTube; awaitguards | CredenciaisGoogle produção e autorização real; não alegar atenção humana comprovada por câmera/terceiroolho |
| Amigos/correio | Solicitações, aceitar/recusar/remover/bloquear, consentimentoDM, badge e presentes pororigem | Duas sessões navegador e imagens novas, leitura em mobile |
| Owner | PromoverADMIN nomecomum; suspensão inclusivecontasemgrupo; SUPERporusuárioreal; painelcomunitário | ConcederSUPER via navegador; reset de participante no modal ainda precisa melhor descoberta |
| Controle de participante | Revogar/restaurar, carteira, dados, histórico e origem jáexistem | AçãoRoot para trocar avatar de outro usuário não implementada; concessões de qualqueritem/Passe em um único painel ainda não integradas |
| Auditoria de correio | /admin/mail Root jáexiste e mantém histórico | Identidade remetente/destinatário, navegação/cursor e log de leitura precisam refinamento; não criar cópia financeira nem expor paraADMIN |
| Design Owner | Menu/comunidade/acesso e IDs melhorados | Revisão completa página por página, atitudes/jornada/grupos e textos truncados não certificada |
| Avatar/emblemas | Catálogo120+40, tiers/subcategorias,12artes agora ligadas ao catálogo do servidor, RootforaXP | Prancha12emblemas32/48px aberta; imagem no chat/jornada ainda precisa prova da rodadafinal4; clássico80px mantém limite nativo |
| Loja/feedback | SUPERprimeiro,4itens, arte raster, confirmaçãoPix e troca de moedas | Capturas atuais desktop/mobile e teste real de pagamento após configurar gateway |
| Entrada/carrossel | Flash1.9s semredirecionar,3voltas+fade, ampulheta nova | Abrir frames novos; sem inventar auditoria a partir deCSS/DOM |
| Integrações externas | Evolution no ar, transporte único comfreios | MercadoPago credenciais e webhook; GoogleclientID/secret; IAconversacional só com fatos do sistema ainda não adicionada |

Senhas existentes são hashes. Controle administrativo deve oferecer reset auditável; não inventar exibição de senha em claro que não existe no banco.

## Mercado Pago — conta do Fábio
1. Em MercadoPagoDevelopers →Suas integrações, criar/abrir app CheckoutTransparente viaAPI Payments; cadastrar URLpúblicaWeb do projeto.
2. Produção →Credenciais de produção: ativar com dados do negócio e obterAccessToken.
3. Webhooks →Configurar notificações: evento **Pagamentos (payment)**, pois este projeto usa /v1/payments; URL https://sos-youtuber-api-production.up.railway.app/payments/webhooks/mercado-pago . Salvar e obterassinaturasecreta.
4. SOSRoot →Pagamentos →Configurar pagamentos: MercadoPago, Produção, AccessToken eassinaturasecreta; salvar e conferir estadoPronto. Não alterar preços aprovados para testar.
5. Gerar compra do catálogo, pagar pelo titular e confirmar aprovação, recibo e crédito único. Simulação não prova Pix real.
Fontes oficiais consultadas: https://www.mercadopago.com.br/developers/pt/docs/checkout-api-payments/additional-content/your-integrations/credentials e https://www.mercadopago.com.br/developers/pt/docs/checkout-api-payments/additional-content/your-integrations/notifications/webhooks .
