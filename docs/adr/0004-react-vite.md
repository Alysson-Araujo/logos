# ADR 0004 — React 18 com TypeScript estrito e Vite

- **Status:** Aceito
- **Data:** 2026-02-11
- **Contexto relacionado:** E4 — Frontend: Fundação (issue #34, `feat/34-vite-react-ts`)

## Contexto

A interface precisa mostrar 100 ou mais incidentes priorizados em milissegundos, com filtros combináveis, atualização otimista com rollback, drawer, modal de conflito e estados de UI explícitos. O briefing descreve uma aplicação que consome API, não um site com conteúdo indexável. Como o frontend é o que o avaliador vê primeiro, o tempo de feedback do ambiente de desenvolvimento também é critério: ciclo lento reduz a quantidade de iteração possível dentro do prazo.

## Decisão

**React 18** com **TypeScript em modo `strict`** e **Vite**. A configuração de tipos não é negociável quanto a `strict: true`, `noUncheckedIndexedAccess: true` e `noUnusedLocals: true`. Os tipos do contrato vivem em `features/incidents/types.ts` e são espelhados por schemas **Zod** validados em tempo de execução. O roteamento é no cliente e o estado dos filtros é escrito na URL, para permitir link compartilhável.

## Alternativas consideradas

- **Next.js.** Descartado: renderização no servidor não traz benefício perceptível para uma aplicação interna usada na mesma aba durante todo o plantão, e traz custo concreto — acoplaria o deploy do front ao runtime Node e adicionaria um framework de roteamento para uma aplicação que tem essencialmente uma tela.
- **Svelte ou Vue.** Descartados por ecossistema, não por mérito: as três peças que sustentam os pilares no front — TanStack Query, TanStack Virtual e Radix — têm integração de primeira linha com React, e as alternativas seriam menos maduras justamente nas áreas avaliadas.
- **JavaScript com JSDoc.** Descartado: sem verificação de tipos, a remoção de um campo no contrato apareceria como `undefined` renderizado, e não como erro no `typecheck` da CI.
- **TypeScript sem `strict`.** Descartado: `any` implícito dissolve a garantia que motivou adotar TypeScript, e passa despercebido — o código compila e o erro aparece em produção.

## Consequências

### Positivas

- `tsc --noEmit` roda na CI: um campo removido do contrato quebra o build em vez de virar `undefined` silencioso.
- HMR praticamente instantâneo, o que permite iterar na hierarquia visual e nos estados com feedback imediato.
- Zod transforma "a API respondeu `200` com payload inesperado" em erro explícito, na fronteira do cliente HTTP.
- Build estático servido por CDN, sem runtime de servidor para o front.

### Negativas / trade-offs

- **Sem renderização no servidor**: a primeira carga depende do JavaScript e não há HTML para indexação, o que é irrelevante para uma ferramenta operacional interna.
- Mais anotações de tipo e atrito ocasional com bibliotecas de tipagem incompleta.
- A fonte de verdade fica em dois lugares — URL para o que é compartilhável (filtros, ordenação), store para o que é preferência local (tema, densidade) — e a fronteira precisa ser explícita para não haver duplicação.
