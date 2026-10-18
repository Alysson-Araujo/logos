# Logos — Frontend (triagem de incidentes)

SPA em **React 18 + TypeScript `strict` + Vite** que implementa o _vertical slice_ da
Central de Resposta a Incidentes do case AutoU: lista virtualizada, priorização,
filtros na URL, ciclo de vida com **lock otimista** e **todos os estados de UI**
explícitos (seção 8.2 do plano mestre).

> O código (nomes de arquivos, tipos, variáveis) está em inglês; a interface, os
> comentários e a documentação estão em português — decisão D7 do plano.

---

## 1. Como rodar

Pré-requisitos: **Node.js ≥ 20** e **pnpm**. O comando roda dentro do workspace
`logos/` (o `pnpm-workspace.yaml` inclui `frontend`).

```bash
# na raiz do monorepo
pnpm install

# subir só o front
pnpm --filter web dev            # http://127.0.0.1:5173
# ou, dentro de frontend/
pnpm dev
```

Sem o backend no ar, defina `VITE_USE_MOCK=true` (ver `.env.example`) e a API é
simulada com **MSW** — a tela **nunca** fica em branco. Em modo de
desenvolvimento o mock é ligado automaticamente quando a variável não existe;
`VITE_USE_MOCK=false` força o uso da API real.

```bash
pnpm msw:init      # gera public/mockServiceWorker.js (só na primeira vez)
```

### Scripts

| Script                        | O que faz                                                                 |
| ----------------------------- | ------------------------------------------------------------------------- |
| `pnpm dev`                    | Servidor de desenvolvimento (Vite)                                        |
| `pnpm build`                  | Build de produção em `dist/`                                              |
| `pnpm preview`                | Serve o build local                                                       |
| `pnpm typecheck`              | `tsc --noEmit` (strict, `noUncheckedIndexedAccess`, `noUnusedLocals`)     |
| `pnpm lint` / `pnpm lint:fix` | ESLint 9 flat config (`strictTypeChecked` + react-hooks + jsx-a11y)       |
| `pnpm format`                 | Prettier (`semi`, `singleQuote`, `printWidth: 100`, `trailingComma: all`) |
| `pnpm test` / `pnpm test:run` | Vitest (+ Testing Library + MSW)                                          |

### Variáveis de ambiente

| Variável                  | Padrão                         | Uso                                      |
| ------------------------- | ------------------------------ | ---------------------------------------- |
| `VITE_API_BASE_URL`       | `http://localhost:8000/api/v1` | Base da API                              |
| `VITE_USE_MOCK`           | (ligado em `dev`)              | `true` liga a API simulada (MSW)         |
| `VITE_REQUEST_TIMEOUT_MS` | `10000`                        | Timeout das leituras (escritas usam 15s) |

---

## 2. Arquitetura de pastas

```
src/
├── main.tsx                    # bootstrap + decisão de usar o mock
├── app/                        # App, providers (Query/Tooltip/Toast), ErrorBoundary
├── components/
│   ├── ui/                     # Button, Card, Badge, Dialog, Drawer, Select, Input,
│   │                           # Tooltip, Skeleton, Toast (estilo shadcn/ui no repo)
│   ├── layout/                 # AppShell, Header, ThemeToggle
│   └── feedback/               # SkeletonList, EmptyState, ErrorState, OfflineBanner, RefetchBar
├── features/incidents/
│   ├── api/{client,endpoints}.ts   # cliente + funções tipadas do contrato
│   ├── hooks/                      # useIncidents, useIncidentMutations,
│   │                               # useIncidentFilters, useIncidentUiStore
│   ├── components/                 # IncidentList, IncidentRow, IncidentDrawer, FiltersBar,
│   │                               # ConflictDialog, StatusBadge, CriticalityBadge,
│   │                               # SlaTimer, PriorityPill, KpiCards
│   ├── schemas.ts                  # Zod espelhando o contrato (runtime)
│   ├── types.ts · labels.ts · statusMachine.ts · priority.ts
├── lib/                        # http, queryClient, formatters, utils
├── hooks/                      # useTheme, useDebounce, useOnlineStatus,
│                               # useKeyboardShortcuts, useToast, useUiStore
├── styles/{tokens.css,globals.css}
└── test/{setup.ts,factories.ts,msw/{handlers,browser}.ts}
```

