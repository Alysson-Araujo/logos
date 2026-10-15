# Logos — Backend (Central de Resposta a Incidentes)

API em **Python 3.12 + FastAPI + SQLAlchemy 2.0** para a Central de Resposta a Incidentes do
case fullstack AutoU. Este documento cobre setup, contrato, decisões e escopo declarado.

O que este backend entrega de essencial:

- **Máquina de estados explícita** (`ABERTO`, `EM_INVESTIGACAO`, `FECHADO`, `INCONCLUSIVO`) com
  `FECHADO` terminal e transições proibidas recusadas com `422`.
- **Lock otimista com compare-and-swap atômico** na transição de status — a validação da versão
  esperada e a escrita são **uma única instrução SQL**.
- **Priority score determinístico** calculado e persistido no servidor (todos os analistas veem a
  mesma ordem).
- **Paginação por cursor (keyset)** base64url, sem `OFFSET`.
- **Envelope de erro único** em camelCase para toda a API, com `requestId` correlacionável nos logs.

---

## 1. Setup local (3 comandos)

```powershell
cd logos/backend
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -e ".[dev]"
.\.venv\Scripts\python.exe -m uvicorn app.main:app --reload --port 8000
```

`PostgreSQL` em container é o padrão: suba com `pnpm db:up` na raiz do projeto.
Sem Podman, use `DATABASE_URL=sqlite:///./logos.db` — nenhum banco precisa ser
instalado. Com `SEED_ON_STARTUP=true` (padrão) a API cria os 120 incidentes de
demonstração na primeira subida, de forma idempotente.

- Swagger: <http://127.0.0.1:8000/docs>
- ReDoc: <http://127.0.0.1:8000/redoc>
- Health: <http://127.0.0.1:8000/api/v1/health/live>

Variáveis de ambiente: copie `.env.example` para `.env`.

| Variável          | Padrão                                                  | Uso                                                      |
| ----------------- | ------------------------------------------------------- | -------------------------------------------------------- |
| `DATABASE_URL`    | `postgresql+psycopg://logos:logos@localhost:5433/logos` | Container do `pnpm db:up`. Aceita `sqlite:///./logos.db` |
| `ENVIRONMENT`     | `local`                                                 | `local`, `staging`, `production`                         |
| `LOG_LEVEL`       | `INFO`                                                  | Logs JSON em stdout                                      |
| `CORS_ORIGINS`    | `http://localhost:5173,...`                             | Lista separada por vírgula                               |
| `SEED_ON_STARTUP` | `true`                                                  | Cria 120 incidentes se a base estiver vazia              |
| `SQL_ECHO`        | `false`                                                 | Eco das queries do SQLAlchemy                            |
| `DOCS_ENABLED`    | `true`                                                  | Habilita `/docs` e `/redoc`                              |

Seed manual (útil quando `SEED_ON_STARTUP=false`):

```powershell
.\.venv\Scripts\python.exe -m app.infra.seed
```

### PostgreSQL / containers

O `compose.yaml` fica na **raiz do projeto**, não nesta pasta, e sobe o
PostgreSQL 16 como container `logos-db`:

```powershell
pnpm db:up        # sobe o banco, exposto no host na porta 5433
pnpm seed         # cria as tabelas e popula os dados de demonstração
```

A porta do host é a **5433** porque a 5432 costuma estar ocupada por um
PostgreSQL nativo. O serviço `api` do mesmo compose constrói esta pasta e
conecta em `postgresql+psycopg://logos:logos@db:5432/logos` — 5432 porque ali
os dois estão na mesma rede.

No Postgres o engine usa `pool_pre_ping=True`, `pool_size=5`,
`max_overflow=10`, `pool_recycle=1800`.

Para subir banco e API juntos em container: `pnpm stack:up`.

---

## 2. Arquitetura em camadas

```
HTTP  →  api/v1/*        rotas, parsing de query/headers, ETag
         api/deps.py     injeção de dependência (sessão, repositório, serviço)
              ↓
         services/       regra de aplicação e orquestração do ciclo de vida
              ↓
         domain/         enums, máquina de estados e priority score (funções puras)
              ↓
         repositories/   SQL, keyset pagination e o CAS do lock otimista
              ↓
         models/         ORM SQLAlchemy 2.0
```

`schemas/` é o contrato Pydantic (camelCase para fora, snake_case para dentro) e `core/` concentra
configuração, engine, logging e os handlers globais de erro.

---

## 3. Contrato da API (`/api/v1`)

