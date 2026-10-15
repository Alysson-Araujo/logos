# ADR 0006 — Zustand para estado de UI

- **Status:** Aceito
- **Data:** 2026-02-11
- **Contexto relacionado:** E4 — Frontend: Fundação (issue #36) e E5 (issue #49)

## Contexto

Existe um conjunto de estado que não vem do servidor e precisa sobreviver à navegação: tema (claro/escuro/sistema) e densidade (confortável/compacto), ambos persistidos; e estado efêmero de interação — command palette aberta, linha em foco na navegação `j`/`k` e contador de novos incidentes do SSE. Dois desses valores são lidos por componentes distantes na árvore: o cabeçalho grava a densidade e cada linha da lista a lê.

## Decisão

**Zustand** para o estado de UI, em três stores pequenas e com responsabilidade única: `themeStore`, `uiStore` (densidade, linha em foco, contador de novos) e `commandPaletteStore`. As stores de preferência usam o *middleware* `persist` com chave própria em `localStorage`, e o tema inicial respeita `prefers-color-scheme` quando a preferência é "sistema".

## Alternativas consideradas

- **Context API puro.** Descartado pelo comportamento de propagação: o valor do contexto propaga para toda a subárvore, independentemente de quem lê. Alternar a densidade re-renderizaria a lista inteira — recebendo o benefício da virtualização e perdendo-o no re-render, que é exatamente o que a métrica de priorização avalia.
- **Redux.** Descartado: é a ferramenta correta para estado de aplicação grande, com fluxo complexo e depuração por *time travel*. Aqui são cinco campos, e a proporção entre configuração e valor entregue seria desfavorável.
- **Guardar tudo na URL.** Descartado parcialmente, e vale precisar a fronteira: o que é compartilhável vive na URL (criticidade, categoria, busca, ordenação, período); preferência pessoal de exibição não vai para a URL, porque um link enviado à colega não deve trocar o tema dela.
- **`useState` no topo e repasse por props.** Descartado: o cabeçalho está a vários níveis do item da lista, e o repasse criaria acoplamento entre componentes sem relação entre si.

## Consequências

### Positivas

- Alterar a densidade re-renderiza apenas quem assina aquele campo, via seletor; a lista virtualizada permanece estável.
- Sem *provider* envolvendo a aplicação: o componente de teste não precisa de nenhuma árvore de contexto.
- Escrita direta e tipada, sem *action creators* nem *reducers*.
- `persist` resolve tema e densidade com uma linha de configuração.

### Negativas / trade-offs

- **Estado fora da árvore do React**: as ferramentas de *debug* não o enxergam como enxergariam um `useState`. Para cinco campos, é aceitável.
- **Risco de o store virar depósito.** A fronteira adotada é explícita: estado de servidor no TanStack Query, estado de UI no Zustand, estado compartilhável na URL — o Zustand nunca guarda dado que vem da API.
- O contador de novos incidentes nasce de evento do servidor e mora no store. A justificativa é que ele não é dado do recurso, e sim indicador de interface que existe para não reordenar a lista sob o cursor da analista.
