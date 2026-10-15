# Arquitetura

Este documento descreve a estrutura do sistema em três níveis de detalhe —
contexto, containers e camadas internas — e mostra o caminho que uma
requisição percorre desde o clique da analista até a resposta, incluindo o caso
de conflito.

## 1. Visão de contexto (C4 nível 1)

```mermaid
flowchart LR
    Marina["Marina<br/>Analista da central<br/>(escaneia, não lê)"]
    Coord["Coordenador<br/>de operações"]
    Logos["<b>Logos</b><br/>Central de Resposta a Incidentes<br/>Prioriza, registra o ciclo de vida<br/>e impede sobrescrita silenciosa"]
    Radio["Rádio da frota<br/>e telefone<br/><i>origem do report</i>"]

    Marina -->|"consulta a fila,<br/>assume e encerra casos"| Logos
    Coord -->|"acompanha KPIs<br/>e SLA"| Logos
    Radio -.->|"a analista registra<br/>o que ouviu"| Marina
```

O Logos é um sistema único do ponto de vista de quem usa. Fora dele ficam o
rádio e o telefone (canal de entrada, humano) e, no roadmap, um provedor de
identidade (autoria real).

## 2. Visão de containers (C4 nível 2)

```mermaid
flowchart TB
    subgraph Cliente["Navegador da analista"]
        UI["SPA React 18 + TypeScript<br/>Vite"]
        RQ["TanStack Query<br/>cache, retry, mutação otimista"]
        ZU["Zustand<br/>tema, densidade, filtros efêmeros"]
        DS["Design System<br/>Tailwind + Radix"]
        UI --- RQ
        UI --- ZU
        UI --- DS
    end

    subgraph Servidor["API FastAPI (uvicorn)"]
        MW["Middlewares<br/>CORS, rate limit, request ID, log"]
        RT["Rotas /api/v1"]
        SV["Services<br/>regra de negócio e máquina de estados"]
        RP["Repositories<br/>SQL, CAS, paginação por cursor"]
        RS["Infra de resiliência<br/>retry, timeout, circuit breaker, cache"]
        MW --> RT --> SV --> RP
        SV --- RS
    end

    subgraph Dados["Persistência"]
        PG[("PostgreSQL (produção)<br/>SQLite (local)")]
        CA[("Cache TTL<br/>stale-while-revalidate")]
        ID[("idempotency_keys<br/>24h")]
    end

    RQ -->|"HTTP/JSON<br/>ETag, If-Match, Idempotency-Key"| MW
    RQ -.->|"SSE /incidents/stream"| MW
    RP --> PG
    RS --> CA
    RS --> ID
    RS -.->|"degradação: serve cache"| PG
```

| Container | Responsabilidade | Não faz |
| --- | --- | --- |
| SPA React | Apresentar a fila priorizada, coletar a decisão da analista, manter o estado de UI explícito | Não calcula prioridade, não decide transição de status |
| API FastAPI | Validar entrada, aplicar regra de negócio, persistir, garantir integridade | Não renderiza, não conhece o formato da tela |
| PostgreSQL / SQLite | Persistir e garantir o compare-and-swap atômico | Não contém regra de negócio (nenhuma *trigger* com lógica de domínio) |
| Cache TTL | Servir resposta utilizável durante degradação | Não é fonte de verdade |

**Por que o front não calcula o priority score:** dois analistas precisam ver
exatamente a mesma ordem, e a ordenação precisa ser auditável e testável. Ver
[ADR 0013](adr/0013-priority-score-no-servidor.md).

## 3. Camadas internas do backend

```mermaid
flowchart TB
    subgraph API["api/ — fronteira HTTP"]
        R1["routes v1/incidents.py"]
        R2["deps.py<br/>injeção de sessão e service"]
    end
    subgraph SVC["services/ — orquestração"]
        S1["IncidentService<br/>regra de negócio,<br/>máquina de estados,<br/>grava evento de auditoria"]
    end
    subgraph DOM["domain/ — regras puras"]
        D1["enums.py"]
        D2["rules.py<br/>assert_transition_allowed"]
        D3["priority.py<br/>cálculo do score"]
        D4["entities.py"]
    end
    subgraph REP["repositories/ — acesso a dados"]
        P1["IncidentRepository<br/>SQL, CAS, cursor, filtros"]
    end
    subgraph MDL["models/ — ORM"]
        M1["Incident, IncidentEvent<br/>SQLAlchemy 2.0"]
    end

    R1 --> R2 --> S1
    S1 --> D2
    S1 --> D3
    S1 --> P1
    P1 --> M1
    D2 -.-> D1
    D3 -.-> D1
```

### 3.1 A regra de dependência

```
api → services → { domain, repositories }
repositories → models
domain → (nada)
```

**O domínio não conhece HTTP nem ORM.** `app/domain/` contém apenas enums,
regras puras e funções de cálculo. Consequências práticas:

- `assert_transition_allowed(ABERTO, FECHADO)` é uma função pura: recebe dois
  enums, devolve nada ou levanta uma exceção de domínio. Não abre transação,
  não importa SQLAlchemy, não conhece `Request`.
