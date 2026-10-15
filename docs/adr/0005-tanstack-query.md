# ADR 0005 — TanStack Query para estado de servidor

- **Status:** Aceito
- **Data:** 2026-02-11
- **Contexto relacionado:** E4 — Frontend: Fundação (issue #40) e E6 (issues #51 e #52)

## Contexto

Os critérios de resiliência caem, no frontend, em cinco comportamentos concretos: atualização otimista com rollback; tratamento específico do `409` usando o estado atual que vem no corpo do erro; retry com backoff apenas em leituras; cache que mantém a lista visível durante instabilidade; e deduplicação e cancelamento de requisições obsoletas ao trocar de filtro. A lista ainda precisa de `keepPreviousData`, para que trocar um filtro não faça a tela piscar a cada tecla.

## Decisão

**TanStack Query v5** como camada de estado de servidor, com a política global em `lib/queryClient.ts`: `staleTime` de 30 s, retry de 3 tentativas com backoff e jitter em `GET`, **zero retry em mutações**, `refetchOnWindowFocus` desligado e `keepPreviousData` na listagem. A mutação de status implementa o ciclo completo — `onMutate` cancela queries em voo, guarda o snapshot e aplica a mudança na cache; `onError` faz rollback e, em `409`, abre o `ConflictDialog`; `onSettled` invalida a query para reconciliar com o servidor.

## Alternativas consideradas

- **Redux Toolkit (com RTK Query).** Descartado: exigiria `slices`, `thunks` e `reducers` para chegar aos mesmos comportamentos que o TanStack Query entrega por configuração. Redux trata tudo como estado global, o que leva a cache manual e invalidação escrita à mão.
- **SWR.** É o concorrente mais próximo e a decisão tem nuance: SWR é excelente em leitura, leve e simples, e é menos completo exatamente onde este projeto tem o caso mais difícil — mutação otimista com rollback e tratamento por código de erro, encadeando lista e detalhe. Reimplementar isso seria escrever o que o TanStack Query já oferece.
- **`fetch` em `useEffect` com estado local.** Descartado: reintroduz manualmente estado de carregamento, cancelamento, corrida entre requisições e política de retry — origem clássica do "cliquei e não sei se salvou" descrito na persona.
- **Zustand para estado de servidor.** Descartado: store não invalida, não deduplica e não versiona cache; usá-lo para isso seria construir uma biblioteca de _data fetching_ pior dentro do projeto.

## Consequências

### Positivas

- O tratamento do `409` cai em cerca de dez linhas: rollback no `onError` e abertura do diálogo com `error.details.serverState`.
- Retry, timeout e cache deixam de ser código de aplicação e passam a ser política declarada em um único arquivo.
- `cancelQueries` no `onMutate` elimina o defeito clássico de a atualização otimista ser sobrescrita por um `refetch` que já estava em voo.
- Invalidação por chave mantém lista e detalhe coerentes sem sincronização manual.

### Negativas / trade-offs

- **Dependência grande e com modelo mental próprio**: o estado vive em cache chaveada, não em `useState`, e quem lê precisa entender isso.
- A política de retry é assimétrica por decisão — zero retry em mutação reduz a taxa de sucesso percebida em rede instável. O trade-off é correto para o domínio (disponibilidade é negociável, integridade não), e a mitigação é a `Idempotency-Key` do `onMutate`, que torna o retry manual seguro.
- `keepPreviousData` e `staleTime` podem exibir dado levemente defasado; na triagem isso é preferível a uma tela em branco, e o `X-Cache-Status` do backend torna a defasagem observável.
