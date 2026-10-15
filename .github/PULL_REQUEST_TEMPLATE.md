# Descricao

<!-- O QUE muda e, principalmente, POR QUE. O "como" esta no diff; o "por que" nao. -->

Closes #

## Tipo de mudanca

- [ ] `feat` — nova funcionalidade
- [ ] `fix` — correcao de defeito
- [ ] `refactor` — reestruturacao sem mudar comportamento
- [ ] `perf` — ganho de performance
- [ ] `test` — testes
- [ ] `docs` — documentacao
- [ ] `chore`/`build`/`ci` — configuracao e infraestrutura

## Como testei

<!-- Comandos executados e resultado observado. Nao escreva "testei localmente" e nada mais. -->

```bash

```

## Checklist

### Codigo
- [ ] `pnpm lint` sem avisos
- [ ] `pnpm typecheck` limpo, sem `any` novo
- [ ] `pnpm test` verde
- [ ] `pnpm build` conclui
- [ ] Sem `console.log`, `print()`, codigo comentado ou `TODO`

### Produto
- [ ] Estados de UI tratados: **loading**, **erro** e **vazio**
- [ ] Mutacao trata falha de rede e nao deixa a tela em estado ambiguo
- [ ] Acessivel por teclado e com foco visivel
- [ ] Funciona nos temas claro e escuro

### Processo
- [ ] Documentacao ou ADR atualizado, se a decisao mudou
- [ ] `.env.example` atualizado, se surgiu variavel nova
- [ ] Issue vinculada com `Closes #N`
- [ ] Print ou GIF anexado, se mudou interface

## Evidencia visual

<!-- Antes / depois, ou print da tela nova. Obrigatorio quando muda front-end. -->

## Notas para o revisor

<!-- Trade-offs conscientes, divida tecnica assumida, o que ficou fora deste PR e por que. -->
