# Auditoria visual Owner — 06/10/2026

## Escopo

Auditoria feita **olhando capturas novas do fluxo real Playwright**, não apenas lendo JSX/CSS. Superfícies inspecionadas: painel Owner desktop/mobile, configuração Pix, gerenciamento de grupo e integração WhatsApp.

## Evidências desta rodada

- `docs/evidencias/owner-pagamentos-before-audit-desktop.png` — estado que revelou cards estreitos, linguagem técnica, ausência de blur perceptível e hierarquia inadequada.
- `docs/evidencias/owner-pagamentos-after-audit-desktop.png` — popup Pix corrigido em desktop.
- `docs/evidencias/owner-pagamentos-after-audit-mobile.png` — popup Pix corrigido em mobile.
- `docs/evidencias/owner-grupo-gerenciar-desktop.png` — modal que separa habilitação interna de prova externa.
- `docs/evidencias/owner-desktop.png` — painel Owner final da rodada.
- `docs/evidencias/owner-mobile.png` — painel Owner final em viewport mobile.
- `docs/evidencias/owner-whatsapp-config-desktop.png` e `owner-whatsapp-config-top-desktop.png` — integração WhatsApp.

## Achados corrigidos

1. **Popup Pix espremido** — quatro escolhas competiam na mesma linha e “Desativado” parecia uma alternativa financeira. Agora existem três provedores em cards legíveis e a pausa de compras é uma ação separada.
2. **Linguagem de desenvolvedor** — `/v1/payments`, ECDSA, token/webhook sem contexto e Sandbox parecendo estado do próprio SOS. A superfície principal agora usa português leigo; detalhes técnicos ficam atrás de `?`.
3. **Sandbox mal contextualizado** — o painel agora diz explicitamente que o backend SOS já está online e que Produção/Teste se refere somente à conta/credenciais do provedor.
4. **Modal sem comportamento premium consistente** — blur, body lock, scroll interno, overscroll contido e rodapé de ações preso ao próprio popup foram validados por E2E.
5. **CSS legado concorrente** — havia uma segunda definição de `.payment-config-modal` impondo `overflow:hidden`. Foi removida; há uma única skin canônica do popup Pix.
6. **Tag estrutural herdando CSS global** — o título Pix usava `<header>` e herdava regras da barra principal, causando sobreposição. O wrapper deixou de ser `header`.
7. **Estado de grupos enganoso** — “Ativo” podia ser lido como “grupo WhatsApp comprovado”. Agora o Owner vê separadamente: habilitado no SOS, vínculo externo, verificação, última prova e link.
8. **Versão/sincronização técnica** — Git/WIP deixaram de ser o texto principal. A superfície diz “Painel sincronizado com o servidor”; detalhes de versão ficam na ajuda `?`.
9. **Status do bot técnico** — “Token necessário / API” foi substituído por “Falta configurar / chave de acesso / envio automático funcionando ou parado”.
10. **Mês em inglês** — o Owner exibe “Outubro de 2026”, preservando o seletor nativo por baixo.
11. **Abas mobile** — a aba escolhida é centralizada no trilho horizontal para não ficar parcialmente escondida.

## Regras UX canônicas extraídas da auditoria

- Owner pode ser extremamente leigo. **Texto principal deve responder “o que é / para que serve / está funcionando?”**.
- Termos como token, webhook, Access Token, API Key, assinatura e ambiente devem vir acompanhados de `?` com explicação simples e, quando útil, instrução de onde obter o dado.
- Popup administrativo abre sobre fundo borrado e travado; quem rola é o popup, não a página atrás.
- Não usar `header` global dentro de modal sem proteção explícita.
- Não chamar um estado externo de “ativo/confirmado” sem evidência do provedor.
- “Salvar” de uma configuração Owner deve persistir server-side e afetar **novas operações reais** imediatamente; histórico anterior conserva o provider/origem original.
- Segredos nunca voltam preenchidos no navegador; a UI recebe apenas “configurado / não configurado”.

## Gate associado

- API: **67/67**
- Cliente: **9/9**
- TypeScript/lint: verde
- Build API + React/PWA: verde
- Playwright E2E: **1/1**
- Evidências visuais abertas e inspecionadas após o gate.

## Limites

Screenshots permitem auditar aparência, hierarquia, overflow e estados capturados. Elas não provam acessibilidade completa por teclado/leitor de tela nem funcionamento real de contas financeiras sem credenciais reais; essas validações permanecem separadas.