- O cálculo do priority score é uma função determinística de quatro números.
  Isso o torna testável por faixa, sem banco, e explicável na interface.
- Trocar SQLite por PostgreSQL, ou FastAPI por outro framework, não exige
  alterar nenhuma linha em `domain/`.

### 3.2 Responsabilidade de cada camada

| Camada | Faz | Não faz |
| --- | --- | --- |
| `api/` | Deserializa, valida formato, chama o service, serializa a saída, mapeia exceção de domínio em *status code* | Não contém `if` de regra de negócio, não monta SQL |
| `services/` | Aplica a máquina de estados, recalcula o score, orquestra repositório, grava o evento de auditoria, decide o momento do `commit` | Não conhece `Request`, não monta query |
| `domain/` | Regras puras, enums, cálculo do score | Não conhece HTTP, ORM, sessão ou configuração |
| `repositories/` | Traduz operações de domínio em SQL, executa o CAS, monta cursor de paginação | Não decide se a transição é permitida |
| `models/` | Mapeamento objeto-relacional e índices | Não contém regra de negócio |

### 3.3 Módulos de infraestrutura

`app/infra/` reúne o que dá sustentação ao Pilar 2 e é ortogonal ao domínio:

| Módulo | Papel |
| --- | --- |
| `cache.py` | Cache TTL da listagem com *stale-while-revalidate*. |
| `retry.py` | Backoff exponencial com jitter, restrito a operações idempotentes e falhas de infraestrutura. |
| `circuit_breaker.py` | Abre após N falhas consecutivas e responde `503` com `Retry-After` em vez de enfileirar requisições condenadas. |
| `seed.py` | Gera os 120 incidentes realistas da demonstração. |

## 4. Modelo de dados

```mermaid
erDiagram
    INCIDENT ||--o{ INCIDENT_EVENT : "possui"
    INCIDENT {
        uuid id PK
        string code UK
        string title
        text description
        enum category
        enum criticality
        enum status
        float latitude
        float longitude
        string location_label
        string truck_plate
        string driver_name
        string reported_by
        string assigned_analyst
        text resolution_notes
        int priority_score
        datetime sla_due_at
        int version "lock otimista"
        datetime created_at
        datetime updated_at
        datetime closed_at
        datetime deleted_at
    }
    INCIDENT_EVENT {
        uuid id PK
        uuid incident_id FK
        string event_type
        string from_status
        string to_status
        string actor
        json payload
        datetime created_at
    }
```

Os índices do modelo e a razão de cada um:

| Índice | Consulta que atende |
| --- | --- |
| `UNIQUE (code)` | Busca pelo código falado no rádio (`INC-2026-000123`). |
| `(status, criticality, priority_score DESC)` | Consulta principal da tela de triagem: filtro combinado mais ordenação por prioridade. |
| `(category, created_at DESC)` | Filtro por categoria com ordenação temporal. |
| `(deleted_at)` | Toda query filtra `deleted_at IS NULL` por causa do soft delete. |
| `(sla_due_at)` | Alerta de SLA vencendo. |
| `(assigned_analyst)` | Visão "meus casos". |
| `GIN` em `title`/`description` (PostgreSQL) | Busca textual; no SQLite cai para `LIKE`. |

## 5. Fluxo de uma requisição ponta a ponta

```mermaid
sequenceDiagram
    participant U as Analista
    participant RQ as TanStack Query
    participant MW as Middlewares
    participant RT as Rota /api/v1
    participant SV as Service
    participant DM as Domain
    participant RP as Repository
    participant DB as PostgreSQL

    U->>RQ: clica em "Fechar caso"
    RQ->>RQ: onMutate: aplica na cache, guarda snapshot
    RQ->>MW: PATCH /incidents/{id}<br/>If-Match "3", Idempotency-Key
    MW->>MW: CORS, rate limit, request ID
    MW->>RT: requisição validada
    RT->>RT: Pydantic valida o corpo (422 se inválido)
    RT->>SV: change_status(id, FECHADO, expected=3)
    SV->>DM: assert_transition_allowed(ABERTO, FECHADO)
    DM-->>SV: permitido
    SV->>DM: exige resolution_notes (min 10) e recalcula score
    SV->>RP: update_status_cas(id, expected=3, ...)
    RP->>DB: UPDATE ... WHERE id AND version = 3 AND deleted_at IS NULL
    DB-->>RP: rowcount = 1
    RP-->>SV: incidente atualizado, version = 4
    SV->>RP: insere evento de auditoria
    SV->>DB: COMMIT
    SV-->>RT: representação atual
    RT-->>RQ: 200 OK + ETag "4"
    RQ-->>U: toast de sucesso, linha atualizada
```

Caminhos de exceção do mesmo fluxo:

