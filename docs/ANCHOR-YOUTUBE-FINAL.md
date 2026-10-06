# ÂNCORA CANÔNICA — YOUTUBE FINAL

Data-base: 05/10/2026.

> LEITURA OBRIGATÓRIA. Este arquivo é a fonte de verdade de produto e continuidade do repositório YouTube Final.
> Toda instância/agente deve lê-lo antes de editar. Mudança de regra validada pelo usuário deve atualizar esta âncora no mesmo checkpoint.

## 1. Governança

- Projeto mutável: `YouTube Final`.
- `Conexão Youtube` é origem histórica ASTRA para auditoria/comparação; não editar durante convergências.
- Antes de qualquer edição: `git status --short`, `git log -5 --oneline`, ler `AGENTS.md`, esta âncora, `PROJECT_STATUS.md` e as skills de continuidade/recuperação.
- Nunca reset/clean/stash ou descarte de WIP sem autorização explícita.
- Git, testes e handoffs validados têm precedência sobre memória do agente.
- Heartbeat ao usuário em marcos importantes e no máximo aproximadamente 5 minutos em execução prolongada.
- Segredos, telefones reais e tokens nunca são versionados; ficam no `.env` ignorado.

## 2. Identidades e acesso

- Tela de entrada é neutra: nome + WhatsApp internacional + grupo SOS YOUTUBER 1–99.
- Nunca forçar `+55`; telefone é internacional.
- Nome de Owner é comparado sem diferenciar maiúsculas/minúsculas, acentos e alias final `0`.
- Owners canônicos: `Fabio0` e `Rafael0`; aliases `Fábio/Fabio` e `Rafael` são válidos quando o WhatsApp correspondente também confere.
- Telefones Owner reais ficam em `OWNER_FABIO_WHATSAPP` e `OWNER_RAFAEL_WHATSAPP`.
- Durante homologação, ambos os Owners podem ser usados; a ausência física de Rafael não bloqueia testes com a conta Fábio.
- Somente Owner identificado vê o campo `Credencial`; em desenvolvimento, `sosyout` é a credencial de teste.
- O dashboard Owner mostra o alias efetivamente digitado no login, sem reescrevê-lo para o nome canônico.
- `#` é marcador interno; nunca aparece como credencial, grupo ou instrução na UI.

## 3. Cadastro de participante

- Existe uma única CTA principal `Quero participar`.
- Fluxo: dados → solicitação pendente → dashboard Owner + bot → aprovação → login direto.
- Participante comum nunca recebe campo de Credencial/OTP no fluxo principal.
- Tentativa de login ainda não aprovada vira cadastro pendente amigável; não apresentar 403 cru ao usuário.
- Mensagem de sucesso canônica:
  - “Sua solicitação de cadastro foi registrada e será validada em breve.”
  - “<nome>, agora só falta uma etapa para você participar do nosso sistema!”
  - “Nós entraremos em contato com seu número WhatsApp informado em breve para seguirmos com o registro.”
- Aprovação preserva nome, WhatsApp, grupo, saldos e histórico.
- Login aprovado exige grupo compatível com o cadastro.
- A meta do modo verificado é dupla checagem: aprovação Owner + presença real no grupo informado + confirmação de que pelo menos um Owner configurado é administrador do grupo.

## 4. WhatsApp — arquitetura

### Estado oficial

- O código possui adaptador Meta Cloud API, webhook assinado, outbox persistente, retry/backoff, alertas Owner e sincronização oficial de grupos.
- Números Owner podem estar configurados mesmo quando o transporte Meta ainda não está conectado.
- `OWNER_WHATSAPP` dedicado é opcional; na ausência, Rafael é o contato público de fallback.
- Aprovação de participante não gera OTP; após aprovação, nome + WhatsApp + grupo bastam.

### Provedores

Três modos de operação devem ser suportados pelo dashboard:

1. **Oficial / Meta** — mensagens e webhooks pela WhatsApp Business Platform.
2. **Híbrido** — Meta como canal oficial de comunicação + WPPConnect como complemento opcional para grupos tradicionais/membros/admins.
3. **Desativado** — nenhuma automação externa; dashboard/manual permanece disponível.

- O modo complementar deve trazer aviso amigável: usa WhatsApp Web, pode exigir QR, pode quebrar após mudanças do WhatsApp e pode causar restrições na conta; nunca ativar silenciosamente.
- Não deixar Meta e WPPConnect enviarem a mesma mensagem sem deduplicação/roteamento explícito.
- WPPConnect deve preferencialmente atuar como prova complementar de grupo/admin; Meta continua sendo o transporte oficial sempre que disponível.
- A prova de presença em grupo não deve ser confundida com aprovação Owner.

## 5. Credenciais Meta necessárias

Nunca versionar valores. Variáveis previstas:
- `WHATSAPP_PHONE_NUMBER_ID`
- `WHATSAPP_BUSINESS_ACCOUNT_ID`
- `WHATSAPP_ACCESS_TOKEN` (preferir System User)
- `WHATSAPP_APP_SECRET`
- `WHATSAPP_VERIFY_TOKEN`
- `WHATSAPP_OWNER_ALERT_TEMPLATE`
- `WHATSAPP_DECISION_TEMPLATE`
- `WHATSAPP_GRAPH_VERSION`
- URLs públicas HTTPS para webhook/API.

Ações manuais do responsável Meta: login/consentimento, eventual verificação do negócio, verificação do telefone por SMS/voz e aprovação de templates. O restante pode ser configurado pelo agente via DC quando autorizado.
## 6. Filas, URLs e persistência