---

## 3. Cliente HTTP (`src/lib/http.ts`)

Implementado à mão (sem axios) — é a peça central da avaliação de resiliência.

- **Timeout** com `AbortController`: **10s** em leitura, **15s** em escrita.
- **Retry** só em `GET`: 3 retries com backoff **1s → 2s → 4s** e jitter de **±30%**
  (`computeRetryDelayMs`); apenas em erro de rede, timeout ou **5xx**.
- **Mutações não têm retry automático** (1 tentativa) — segurança primeiro.
- **`Idempotency-Key`** gerada com `crypto.randomUUID()` e mantida **estável por
  tentativa do usuário** (o mapa vive no `useRef` do hook de mutação e só é liberado
  no `onSuccess`). Repetir o clique após falha de rede não duplica nada.
- **Parse do envelope de erro** em `ApiError` com `status`, `code`, `details`,
  `requestId`, `timestamp`, `retryAfterSeconds` e `kind`
  (`http | network | timeout | aborted | offline | contract`).
- **`navigator.onLine`**: offline, a requisição nem sai — o estado `offline` assume.

```ts
const error = await httpClient
  .get('/incidents', { query: { sort: 'priority_desc' } })
  .catch((cause: unknown) => cause);

if (isVersionConflict(error)) {
  const serverState = readConflictServerState(error); // error.details.current
}
```

## 4. TanStack Query (`src/lib/queryClient.ts`)

`staleTime: 30s` · `gcTime: 5min` · `refetchOnWindowFocus: false` ·
`networkMode: 'offlineFirst'` · `retry` com backoff + jitter (2 tentativas
adicionais na camada de cache, além das 3 de transporte do `HttpClient`) ·
`placeholderData: keepPreviousData` na troca de filtros (o cache antigo nunca
desaparece da tela).

Paginação infinita por **cursor** (`useInfiniteQuery`), com chave de cache estável
por combinação de filtros (`normalizeFilterKey`), então voltar a um filtro é
instantâneo.

As mutações seguem o ciclo completo:

| Fase        | O que acontece                                                                                                                  |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `onMutate`  | `cancelQueries` + snapshot das listas e do detalhe + patch otimista                                                             |
| `onError`   | rollback do snapshot; em `409 VERSION_CONFLICT` abre o `ConflictDialog`; nos demais casos, toast de erro (sem retry automático) |
| `onSuccess` | libera a `Idempotency-Key`, dispara o toast (2,5s) e faz a linha piscar                                                         |
| `onSettled` | invalida detalhe, listas e contadores                                                                                           |

## 5. Estados de UI (seção 8.2)

| Estado              | Onde vive                                                                                         |
| ------------------- | ------------------------------------------------------------------------------------------------- |
| `initialLoading`    | `SkeletonList` com a forma exata da linha                                                         |
| `refetching`        | `RefetchBar` (barra fina no topo) + `aria-live` discreto                                          |
| `loadingMore`       | `SkeletonList rows={3}` + botão "Carregar mais" (acessível por teclado)                           |
| `emptyInitial`      | `EmptyState variant="initial"` + CTA de criar                                                     |
| `emptyFiltered`     | `EmptyState variant="filtered"` com os filtros descritos + "Limpar filtros"                       |
| `errorRecoverable`  | `ErrorState` com "Tentar novamente" e contagem de tentativas; **o cache antigo continua na tela** |
| `errorFatal`        | `ErrorState variant="fatal"` (erro de contrato/Zod) + "Copiar detalhes técnicos"                  |
| `offline`           | `OfflineBanner` fixo quando `navigator.onLine === false`                                          |
| `pendingMutation`   | botão desabilitado + "enviando…" + barra na linha                                                 |
| `optimisticApplied` | lista e drawer mudam antes do `200`, com opacidade 70% e ícone de relógio                         |
| `conflict`          | `ConflictDialog` com diff campo a campo e `aria-live="assertive"`                                 |
| `success`           | toast verde (2,5s) + linha piscando por ~1,4s                                                     |

## 6. Filtros na URL