| Método   | Rota                     | Descrição                                                   | Códigos                                  |
| -------- | ------------------------ | ----------------------------------------------------------- | ---------------------------------------- |
| `GET`    | `/health/live`           | Processo vivo                                               | `200`                                    |
| `GET`    | `/health/ready`          | Valida o banco                                              | `200`, `503`                             |
| `GET`    | `/meta/enums`            | 5 categorias, 3 criticidades, 4 status com rótulo/cor/ícone | `200`                                    |
| `GET`    | `/incidents`             | Lista com filtros, ordenação e cursor                       | `200`, `400`, `422`                      |
| `POST`   | `/incidents`             | Cria incidente                                              | `201`, `422`                             |
| `GET`    | `/incidents/{id}`        | Detalhe + header `ETag: "N"`                                | `200`, `404`, `422`                      |
| `POST`   | `/incidents/{id}/status` | Transição com lock otimista                                 | `200`, `404`, `409`, `412`, `422`, `428` |
| `DELETE` | `/incidents/{id}`        | Soft delete                                                 | `204`, `404`, `409`, `412`               |

### 3.1 Envelope de erro único

Nenhuma resposta de erro usa o `{"detail": ...}` padrão do FastAPI.

```json
{
  "error": {
    "code": "INVALID_STATUS_TRANSITION",
    "message": "Não é possível ir de FECHADO para EM_INVESTIGACAO.",
    "details": { "from": "FECHADO", "to": "EM_INVESTIGACAO", "allowed": [] },
    "requestId": "9f1c2f0b6a7d4e5f8a9b0c1d2e3f4051",
    "timestamp": "2026-02-11T12:31:12Z"
  }
}
```

| `error.code`                | HTTP | Quando                                                          |
| --------------------------- | ---- | --------------------------------------------------------------- |
| `VALIDATION_ERROR`          | 422  | Payload/query inválidos (Pydantic)                              |
| `INVALID_FILTER`            | 422  | Valor desconhecido em `status`/`criticality`/`category`         |
| `INVALID_CURSOR`            | 400  | Cursor ilegível                                                 |
| `INVALID_STATUS_TRANSITION` | 422  | Transição proibida pela máquina de estados                      |
| `RESOLUTION_NOTES_REQUIRED` | 422  | `FECHADO`/`INCONCLUSIVO` sem justificativa                      |
| `VERSION_CONFLICT`          | 409  | Lock otimista falhou (traz o estado atual em `details.current`) |
| `PRECONDITION_REQUIRED`     | 428  | Sem `If-Match` e sem `expectedVersion`                          |
| `PRECONDITION_FAILED`       | 412  | `If-Match` malformado                                           |
| `INCIDENT_NOT_FOUND`        | 404  | Id inexistente ou removido                                      |
| `DATABASE_UNAVAILABLE`      | 503  | Readiness falhou                                                |
| `INTERNAL_ERROR`            | 500  | Exceção não tratada (ainda no envelope)                         |

### 3.2 Parâmetros de `GET /incidents`

```
?status=ABERTO,EM_INVESTIGACAO      # vírgula ou parâmetro repetido
&criticality=ALTA
&category=ACIDENTE_COM_VITIMAS,BLOQUEIO_DE_PISTA
&search=BR-116                      # título, descrição, código, placa, local
&sort=priority_desc|created_desc|created_asc|criticality_desc
&limit=50                           # 1..100
&cursor=eyJwIjo1MDAsImlkIjoiLi4uIn0
```

Resposta:

```json
{
  "items": [{ "id": "...", "code": "INC-2026-000123", "priorityScore": 800, "...": "..." }],
  "pageInfo": { "nextCursor": "eyJwIjo1MDAsImlkIjoiLi4uIn0", "hasNextPage": true, "limit": 2 },
  "meta": {
    "total": 42,
    "appliedFilters": {
      "status": [],
      "criticality": ["ALTA"],
      "category": [],
      "search": null,
      "sort": "priority_desc"
    }
  }
}
```

### 3.3 Cursor (keyset pagination)

Base64url de `{"p": <chave de ordenação>, "id": "<uuid>"}`. A consulta usa
`(chave, id) > cursor` / `< cursor` conforme a ordenação — **nunca `OFFSET`**, então a paginação
não pula nem repete registros quando a lista muda entre as páginas.

`p` é a chave de ordenação vigente:

