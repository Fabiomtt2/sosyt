# Conexão Youtube

MVP web + Android para grupos colaborarem na curadoria de ciclos com 10 vídeos e, por decisão explícita de cada participante, exportarem esses vídeos para uma playlist privada na própria conta do YouTube.

## Limite de produto

O projeto **não** automatiza visualizações, não reproduz vídeos em segundo plano e não concede créditos por assistir, curtir, compartilhar ou executar qualquer outra ação no YouTube. Esses mecanismos violariam as políticas de integridade de reprodução e engajamento da plataforma. Os créditos servem apenas para organizar contribuições dentro do próprio aplicativo.

## O que já está desenhado

- Login obrigatório com nome, telefone WhatsApp e código do grupo `SOS YOUTUBER`.
- Código de acesso de uso único; em desenvolvimento ele é devolvido na tela, e em produção deve ser entregue por um provedor WhatsApp aprovado.
- Quadro compartilhado, persistente e sequencial com 10 posições.
- Uma contribuição-base por usuário em cada ciclo; cada pacote Pix aprovado acrescenta 20 créditos e um passe para uma contribuição adicional.
- Saldo inicial de 10 créditos e custo de 1 crédito por link salvo.
- Validação estrutural da URL e, quando `YOUTUBE_API_KEY` estiver configurada, validação do vídeo na API oficial.
- Integração Pix via Mercado Pago, com confirmação no servidor e modo local de demonstração.
- OAuth Google/YouTube por usuário e exportação voluntária para playlist privada.
- Um único cliente React/PWA, empacotado no Android com Capacitor.

## Como executar

1. Copie `.env.example` para `.env` e troque os segredos.
2. Execute `npm install`.
3. Execute `npm run dev`.
4. Abra `http://localhost:5173`.

Para gerar o APK depois da primeira sincronização Android:

```sh
npm run android:sync
npm run android:apk
```

O APK de depuração será criado em `apps/client/android/app/build/outputs/apk/debug/`.

O build Android de desenvolvimento usa `http://10.0.2.2:3333`, endereço que aponta do emulador para a API executada no computador. Em aparelho físico, configure uma URL HTTPS acessível ou use encaminhamento de porta de desenvolvimento. O manifesto permite HTTP apenas no build `debug`; builds de produção continuam exigindo HTTPS.

## Produção

Antes de publicar, são obrigatórios: HTTPS; banco gerenciado; entrega real de OTP pelo WhatsApp; credenciais Google verificadas; credenciais Pix de produção; política de privacidade; termos; fluxo de exclusão de conta/dados; revisão LGPD; auditoria de conformidade do YouTube quando aplicável; logs e monitoramento. Nunca publique `.env` ou tokens.

Veja [docs/ARQUITETURA.md](docs/ARQUITETURA.md) e [PROJECT_STATUS.md](PROJECT_STATUS.md).