- Internamente o banco usa `rounds`; para o usuário o termo preferido é **Fila**.
- Cada Fila contém exatamente 10 posições sequenciais.
- Cada URL aceita deve ser do YouTube e é salva com autor, grupo e horário.
- Vídeo já utilizado em qualquer Fila anterior ou atual não pode ser salvo novamente.
- Cada URL salva consome 1 moeda.
- Ao completar 10 URLs, a Fila vira READY e uma nova Fila OPEN é criada automaticamente.
- Fechar/atualizar navegador nunca apaga usuários, filas, URLs, moedas, autoria, exportações ou progresso.
- Quem não participou de uma Fila encerrada vê normalmente a Fila OPEN atual.
- Quem participou de uma Fila READY permanece vinculado à tarefa daquela Fila até finalizá-la e não pode contribuir na Fila seguinte.

## 7. Playlist, acompanhamento e conclusão

- Participante da Fila pode criar playlist privada em sua própria conta via OAuth Google/YouTube explícito.
- Acompanhamento atual usa IFrame Player API: tempo natural, aba visível, grandes saltos ignorados e persistência por usuário/Fila.
- Cada marco consolidado de 10% concede 1 moeda interna, máximo de 10 por Fila; ledger `WATCH_PROGRESS` é idempotente.
- Fechar a janela de acompanhamento apenas pausa; o estado continua salvo.
- Botão `Concluir tarefa` exige confirmação amigável:
  - encerra a tarefa no percentual atual;
  - mantém somente recompensas já alcançadas;
  - não apaga progresso;
  - inicia cooldown persistente de 30 minutos.
- 100% finaliza automaticamente e também inicia cooldown.
- Cooldown é gravado no servidor e espelhado localmente; apagar storage/atualizar não deve burlá-lo.
- Durante cooldown, login responde `423 COOLDOWN_ACTIVE` e a UI exibe contagem regressiva até 00:00.
- Após o prazo, a conta volta ao fluxo normal e pode entrar na Fila OPEN atual.

## 8. Moedas

- Moeda é crédito interno do SOS YouTube; não é saque nem pagamento em dinheiro por visualização.
- Saldo possui origens distintas:
  - promocional/inicial;
  - comprado;
  - recompensa/bônus por tarefa.
- Dashboard Owner deve mostrar total e origem.
- Compra pode conceder passe extra conforme regra vigente; moedas promocionais/recompensas não geram passe.
- Débitos e créditos são persistidos em ledger e devem ser idempotentes.

## 9. UX Premium ASTRA

- Preservar navy/vermelho/creme, Manrope + DM Sans, cards arredondados, profundidade sutil e boa hierarquia.
- Premium = refinamento e consistência; não trocar identidade sem aprovação.
- Lockup `SOS YOUTUBER` horizontal.
- `Quero participar` e ação principal do login têm mesma altura e alinhamento no desktop.
- Segurança: escudo verde ilustrado centralizado verticalmente ao lado das três frases; apenas “Você mantém o controle.” em negrito.
- Uma CTA de participação; sem duplicação apelativa.
- “Voltar para tela de login” usa seta e linguagem neutra.
- Erros devem ser explicados em PT-BR; não exibir mensagens nativas em inglês.
- Estados de pendência, tarefa e cooldown devem parecer parte do design ASTRA, não telas técnicas.

## 10. Gate obrigatório

Antes de checkpoint:
```bash
git diff --check
npm test
npm run lint
npm run build
npm run test:e2e -w @conexao/client
```

Mudança visual deve regenerar/revisar evidências em `docs/evidencias/`.

## 11. Estado validado em 05/10/2026

- Owner alias preservado no JWT/dashboard.
- Cadastro pendente amigável e aprovação Owner → login direto.
- Botões Login/Owner alinhados por teste visual.
- Meta: adaptador existe; credenciais externas ainda precisam ser conectadas no ambiente real.
- Contato público usa Rafael como fallback quando `OWNER_WHATSAPP` não existe.
- Filas sequenciais preservadas.
- Duplicata global de vídeo bloqueada.
- Participante de Fila READY bloqueado de nova contribuição até finalizar.
- Conclusão manual e automática persistentes.
- Cooldown de 30 minutos aplicado no servidor.
- Saldo por origem exposto ao dashboard Owner.
- Teste de conclusão manual prova 37% → 3 moedas → cooldown 30 min → liberação após prazo.
- Gate mais recente antes desta âncora: 60/60 API, 6/6 cliente, lint/build verdes e E2E 1/1.

## 12. Pendências conscientes

- Implementar/polir seletor de provedor WhatsApp no dashboard e camada WPPConnect.
- Separar formalmente prova de presença/admin do grupo da aprovação Owner antes de ativar dupla checagem obrigatória.
- Conectar credenciais Meta reais e webhook HTTPS.
- Parear sessão WPPConnect somente após consentimento explícito no dashboard.
- Publicar backend/webapp em HTTPS; GitHub pode ser usado como repositório, mas GitHub Pages sozinho não hospeda a API Fastify/SQLite.
- Validar Google/YouTube e Mercado Pago reais antes de produção.
- Políticas de privacidade, termos, retenção/exclusão, backup/restore e observabilidade.

## Regra de atualização

Se uma decisão deste arquivo mudar, não apagar silenciosamente a regra anterior: atualizar a seção correspondente, registrar a nova decisão em `PROJECT_STATUS.md` e proteger a mudança com teste quando aplicável.
