# ADR 0007 — Tailwind CSS com shadcn/ui sobre Radix

- **Status:** Aceito
- **Data:** 2026-02-11
- **Contexto relacionado:** E4 — Frontend: Fundação (issues #35 e #38)

## Contexto

A interface tem exigências visuais que não são genéricas: três canais redundantes por criticidade (cor, ícone, forma de borda) mais rótulo textual; dois temas com contraste WCAG AA alternáveis sem recarregar a página; densidade variável sobre uma lista virtualizada que precisa rolar a 60fps; e acessibilidade real em diálogo e drawer, com foco preso, `Esc` para fechar e foco devolvido ao gatilho.

## Decisão

**Tailwind CSS** para estilo, com os tokens expostos como variáveis CSS em `styles/tokens.css` e consumidos pela configuração do Tailwind. O tema escuro é aplicado por classe na raiz (`darkMode: 'class'`), e não por consulta de mídia, porque a analista precisa poder sobrepor a preferência do sistema. **shadcn/ui** serve de base para os componentes — na prática, componentes escritos no repositório sobre os primitivos do **Radix UI**: `Dialog`, `DropdownMenu`, `Select`, `Popover`, `Tooltip` e `Toast`.

## Alternativas consideradas

- **MUI.** Descartado: traz linguagem visual própria e opinativa. Chegar à hierarquia de severidade deste produto exigiria sobrescrever tema, tipografia e componentes — mais trabalho que construir sobre primitivos acessíveis, com traços do Material remanescentes.
- **Chakra UI.** Descartado pela mesma razão, com o agravante do CSS-in-JS: gerar estilo em JavaScript durante a rolagem gasta orçamento de _frame_ no lugar errado em uma lista virtualizada.
- **Ant Design.** Descartado: é um _design system_ administrativo completo, com tabela e formulário próprios. O produto precisa de uma lista densa e um drawer, não de um framework visual corporativo.
- **CSS Modules ou CSS puro com variáveis.** Viável e mais leve, mas dispersa a decisão visual por muitos arquivos sem ponto único de tokens — que é justamente o que permite verificar em CSS a tabela de criticidade de `docs/05-design-system.md`.
- **Componentes próprios do zero.** Descartado: significaria implementar foco preso, navegação por seta, fechamento por `Esc` e semântica ARIA — exatamente onde os defeitos de acessibilidade se concentram.

## Consequências

### Positivas

- Um único arquivo de tokens governa os dois temas: trocar uma cor de criticidade é alterar uma variável.
- O `Dialog` de conflito já vem com foco preso e `Esc`, restando configurar `aria-live="assertive"`.
- Zero CSS morto no bundle e nenhum custo de runtime de estilo, preservando o orçamento de _frame_ da lista.

### Negativas / trade-offs

- **`className` longos no JSX.** Mitigado por componentes que encapsulam variações (`CriticalityBadge`, `StatusBadge`, `PriorityPill`) em vez de repetir composição de classes.
- **O código dos componentes de UI passa a ser responsabilidade do projeto**, incluindo acompanhar atualizações do Radix. Em troca, não há caixa preta no comportamento de foco e teclado que precisa ser justificado no vídeo.
- `darkMode: 'class'` exige um _script_ de inicialização que aplica a classe antes da primeira pintura, para evitar o _flash_ de tema claro.