`useIncidentFilters` serializa o estado em query string (`?status=ABERTO,EM_INVESTIGACAO
&criticality=ALTA&category=BLOQUEIO_DE_PISTA&search=BR-116&sort=created_desc`),
usa `history.pushState`/`replaceState`, reage a `popstate` (botão voltar) e ignora
valores fora do contrato. A busca textual tem **debounce de 300ms** e usa
`replaceState` para não poluir o histórico.

## 7. Atalhos de teclado

`j` próximo · `k` anterior · `Enter` abre o drawer · `/` foca a busca ·
`t` alterna o tema · `Esc` fecha o drawer. Atalhos de letra são ignorados enquanto
o foco está em campos de texto.

## 8. Design system (seção 9.3)

Tokens em `src/styles/tokens.css`, expostos ao Tailwind como classes semânticas —
**nenhum componente usa cor literal**.

| Criticidade | Cor (claro/escuro)    | Ícone | Borda esquerda |
| ----------- | --------------------- | ----- | -------------- |
| ALTA        | `#DC2626` / `#F87171` | ▲     | 4px            |
| MÉDIA       | `#D97706` / `#FBBF24` | ◆     | 3px            |
| BAIXA       | `#2563EB` / `#60A5FA` | ●     | 2px            |

- Tipografia `Inter` (UI) + `JetBrains Mono` (códigos/IDs), escala 12/13/14/16/20/24/32.
- `tabular-nums` em timers, contadores e códigos (classe utilitária `nums`).
- Espaçamento em base 4px, raios 6/10/999px, sombras em 3 níveis.
- Movimento 150ms (hover) e 200ms (painéis) com `cubic-bezier(.2,.8,.2,1)`,
  respeitando `prefers-reduced-motion`.
- **Contraste WCAG AA**: o texto dos badges usa um tom derivado mais escuro/claro
  (`--color-crit-*-text`) para garantir ≥ 4.5:1 sobre o fundo suave, mantendo o
  valor exato do plano na borda/ícone.
- Foco visível de 2px em todo interativo, `aria-label` nos botões de ícone,
  `aria-live="polite"` em toasts/contadores e `assertive` no conflito.

## 9. Testes

```bash
pnpm test:run
```

- `CriticalityBadge` — garante os **três canais** (cor + ícone + rótulo), nunca só cor.
- `IncidentRow` — código, categoria, status, SLA, borda por criticidade e estado otimista.
- `useIncidentFilters` — serialização/desserialização da URL, filtros inválidos e limpeza.
- `http.ts` — retry em 5xx no GET, **nenhum retry em mutação**, timeout, offline,
  `If-Match`/`Idempotency-Key` e parse de `VERSION_CONFLICT`.
- `EmptyState` — vazio inicial (com CTA) versus vazio filtrado (com "Limpar filtros").
- `endpoints` — cobre a API simulada (MSW): paginação por cursor, ordenação,
  `ETag`, `409` com a representação atual, `422` de validação e de transição proibida.
- `ConflictDialog` — diff campo a campo ("você tentou X · no servidor está Y").

## 10. Mock (MSW)

Se o backend estiver fora do ar, o login simulado aceita as **mesmas contas de
demonstração do seed** — `ana@autou.com.br` e as quatro variadas —, com o papel de
cada uma, além da conta de convite pendente (que entra pela senha temporária e
exige a troca). A tabela completa está no README da raiz.

`src/test/factories.ts` gera **120 incidentes realistas em pt-BR** (BR-116, BR-101,
SP-330, BR-376, placas Mercosul, nomes brasileiros, SLA coerente com a criticidade)
com semente determinística. `src/test/msw/handlers.ts` implementa o contrato
inteiro — inclusive o `409` — e persiste o "banco" no `localStorage`: assim **duas
abas compartilham o mesmo estado** e o conflito de versão pode ser demonstrado
sem backend.

## 11. Fora de escopo (issues futuras)

Command palette (`Ctrl+K`), fila offline persistida em `localStorage`, exportação
CSV, E2E com Playwright, timeline de auditoria e formulário de criação de incidente
(hoje o CTA de `emptyInitial` avisa que a entrega está na issue #55).