| `sort`                         | `p`                                                                                |
| ------------------------------ | ---------------------------------------------------------------------------------- |
| `priority_desc`                | `priority_score`                                                                   |
| `created_desc` / `created_asc` | microssegundos desde a epoch (comparação exata, sem float)                         |
| `criticality_desc`             | `rank(criticidade) * 100000 + priority_score`, com rank `ALTA=3, MEDIA=2, BAIXA=1` |

O `id` é sempre o desempate, o que torna a ordenação total e estável.

### 3.4 Lock otimista (o núcleo)

O cliente obtém a versão no `ETag` do `GET` e a devolve na mutação:

```powershell
$incident = Invoke-RestMethod http://127.0.0.1:8000/api/v1/incidents/<id>
$etag = '"1"'
Invoke-RestMethod -Method Post `
  -Uri http://127.0.0.1:8000/api/v1/incidents/<id>/status `
  -Headers @{ "If-Match" = $etag } `
  -ContentType "application/json" `
  -Body '{"status":"EM_INVESTIGACAO","assignedAnalyst":"Ana Paula Ribeiro"}'
```

O repositório executa **uma única instrução**:

```sql
UPDATE incidents
   SET status = :new_status, version = version + 1, updated_at = :now
 WHERE id = :id
   AND version = :expected_version
   AND deleted_at IS NULL
   AND status IN (:status_de_origem_permitidos);
```

- `rowcount = 1` → `200` + `ETag: "N+1"`.
- `rowcount = 0` → leitura do estado atual e classificação da falha:
  - não existe/removido → `404`;
  - `version` diferente → **`409 VERSION_CONFLICT`** com `details.current` (representação completa);
  - mesma `version` e transição inválida → `422 INVALID_STATUS_TRANSITION`.

Não existe `SELECT` → comparação em Python → `UPDATE`: a comparação e a escrita são a mesma
instrução, então **não há janela de corrida (TOCTOU)** nem com múltiplas réplicas da API. As origens
permitidas vêm de `domain/rules.py` (`predecessors_of`), derivadas do mesmo grafo que a máquina de
estados usa — a transição também é validada no banco.

`If-Match: "3"` tem precedência; o corpo `{"expectedVersion": 3}` é o fallback para testes manuais.
Sem nenhum dos dois a resposta é `428 Precondition Required` — aceitar mutações sem versão
anularia o lock.

---

## 4. Regras de domínio

### 4.1 Máquina de estados (`app/domain/rules.py`)

```
ABERTO          → EM_INVESTIGACAO | INCONCLUSIVO | FECHADO
EM_INVESTIGACAO → FECHADO | INCONCLUSIVO | ABERTO
INCONCLUSIVO    → EM_INVESTIGACAO | FECHADO
FECHADO         → (terminal)
```

`FECHADO` é terminal de propósito: reabrir reescreveria o histórico e sujaria a auditoria. Um caso
reaberto é um **novo incidente vinculado** (evolução mapeada no backlog).

`FECHADO` e `INCONCLUSIVO` exigem `resolutionNotes` com no mínimo 10 caracteres — a justificativa
fica registrada junto do caso.

### 4.2 Priority score (`app/domain/priority.py`)

```
score = impacto(categoria) + urgência(criticidade) + min(horas_em_aberto * 12, 400) + pressão_de_sla

impacto:     ACIDENTE_COM_VITIMAS 300 · BLOQUEIO_DE_PISTA 180 · ACIDENTE_COM_VEICULO 150
             CONDICAO_CLIMATICA_ATIPICA 100 · PROBLEMA_MECANICO 60
urgência:    ALTA 500 · MEDIA 250 · BAIXA 80
pressão:     200 quando faltam menos de 60 min para o SLA (ou já venceu)
SLA:         ALTA +2h · MEDIA +8h · BAIXA +24h
```

O score é **persistido**. O aging depende do relógio, então a listagem recalcula os scores vivos
antes de montar a página (um único `UPDATE` em lote, sem tocar em `version` nem em `updated_at`),
garantindo que a ordem vista no cursor seja a ordem real e estável.
Escala maior: trocar por _job_ periódico ou coluna gerada — anotado como evolução.

### 4.3 Enums e categorias

5 categorias, 3 criticidades e 4 status, todos expostos em `/meta/enums` com `value`, `label`
(PT-BR), `color`, `colorDark`, `icon` e metadados derivados das fontes do domínio
(`impact`, `urgency`, `slaHours`, `shape`, `terminal`, `allowedTransitions`). O front nunca
duplica esses rótulos.

---

## 5. Banco de dados

- **PostgreSQL** (padrão, em container): `psycopg 3` (`postgresql://` é reescrito para
  `postgresql+psycopg://`), com `pool_pre_ping`, `pool_size`, `max_overflow` e `pool_recycle`.
