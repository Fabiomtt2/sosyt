# Estado do projeto

## HEAD esperado

Branch `main`, repositório autônomo e inteiramente contido na pasta `Conexão Youtube`.

## Decisões que não devem ser revertidas sem revisão

1. Não recompensar tempo assistido e não permitir reprodução em segundo plano.
2. Não prometer aumento de views; o produto é uma ferramenta de curadoria e exportação voluntária.
3. Playlist criada como `private` por padrão.
4. Valores monetários e créditos são inteiros (`centavos` e `milicréditos`) para evitar erro de ponto flutuante.
5. Pagamentos só geram saldo após confirmação servidor-servidor.
6. Uma compra aprovada de R$ 20 concede 20 créditos comprados e um passe extra.
7. O ciclo fecha com 10 links, premia a curadoria interna com 1 crédito por participante distinto e abre automaticamente o próximo ciclo.

## Próximos marcos

- Instalar dependências e executar testes/build.
- Gerar o projeto Android e o APK de depuração.
- Configurar credenciais externas para teste real de Google OAuth, YouTube Data API e Pix.
- Substituir OTP de desenvolvimento por entrega WhatsApp aprovada.