| Ponto de falha | Resultado | O que a interface faz |
| --- | --- | --- |
| Payload inválido no formato | `422` | Destaca o campo e explica a regra. |
| Transição proibida pela máquina de estados | `422 INVALID_STATUS_TRANSITION` | Marca a ação como indisponível (defesa em profundidade: o front já desabilita). |
| `FECHADO` sem `resolution_notes` | `422 RESOLUTION_NOTES_REQUIRED` | Abre o campo de nota com foco e contador de caracteres. |
| `version` divergente | `409 VERSION_CONFLICT` | Rollback da UI otimista e modal de conflito com o diff. |
| `If-Match` mal formado ou inexistente no histórico | `412 PRECONDITION_FAILED` | Recarrega o recurso e pede nova confirmação. |
| Chave de idempotência reusada com corpo diferente | `409 IDEMPOTENCY_KEY_REUSED` | Toast de erro fatal com "copiar detalhes técnicos". |
| Banco indisponível ou circuit breaker aberto | `503` + `Retry-After` | Mantém o cache na tela, banner de instabilidade, retry com backoff. |

## 6. Sequência do conflito de status

```mermaid
sequenceDiagram
    autonumber
    participant A as Analista A
    participant B as Analista B
    participant API as API FastAPI
    participant DB as PostgreSQL

    A->>API: GET /incidents/123
    API-->>A: 200 · version = 3 · ETag "3"
    B->>API: GET /incidents/123
    API-->>B: 200 · version = 3 · ETag "3"

    A->>API: PATCH status=FECHADO · If-Match "3"
    API->>DB: UPDATE ... WHERE id = 123 AND version = 3
    DB-->>API: rowcount = 1
    API-->>A: 200 · version = 4 · ETag "4"
    Note over A: tela de A fecha o caso

    B->>API: PATCH status=EM_INVESTIGACAO · If-Match "3"
    API->>DB: UPDATE ... WHERE id = 123 AND version = 3
    DB-->>API: rowcount = 0 (ninguém foi sobrescrito)
    API->>DB: SELECT estado atual
    DB-->>API: version = 4, status = FECHADO
    API-->>B: 409 Conflict + representação atual
    Note over B: modal: "Marina acabou de fechar este caso"<br/>[Ver o que mudou] [Recarregar] [Fechar]
```

O detalhamento do mecanismo, o tratamento no frontend e a política de
idempotência estão em
[`04-concorrencia-e-resiliencia.md`](04-concorrencia-e-resiliencia.md).

## 7. Decisões de arquitetura

| ADR | Decisão | Alternativa descartada |
| --- | --- | --- |
| [0001](adr/0001-monorepo.md) | Monorepo `backend/` + `frontend/` | Dois repositórios |
| [0002](adr/0002-fastapi.md) | FastAPI sobre Python 3.12 | Flask, Django REST |
| [0003](adr/0003-postgres-e-sqlite.md) | SQLAlchemy 2.0 + Alembic; SQLite local e PostgreSQL em produção | JSON estruturado |
| [0004](adr/0004-react-vite.md) | React 18 + TypeScript + Vite | Next.js |
| [0005](adr/0005-tanstack-query.md) | TanStack Query para estado de servidor | Redux Toolkit, SWR |
| [0006](adr/0006-zustand.md) | Zustand para estado de UI | Context API puro |
| [0007](adr/0007-tailwind-shadcn.md) | Tailwind CSS + shadcn/ui (Radix) | MUI, Chakra |
| [0008](adr/0008-optimistic-locking.md) | Optimistic locking com `version` e `ETag` | Pessimistic lock (`SELECT FOR UPDATE`) |
| [0009](adr/0009-ruff-mypy.md) | Ruff + mypy no backend | flake8 + black + isort |
| [0010](adr/0010-cursor-pagination.md) | Paginação por cursor | Offset/limit |
| [0011](adr/0011-sse.md) | SSE para tempo real | WebSocket |
| [0012](adr/0012-render-vercel-neon.md) | Render + Vercel + Neon | Hugging Face Spaces, Replit |
| [0013](adr/0013-priority-score-no-servidor.md) | Priority score calculado no servidor | Ordenar no cliente |
| [0014](adr/0014-soft-delete.md) | Soft delete | Hard delete |

## 8. Decisões transversais

### 8.1 Defesa em profundidade

A validação acontece em três níveis independentes, e não em um só:

1. **Pydantic v2** valida formato e tipo na fronteira HTTP.
2. **Domain** valida semântica: transição permitida, nota obrigatória, faixa de coordenadas.
3. **Banco** garante integridade: `version` no `WHERE` do `UPDATE`, `UNIQUE` em `code`, `NOT NULL` onde couber.

Nenhum nível confia que o anterior já resolveu.

### 8.2 Contrato espelhado, não presumido

Os tipos do frontend (`features/incidents/types.ts`) espelham o contrato da API
e são validados em runtime com Zod. Uma resposta fora do contrato falha cedo,
na fronteira do cliente HTTP, em vez de virar erro obscuro no meio da
renderização.

### 8.3 Observabilidade como parte da arquitetura

Toda requisição recebe um `X-Request-Id` (aceito do cliente ou gerado no
servidor), presente no log estruturado e no envelope de erro. Isso permite
correlacionar o que a analista viu na tela com o que aconteceu no servidor —
sem isso, o tratamento de `409` e `503` fica impossível de depurar.