- **SQLite** (alternativa sem container): `PRAGMA journal_mode=WAL`, `PRAGMA busy_timeout=5000`,
  `PRAGMA foreign_keys=ON` aplicados por _event listener_ na conexão.
- Schema versionado pelo **Alembic** (`alembic/versions/`). A aplicação **não** cria tabelas: se o
  banco estiver vazio, `ensure_schema_is_migrated()` para a subida com a instrução do comando que
  falta. `alembic check` na CI acusa divergência entre os modelos e as migrações.
- Índices: `UNIQUE(code)`, `(status, criticality, priority_score)`, `(category, created_at)`,
  `(deleted_at)`, `(sla_due_at)`, `(assigned_analyst)`.
- Soft delete: toda leitura filtra `deleted_at IS NULL`; o `DELETE` incrementa `version`.

### Seed

120 incidentes em pt-BR, determinísticos (`random.Random(20260211)`), distribuídos em
~15% `ALTA`, ~35% `MEDIA`, ~50% `BAIXA`, com placas Mercosul, rodovias reais (BR-116, BR-101,
SP-330, BR-376, BR-040, BR-153), nomes brasileiros e `created_at` espalhado nas últimas 72h.
Idempotente: base não vazia → não cria nada.

---

## 6. Observabilidade

- Logging **JSON** em stdout com `timestamp`, `level`, `logger`, `message`, `requestId`, `method`,
  `path`, `status_code` e `duration_ms`.
- Middleware gera/propaga `X-Request-Id` (aceita o header do cliente) e devolve o mesmo valor na
  resposta; o erro carrega o mesmo `requestId`.
- CORS lido de `CORS_ORIGINS`, com `ETag`, `Location` e `X-Request-Id` expostos.

---

## 7. Testes

```powershell
.\.venv\Scripts\python.exe -m pytest -q            # suíte completa + cobertura (mín. 80%)
.\.venv\Scripts\python.exe -m ruff check .
.\.venv\Scripts\python.exe -m ruff format --check .
.\.venv\Scripts\python.exe -m mypy app
```

| Arquivo                                     | Cobertura                                                                             |
| ------------------------------------------- | ------------------------------------------------------------------------------------- |
| `tests/unit/test_rules.py`                  | Todas as transições válidas e inválidas, terminalidade, justificativa obrigatória     |
| `tests/unit/test_priority.py`               | Pesos, aging com teto, pressão de SLA, ordenação vítimas+ALTA antes de mecânico+BAIXA |
| `tests/unit/test_schemas.py`                | HTML no título, tamanhos, placa, coordenadas, tipos inesperados                       |
| `tests/integration/test_incidents_api.py`   | Health, meta, CRUD, ETag, transições, soft delete, seed                               |
| `tests/integration/test_filters.py`         | Filtros combinados, busca, ordenações, cursor, erros de query                         |
| `tests/integration/test_errors.py`          | Envelope de erro, 404/405/412/428/409/422, requestId                                  |
| `tests/concurrency/test_status_conflict.py` | **10 threads com a mesma `expected_version` → 1×`200` e 9×`409`**                     |

O teste de concorrência usa `ThreadPoolExecutor` + `TestClient` e roda contra **SQLite em
arquivo** por padrão (`:memory:` não compartilha conexão entre threads) ou contra
**PostgreSQL** quando `TEST_DATABASE_URL` está definida — é o que o job
`backend-postgres` da CI faz. Ele prova, na prática, que o CAS no banco impede
sobrescrita silenciosa.

---

## 8. Escopo declarado

Implementado: health, meta/enums, criação, listagem com filtros e cursor, detalhe com ETag,
transição de status com lock otimista, **idempotência das mutações**, soft delete, **schema
versionado por migrações**, seed, logging JSON e suíte de testes.

**Fora deste vertical slice** (issues futuras, já mapeadas no plano):

- SSE `/incidents/stream`;
- circuit breaker, cache TTL e rate limit;
- timeline de auditoria (`incident_events` já existe no schema; endpoints são issue futura);
- autenticação real (por ora o ator é simulado por `assignedAnalyst` e headers de infraestrutura).

Escolhas registradas: `409` para conflito de versão (comunica "alguém mexeu antes" e é tratável
pelo cliente), `412` apenas para `If-Match` malformado, `422` para payload válido em formato e
inválido em regra, e `428` quando a mutação chega sem precondição.
