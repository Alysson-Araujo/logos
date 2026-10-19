# ADR 0018 — Cypress para os testes ponta a ponta

- **Status:** Aceito
- **Data:** 2026-10-19
- **Contexto relacionado:** [issue #149](https://github.com/Alysson-Araujo/logos/issues/149) — substitui a proposta de Playwright da [#59](https://github.com/Alysson-Araujo/logos/issues/59)

## Contexto

O projeto tem 234 testes de frontend em `jsdom` e uma suíte de integração e de
concorrência no backend que cobre o contrato da API. Nenhum dos dois percorre o
caminho que a analista percorre: abrir a tela, clicar na linha, mudar o status e
ver o que acontece quando **outra pessoa mudou o mesmo caso antes**.

O fluxo mais importante do case — dois analistas disputando o mesmo incidente —
está provado no servidor (`tests/concurrency`) e no componente
(`ConflictDialog.test.tsx`), mas não está provado no navegador, onde o `ETag`
viaja, o `409` volta e o diff aparece na tela. O `jsdom` também não mede layout:
o guia de boas-vindas, que recorta o véu em volta do alvo real, tem pouco do que
provar ali.

A decisão anterior (issue #59) previa Playwright. Este ADR registra a troca.

## Decisão

**Cypress**, com os specs em `frontend/cypress/e2e/` e a aplicação inteira subida
por `scripts/e2e.mjs` (SQLite descartável, alembic, seed, API, front compilado).

| Critério                        | Cypress                                                                                                      | Playwright                                                                |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------- |
| Depuração de quem avalia        | `cypress open` mostra o DOM de cada passo (_time travel_), útil para demonstrar o teste e não só o resultado | Trace viewer (`npx playwright show-trace`) — poderoso, mas menos imediato |
| Artefatos na falha              | Vídeo e print saem do runner sem configuração extra                                                          | Também suporta; exige configuração explícita                              |
| Preparar cenário pela API       | `cy.request` executa dentro da mesma cadeia, com `then` sobre a resposta                                     | `request.newContext()` é mais cerimônia                                   |
| Multi-aba / múltiplos contextos | Limitado — não é possível abrir uma segunda aba no mesmo teste                                               | Nativo (contexts independentes)                                           |
| Matriz de navegadores           | Um navegador por execução (Electron/Chrome/Firefox sob demanda)                                              | Chromium, Firefox e WebKit de fábrica                                     |
| Peso                            | Binário próprio (~300 MB no cache)                                                                           | Navegadores por versão, também pesados                                    |

O fator decisivo é a **depuração**: o valor do E2E aqui não é só barrar
regressão, é conseguir mostrar o fluxo acontecendo. Os cenários que exigiriam
multi-aba (dois analistas em telas simultâneas) são reproduzidos de forma mais
determinística com `cy.request` mudando a versão por fora — que é, inclusive,
mais próximo do que acontece entre duas máquinas diferentes.

## Alternativas consideradas

- **Playwright** (proposta original da #59). Descartada pelo critério acima. É a
  melhor escolha quando a matriz de navegadores ou multi-contexto importam; não é
  o caso de um produto interno com um navegador corporativo definido.
- **Nenhum E2E, só componente e integração.** Descartada: o `409` chegando na
  tela com o diff é a promessa central do case, e nenhum teste em `jsdom` prova
  o caminho completo.
- **E2E contra a aplicação publicada.** Descartada: os testes criam contas e
  incidentes; poluir a demonstração pública com dados de teste seria pior do que
  a conveniência de não subir serviços. A API publicada continua sem limite de
  requisições desligado, e a suíte faria dezenas de escritas por minuto.

## Consequências

### Positivas

- O fluxo do Pilar 1 passa a ser verificado no navegador, do clique ao `409`.
- O job `e2e` da CI publica vídeo e print da falha — uma falha intermitente deixa
  de ser um mistério e vira um vídeo.
- A suíte roda contra o **front compilado**, e não o servidor de
  desenvolvimento: o artefato testado é o que vai para o ar.
- `cy.session` reduz o custo do login a uma vez por execução.

### Negativas

- O job de CI fica alguns minutos mais lento e depende de bibliotecas gráficas do
  Electron no runner.
- Um navegador só: um bug específico de Firefox ou Safari não aparece aqui.
- A suíte escreve no banco (cria incidentes e contas). Isso exige banco
  descartável e é o motivo de nunca apontá-la para a API publicada.
- Aceitar E2E significa aceitar certa fragilidade: `retries: 1` no `runMode` é o
  reconhecimento explícito de que uma falha de rede não deve derrubar o job — e
  não uma licença para teste instável.
