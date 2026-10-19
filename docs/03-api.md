# Contrato da API

Referência completa dos endpoints, parâmetros, exemplos de payload, envelope de
erro e cabeçalhos HTTP da API v1 do Logos.

## 1. Convenções gerais

| Item                  | Definição                                                                                                                    |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Base URL              | `/api/v1` — ex.: `http://localhost:8000/api/v1`                                                                              |
| Content-Type          | `application/json; charset=utf-8`                                                                                            |
| Identificador público | `id` em UUID v4; `code` legível no formato `INC-AAAA-NNNNNN`                                                                 |
| Datas                 | ISO-8601 em UTC, com sufixo `Z` (`2026-02-11T12:31:12Z`)                                                                     |
| Enumeração            | Valores em maiúsculas com underscore (`ACIDENTE_COM_VITIMAS`)                                                                |
| Casing                | `snake_case` nos parâmetros de query; `camelCase` no corpo e na resposta                                                     |
| Documentação viva     | OpenAPI 3.1 em `/docs` (Swagger UI) e `/redoc` (ReDoc)                                                                       |
| **Autenticação**      | **Toda rota de incidente exige `Authorization: Bearer <token>`.** `/health/*` e `/meta/enums` são públicas — veja a seção 15 |

> **Rotas ainda não implementadas** aparecem marcadas como _planejado_ na tabela
> abaixo. Elas estão descritas no plano do produto, mas **não existem na API**:
> chamá-las devolve `404`.

## 2. Endpoints

| Método   | Rota                     | Descrição                                                    | Códigos                                                       |
| -------- | ------------------------ | ------------------------------------------------------------ | ------------------------------------------------------------- |
| `GET`    | `/health/live`           | _Liveness_: o processo está vivo.                            | `200`                                                         |
| `GET`    | `/health/ready`          | _Readiness_: o banco responde de fato.                       | `200`, `503`                                                  |
| `POST`   | `/auth/login`            | Autentica e devolve o token de acesso.                       | `200`, `401`, `422`, `429`                                    |
| `POST`   | `/auth/logout`           | Revoga o token apresentado.                                  | `204`, `401`, `429`, `503`                                    |
| `GET`    | `/auth/me`               | Quem está autenticado, com o papel.                          | `200`, `401`, `429`, `503`                                    |
| `POST`   | `/auth/change-password`  | Troca a senha do próprio usuário.                            | `204`, `401`, `422`, `429`, `503`                             |
| `GET`    | `/incidents`             | Lista paginada por cursor, com filtros e ordenação.          | `200`, `400`, `401`, `422`, `429`, `503`                      |
| `GET`    | `/incidents/{id}`        | Detalhe do incidente. Devolve `ETag`.                        | `200`, `401`, `404`, `429`, `503`                             |
| `POST`   | `/incidents`             | Cria incidente. Aceita `Idempotency-Key`.                    | `201`, `401`, `409`, `422`, `429`, `503`                      |
| `POST`   | `/incidents/{id}/status` | Transição de status explícita.                               | `200`, `401`, `403`, `404`, `409`, `412`, `428`, `429`, `503` |
| `DELETE` | `/incidents/{id}`        | Soft delete (`deleted_at`). **Exige `ADMIN`.**               | `204`, `401`, `403`, `404`, `429`, `503`                      |
| `GET`    | `/incidents/{id}/events` | Timeline de auditoria do incidente.                          | `200`, `401`, `404`, `429`, `503`                             |
| `GET`    | `/meta/enums`            | Categorias, criticidades e status com rótulos PT-BR e cores. | `200`                                                         |
| `GET`    | `/users`                 | Lista as contas. **Exige `ADMIN`.**                          | `200`, `401`, `403`, `429`, `503`                             |
| `POST`   | `/users`                 | Cria a conta inativa e envia o convite. **`ADMIN`.**         | `201`, `401`, `403`, `409`, `422`, `429`, `503`               |
| `POST`   | `/users/{id}/invite`     | Reenvia o convite. **`ADMIN`.**                              | `204`, `401`, `403`, `404`, `429`, `503`                      |
| `PATCH`  | `/users/{id}`            | Ativa ou desativa a conta. **`ADMIN`.**                      | `200`, `401`, `403`, `404`, `409`, `422`, `429`, `503`        |
| `GET`    | `/vehicles`              | Busca veículos da frota por prefixo de placa.                | `200`, `401`, `422`, `429`, `503`                             |
| `PATCH`  | `/incidents/{id}`        | Edita os dados do incidente. Exige `If-Match`.               | `200`, `401`, `404`, `409`, `412`, `422`, `428`, `429`, `503` |
| `GET`    | `/incidents/stream`      | SSE com eventos em tempo real. **Não funciona em produção** (§17.3). | `200`, `401`, `429`                                    |
| `GET`    | `/docs` · `/redoc`       | Swagger UI e ReDoc.                                          | `200`                                                         |

## 3. `GET /incidents`

### 3.1 Parâmetros de query

| Parâmetro     | Tipo                       | Padrão          | Descrição                                                                          |
| ------------- | -------------------------- | --------------- | ---------------------------------------------------------------------------------- |
| `status`      | lista separada por vírgula | todos           | `ABERTO`, `EM_INVESTIGACAO`, `FECHADO`, `INCONCLUSIVO`.                            |
| `criticality` | lista separada por vírgula | todas           | `ALTA`, `MEDIA`, `BAIXA`.                                                          |
| `category`    | lista separada por vírgula | todas           | Uma das cinco categorias do domínio.                                               |
| `search`      | string                     | —               | Busca textual em `title`, `description`, `code`, `location_label` e `truck_plate`. |
| `sort`        | enum                       | `priority_desc` | `priority_desc`, `created_desc`, `created_asc`, `criticality_desc`.                |
| `limit`       | int                        | `50`            | Itens por página.                                                                  |
| `cursor`      | string opaca               | —               | Cursor devolvido em `pageInfo.nextCursor`. Ausente = primeira página.              |

> **O resultado é escopado pelo papel.** `ANALYST` e `ADMIN` enxergam a fila
> inteira; `REPORTER` enxerga apenas os incidentes que ele mesmo criou. O escopo
> entra na consulta, então `meta.total` — de onde os KPIs do topo saem — já vem
> contado dentro do recorte.

Exemplo de montagem:

```
GET /api/v1/incidents
  ?status=ABERTO,EM_INVESTIGACAO
  &criticality=ALTA
  &category=ACIDENTE_COM_VITIMAS,BLOQUEIO_DE_PISTA
  &search=BR-116
  &created_from=2026-01-01T00:00:00Z
  &created_to=2026-01-31T23:59:59Z
  &sort=priority_desc
  &limit=50
  &cursor=eyJwIjo5ODAsImlkIjoiLi4uIn0
```

O cursor é **opaco** para o cliente: ele codifica a posição do último item da
página anterior (`priority_score` e `id`) e nunca deve ser montado à mão. Cursor
inválido resulta em `400 INVALID_CURSOR`. A razão da escolha por cursor em vez
de offset está no [ADR 0010](adr/0010-cursor-pagination.md).

### 3.2 Resposta `200`

```json
{
  "items": [
    {
      "id": "0f2c9b1e-7a41-4a0e-9f52-1c3d5e7a8b90",
      "code": "INC-2026-000123",
      "title": "Acidente com vítimas — BR-116 km 412",
      "category": "ACIDENTE_COM_VITIMAS",
      "criticality": "ALTA",
      "status": "ABERTO",
      "priorityScore": 1048,
      "slaDueAt": "2026-02-11T14:30:00Z",
      "version": 3,
      "createdAt": "2026-02-11T12:04:00Z",
      "updatedAt": "2026-02-11T12:31:12Z"
    }
  ],
  "pageInfo": {
    "nextCursor": "eyJwIjo5ODAsImlkIjoiLi4uIn0",
    "hasNextPage": true,
    "limit": 50
  },
  "meta": {
    "total": 1214,
    "appliedFilters": { "criticality": ["ALTA"] }
  }
}
```

A listagem devolve um **subconjunto enxuto** do recurso: os campos que a linha
da lista precisa para ser escaneada. `description`, `driver_name`,
`resolution_notes` e a timeline ficam no detalhe.

### 3.3 As sugestões de local reusam esta rota

O campo **Local** do formulário de novo incidente sugere locais já usados em
incidentes anteriores, e não tem rota própria: ele chama esta mesma listagem com
`search=<texto>&limit=5` e lê `locationLabel` dos itens devolvidos.

**O ganho é o recorte por papel vir de graça.** A busca já aplica o
`visibility_scope` (§15.6), então um `REPORTER` recebe sugestões apenas dos
próprios incidentes — sem uma linha de código no front para isso, e valendo para o
histórico inteiro, não só para a página aberta. Um endpoint dedicado teria que
reimplementar o recorte, e reimplementação de regra de visibilidade é onde o
vazamento mora.

**O que o cliente faz para não abusar da cota.** O limite é de 60 leituras por
minuto por cliente (§14), e autocomplete é o padrão que mais dispara. Do lado do
front: debounce de 300 ms, mínimo de dois caracteres, `limit=5` e um `staleTime`
de um minuto — o último é o que faz repetir o mesmo texto não custar requisição
nenhuma.

> **Sobre ordem de chegada.** A proteção contra resposta fora de ordem é a
> **chave de cache por termo**, e não um `AbortController`: cada termo tem a sua
> entrada, e a tela lê apenas a do termo atual, então a resposta atrasada de
> `BR-1` grava numa entrada que ninguém está lendo. Um abort sozinho deixaria a
> janela entre o abort e o `fetch` chegar ao servidor. Há teste servindo uma
> resposta atrasada de propósito.

## 4. `POST /incidents`

### 4.1 Request

```json
{
  "title": "Acidente com vítimas — BR-116 km 412",
  "description": "Colisão traseira envolvendo dois veículos. Duas vítimas atendidas no local.",
  "category": "ACIDENTE_COM_VITIMAS",
  "criticality": "ALTA",
  "latitude": -23.5505,
  "longitude": -46.6333,
  "locationLabel": "BR-116 km 412, sentido SP",
  "truckPlate": "QRD1A23",
  "driverName": "João M.",
  "reportedBy": "Rádio Frota 12"
}
```

Campos obrigatórios: `title`, `category`, `criticality`, `reportedBy`.
`status` é sempre `ABERTO` na criação — o cliente não pode informá-lo.

### 4.2 Resposta `201`

```json
{
  "id": "0f2c9b1e-7a41-4a0e-9f52-1c3d5e7a8b90",
  "code": "INC-2026-000123",
  "status": "ABERTO",
  "priorityScore": 1048,
  "slaDueAt": "2026-02-11T14:30:00Z",
  "version": 1,
  "createdAt": "2026-02-11T12:04:00Z",
  "updatedAt": "2026-02-11T12:04:00Z"
}
```

Cabeçalhos relevantes: `Location: /api/v1/incidents/0f2c…` e `ETag: "1"`.

Com `Idempotency-Key` já processada e mesmo corpo, a resposta original é
reproduzida sem criar um segundo incidente.

## 5. `GET /incidents/{id}`

Resposta `200` traz o recurso completo, incluindo `description`,
`resolutionNotes`, `assignedAnalyst` e `deletedAt` (nulo quando ativo).

```json
{
  "id": "0f2c9b1e-7a41-4a0e-9f52-1c3d5e7a8b90",
  "code": "INC-2026-000123",
  "title": "Acidente com vítimas — BR-116 km 412",
  "description": "Colisão traseira envolvendo dois veículos. Duas vítimas atendidas no local.",
  "category": "ACIDENTE_COM_VITIMAS",
  "criticality": "ALTA",
  "status": "FECHADO",
  "latitude": -23.5505,
  "longitude": -46.6333,
  "locationLabel": "BR-116 km 412, sentido SP",
  "truckPlate": "QRD1A23",
  "driverName": "João M.",
  "reportedBy": "Rádio Frota 12",
  "assignedAnalyst": "Marina S.",
  "resolutionNotes": "Vítimas atendidas pelo SAMU. Pista liberada às 14h10.",
  "priorityScore": 1048,
  "slaDueAt": "2026-02-11T14:30:00Z",
  "version": 4,
  "createdAt": "2026-02-11T12:04:00Z",
  "updatedAt": "2026-02-11T14:12:40Z",
  "closedAt": "2026-02-11T14:12:40Z",
  "deletedAt": null
}
```

Cabeçalhos de resposta: `ETag: "4"` e `Cache-Control: no-cache`
(armazenável, mas sempre revalidado). Incidente removido com soft delete
responde `410 Gone`, o que diferencia "nunca existiu" de "existiu e foi
removido".

## 6. `PATCH /incidents/{id}`

> ⚠️ **PLANEJADO — não implementado.** Esta rota **não existe** na API: chamá-la
> devolve `404`. O contrato abaixo descreve o que está previsto, e serve de
> referência para a implementação. Enquanto ela não existir, **não há como
> corrigir os dados de um incidente** — só o status muda.

Atualização parcial dos dados. Para **alterar o status** é obrigatório enviar
`If-Match` com a versão conhecida, ou `expectedVersion` no corpo como
alternativa para teste manual no Swagger.

### 6.1 Request

```http
PATCH /api/v1/incidents/0f2c9b1e-7a41-4a0e-9f52-1c3d5e7a8b90 HTTP/1.1
Content-Type: application/json
If-Match: "3"
Idempotency-Key: 4b1d9c02-8f77-4a91-b0a3-6c1e2d5f7a33

{
  "criticality": "ALTA",
  "assignedAnalyst": "Marina S.",
  "status": "EM_INVESTIGACAO"
}
```

### 6.2 Resposta `200`

```json
{
  "id": "0f2c9b1e-7a41-4a0e-9f52-1c3d5e7a8b90",
  "code": "INC-2026-000123",
  "status": "EM_INVESTIGACAO",
  "criticality": "ALTA",
  "assignedAnalyst": "Marina S.",
  "priorityScore": 1048,
  "version": 4,
  "updatedAt": "2026-02-11T12:31:12Z"
}
```

### 6.3 Resposta `409` — conflito de versão

```json
{
  "error": {
    "code": "VERSION_CONFLICT",
    "message": "Este incidente foi alterado por outra pessoa depois que você o abriu.",
    "details": {
      "expectedVersion": 3,
      "currentVersion": 4,
      "serverState": {
        "status": "FECHADO",
        "assignedAnalyst": "Marina S.",
        "resolutionNotes": "Vítimas atendidas pelo SAMU. Pista liberada às 14h10.",
        "updatedAt": "2026-02-11T14:12:40Z"
      }
    },
    "requestId": "01JQ8XK3M9P2V7QW",
    "timestamp": "2026-02-11T14:13:02Z"
  }
}
```

O corpo do `409` carrega o **estado atual do recurso**, e não apenas a mensagem
de erro. É isso que permite ao modal de conflito mostrar o diff campo a campo
em vez de exigir um recarregamento.

## 7. `POST /incidents/{id}/status`

Transição de status explícita, com validação da máquina de estados. Existe
separada do `PATCH` para deixar o contrato legível: uma rota, uma intenção.

### 7.1 Request

```http
POST /api/v1/incidents/0f2c9b1e-7a41-4a0e-9f52-1c3d5e7a8b90/status HTTP/1.1
Content-Type: application/json
If-Match: "3"

{
  "status": "FECHADO",
  "resolutionNotes": "Vítimas atendidas pelo SAMU. Pista liberada às 14h10.",
  "actor": "Marina S."
}
```

### 7.2 Resposta `200`

```json
{
  "id": "0f2c9b1e-7a41-4a0e-9f52-1c3d5e7a8b90",
  "code": "INC-2026-000123",
  "status": "FECHADO",
  "resolutionNotes": "Vítimas atendidas pelo SAMU. Pista liberada às 14h10.",
  "allowedTransitions": [],
  "closedAt": "2026-02-11T14:12:40Z",
  "version": 4
}
```

`allowedTransitions` devolve as transições válidas a partir do novo estado. O
front usa esse campo para **desabilitar** o que é inválido — defesa em
profundidade, já que a decisão real é sempre do servidor.

### 7.3 Resposta `422` — transição proibida

```json
{
  "error": {
    "code": "INVALID_STATUS_TRANSITION",
    "message": "Não é possível ir de FECHADO para EM_INVESTIGACAO.",
    "details": {
      "from": "FECHADO",
      "to": "EM_INVESTIGACAO",
      "allowed": []
    },
    "requestId": "01JQ8XK3M9P2V7QW",
    "timestamp": "2026-02-11T14:20:11Z"
  }
}
```

`FECHADO` é terminal. Reabrir exige um **novo** incidente vinculado — o que
preserva o histórico e mantém a auditoria limpa.

## 8. `GET /incidents/{id}/events`

```json
{
  "items": [
    {
      "id": "b7d4…",
      "eventType": "CREATED",
      "fromStatus": null,
      "toStatus": "ABERTO",
      "actor": "Rádio Frota 12",
      "payload": null,
      "createdAt": "2026-02-11T12:04:00Z"
    },
    {
      "id": "c1e9…",
      "eventType": "STATUS_CHANGED",
      "fromStatus": "EM_INVESTIGACAO",
      "toStatus": "FECHADO",
      "actor": "Marina S.",
      "payload": {
        "expectedVersion": 4,
        "resolutionNotes": "Vítimas atendidas pelo SAMU."
      },
      "createdAt": "2026-02-11T14:12:40Z"
    }
  ]
}
```

A timeline é **append-only**: nenhum evento é editado ou removido, inclusive
quando o incidente recebe soft delete. O detalhe do incidente passa a devolver
`404` depois da remoção, mas `GET /incidents/{id}/events` continua respondendo —
senão "remover sem apagar o histórico" seria falso.

O `payload` guarda o contexto do evento, não o estado inteiro: em `CREATED` ele é
nulo, porque quem criou já está em `actor`; em `STATUS_CHANGED` ele traz a versão
que o cliente declarou esperar (o que permite explicar depois por que uma
transição foi aceita e outra recusada) e a justificativa, quando houve.

## 9. `GET /meta/enums`

Devolve o contrato fechado do domínio com os rótulos em português e as cores do
design system. A interface monta filtros e badges a partir desta resposta, em
vez de duplicar a lista de categorias no código.

```json
{
  "categories": [
    { "value": "ACIDENTE_COM_VITIMAS", "label": "Acidente com Vítimas" },
    { "value": "BLOQUEIO_DE_PISTA", "label": "Bloqueio de Pista" },
    { "value": "ACIDENTE_COM_VEICULO", "label": "Acidente com Veículo" },
    { "value": "CONDICAO_CLIMATICA_ATIPICA", "label": "Condição Climática Atípica na Pista" },
    { "value": "PROBLEMA_MECANICO", "label": "Problema Mecânico" }
  ],
  "criticalities": [
    { "value": "ALTA", "label": "Alta", "color": "#DC2626", "icon": "triangle", "weight": 500 },
    { "value": "MEDIA", "label": "Média", "color": "#D97706", "icon": "diamond", "weight": 250 },
    { "value": "BAIXA", "label": "Baixa", "color": "#2563EB", "icon": "circle", "weight": 80 }
  ],
  "statuses": [
    { "value": "ABERTO", "label": "Aberto", "kind": "open" },
    { "value": "EM_INVESTIGACAO", "label": "Em Investigação", "kind": "open" },
    { "value": "FECHADO", "label": "Fechado", "kind": "terminal" },
    { "value": "INCONCLUSIVO", "label": "Inconclusivo", "kind": "terminal" }
  ],
  "transitions": {
    "ABERTO": ["EM_INVESTIGACAO", "INCONCLUSIVO", "FECHADO"],
    "EM_INVESTIGACAO": ["FECHADO", "INCONCLUSIVO", "ABERTO"],
    "INCONCLUSIVO": ["EM_INVESTIGACAO", "FECHADO"],
    "FECHADO": []
  }
}
```

## 10. `GET /incidents/stream` (SSE)

> ⚠️ **PLANEJADO — não implementado.** A rota **não existe** na API. Hoje a
> lista é atualizada por _refetch_; o SSE entra como evolução, com o cuidado de
> **não reordenar a lista sob o cursor do analista** — novos itens aparecem como
> um selo "3 novos", e não empurrando as linhas.

Stream de eventos no formato `text/event-stream`:

```
event: incident.created
data: {"id":"…","code":"INC-2026-000124","criticality":"ALTA","priorityScore":1210}

event: incident.updated
data: {"id":"…","version":5,"status":"FECHADO"}

: heartbeat
```

A interface consome esses eventos para incrementar um contador — _"3 novos
incidentes"_ — e **não** reordena a lista sob o cursor da analista. A
atualização da lista acontece sob ação explícita. A escolha de SSE em vez de
WebSocket está no [ADR 0011](adr/0011-sse.md).

## 11. Envelope de erro único

Toda resposta de erro da API usa o mesmo formato. Não existe `{"detail": "..."}`
solto, nem HTML de erro de framework vazando para o cliente.

```json
{
  "error": {
    "code": "INVALID_STATUS_TRANSITION",
    "message": "Não é possível ir de FECHADO para EM_INVESTIGACAO.",
    "details": { "from": "FECHADO", "to": "EM_INVESTIGACAO", "allowed": [] },
    "requestId": "01JQ8XK3M9P2V7QW",
    "timestamp": "2026-02-11T12:31:12Z"
  }
}
```

| Campo             | Descrição                                                                                       |
| ----------------- | ----------------------------------------------------------------------------------------------- |
| `error.code`      | Identificador estável, legível por máquina. É o campo que o cliente interpreta.                 |
| `error.message`   | Texto em português, pronto para exibição em último caso. Nunca contém _stack trace_.            |
| `error.details`   | Objeto específico do código — campos inválidos, transições permitidas, estado atual do recurso. |
| `error.requestId` | Mesmo valor de `X-Request-Id`, para correlacionar com o log do servidor.                        |
| `error.timestamp` | Momento em que o erro foi gerado, em UTC.                                                       |

Erros de validação do Pydantic seguem o mesmo envelope, com `code:
"VALIDATION_ERROR"` e `details.fields` listando cada campo e a regra violada —
o FastAPI não devolve o formato padrão `{"detail": [...]}` nesta API.

## 12. Catálogo de códigos de erro

| Código                        | HTTP  | Quando ocorre                                                                          | O que o cliente deve fazer                                                                |
| ----------------------------- | ----- | -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `INVALID_CREDENTIALS`         | `401` | Login: e-mail inexistente, senha incorreta **ou conta desativada**.                    | Erro no formulário. **Não** limpar a sessão: este 401 não é sessão expirada.              |
| `UNAUTHENTICATED`             | `401` | Sem token, token inválido, revogado por logout, ou usuário desativado depois do login. | Descartar a sessão e voltar ao login.                                                     |
| `TOKEN_EXPIRED`               | `401` | Token de acesso vencido.                                                               | Único caso em que vale renovar a sessão em vez de relogar.                                |
| `INSUFFICIENT_ROLE`           | `403` | Autenticado, mas o papel não permite a ação.                                           | Esconder ou desabilitar a ação. `details.required` diz qual permissão faltou.             |
| `WEAK_PASSWORD`               | `422` | Senha nova fora da política (mínimo 12 caracteres).                                    | Mostrar os requisitos e o que faltou, em `details.minLength`.                             |
| `VALIDATION_ERROR`            | `422` | Corpo ou query com tipo, formato ou faixa inválida.                                    | Destacar os campos de `details.fields`. Não repetir a requisição sem corrigir.            |
| `INVALID_STATUS_TRANSITION`   | `422` | Tentativa de transição proibida pela máquina de estados.                               | Recarregar o recurso e oferecer apenas as transições de `details.allowed`.                |
| `RESOLUTION_NOTES_REQUIRED`   | `422` | `FECHADO` ou `INCONCLUSIVO` sem `resolution_notes` (mínimo 10 caracteres).             | Abrir o campo de nota com foco e contador.                                                |
| `INVALID_CURSOR`              | `400` | `cursor` malformado ou de outro conjunto de filtros.                                   | Reiniciar a paginação sem cursor.                                                         |
| `INVALID_FILTER`              | `422` | Valor de filtro inválido para o enum (ex.: `status=RESOLVIDO`).                        | Corrigir o parâmetro apontado em `details.parameter`; `details.allowed` lista os válidos. |
| `INCIDENT_NOT_FOUND`          | `404` | `id` inexistente **ou removido por soft delete**.                                      | Remover o item da lista.                                                                  |
| `VERSION_CONFLICT`            | `409` | CAS falhou: `version` no banco difere da esperada.                                     | **Rollback da UI otimista** e abrir o modal de conflito com `details.serverState`.        |
| `PRECONDITION_FAILED`         | `412` | `If-Match` em formato inválido.                                                        | Recarregar o recurso e pedir nova confirmação.                                            |
| `PRECONDITION_REQUIRED`       | `428` | A mudança de status chegou sem `If-Match` e sem `expectedVersion`.                     | Enviar a versão conhecida do recurso. A API recusa para não desligar o lock.              |
| `IDEMPOTENCY_KEY_REUSED`      | `409` | Mesma `Idempotency-Key` reenviada com corpo diferente.                                 | Erro de programação do cliente: gerar chave nova por operação.                            |
| `IDEMPOTENCY_KEY_IN_PROGRESS` | `409` | Mesma chave ainda em processamento.                                                    | Aguardar e repetir com a **mesma** chave.                                                 |
| `INVALID_IDEMPOTENCY_KEY`     | `422` | Chave vazia, com espaço ou acima de 120 caracteres.                                    | Gerar a chave como UUID v4 por operação lógica.                                           |
| `RATE_LIMIT_EXCEEDED`         | `429` | Teto de requisições por cliente excedido.                                              | Respeitar `Retry-After` e reduzir a frequência.                                           |
| `SERVICE_UNAVAILABLE`         | `503` | Banco indisponível ou lento, ou circuit breaker aberto.                                | Manter o cache na tela, avisar instabilidade e repetir após `Retry-After`.                |
| `CODE_GENERATION_FAILED`      | `503` | Não foi possível gerar um código `INC-AAAA-NNNNNN` único após 5 tentativas.            | Repetir mais tarde; é colisão de sequência, não erro do payload.                          |
| `EMAIL_ALREADY_EXISTS`        | `409` | Criação de conta com e-mail já cadastrado.                                             | Mostrar o erro no campo de e-mail.                                                        |
| `USER_NOT_FOUND`              | `404` | Identificador de conta inexistente na administração.                                   | Recarregar a lista de contas.                                                             |
| `CANNOT_DEACTIVATE_SELF`      | `409` | Um administrador tentou desativar a própria conta.                                     | Explicar que outro administrador precisa fazer isso.                                      |
| `PASSWORD_CHANGE_REQUIRED`    | `403` | Sessão de primeiro acesso chamando rota comum.                                         | Levar para a tela de definir senha. `details.allowed` lista o que responde.               |
| `INTERNAL_ERROR`              | `500` | Falha inesperada não classificada.                                                     | Mostrar mensagem neutra com `requestId` para suporte. Deve ser raro por construção.       |

### 12.1 Por que `409` e não `412` no conflito

`412 Precondition Failed` seria defensável para uma falha de `If-Match`, mas
`409 Conflict` comunica melhor o que de fato aconteceu: **alguém alterou o
recurso antes de você**. É também o código que os clientes tratam por padrão
como "estado divergente, recarregue e reconcilie".

Os dois coexistem com papéis distintos:

- **`409 VERSION_CONFLICT`** — conflito real, com uma versão que já existiu.
  O corpo traz `serverState`.
- **`412 PRECONDITION_FAILED`** — precondição mal formada, com um ETag que
  nunca correspondeu a este recurso. O corpo traz o `ETag` atual.

### 12.2 Por que `503` e nunca `500` cru

Quando o banco não responde, a API devolve `503` com `Retry-After`. Um `500`
diz "há um bug aqui"; `503` diz "tente de novo em instantes", que é a
informação verdadeira e acionável. A interface reage de forma diferente a cada
um: mantém o cache e agenda repetição no `503`; mostra card de erro fatal no
`500`.

### 12.3 Por que `428` quando a versão não é enviada

`428 Precondition Required` (RFC 6585) é a resposta para uma mudança de status
que chega **sem** `If-Match` e **sem** `expectedVersion`.

A alternativa seria assumir "última escrita vence" quando o cliente omite a
versão. Isso parece conveniente e é justamente o que anula a proteção: bastaria
não enviar o cabeçalho para sobrescrever a decisão de outro analista sem
qualquer detecção de conflito. Exigir a precondição transforma o esquecimento
em erro explícito (`428`) em vez de perda silenciosa de dados.

O recurso continua legível e atualizável por outros caminhos: `GET` não exige
precondição, e a versão necessária vem no `ETag` da resposta e no campo
`version` do corpo.

## 13. Versionamento e cabeçalhos

### 13.1 Cabeçalhos de requisição

| Cabeçalho         | Onde                                        | Para que serve                                                                                                                                             |
| ----------------- | ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `If-Match`        | `PATCH` e `POST /status` que alteram status | Traz a versão conhecida do recurso (`"3"`). É a entrada do compare-and-swap.                                                                               |
| `Idempotency-Key` | `POST` e `PATCH`                            | UUID v4 único por operação lógica. Torna o retry seguro: repetir a mesma chave com o mesmo corpo devolve a resposta original em vez de duplicar a mutação. |
| `X-Request-Id`    | Todas                                       | Correlação nos logs. Se o cliente não enviar, o servidor gera.                                                                                             |
| `Accept-Language` | Todas                                       | `pt-BR` (padrão) ou `en-US` para mensagens de erro. <!-- confirmar suporte a en-US -->                                                                     |

### 13.2 Cabeçalhos de resposta

| Cabeçalho       | Onde                                                   | Significado                                                                              |
| --------------- | ------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| `ETag`          | `GET /incidents/{id}`, `POST`, `PATCH`, `POST /status` | Versão atual do recurso, como string citada (`"4"`). É o valor a devolver em `If-Match`. |
| `Location`      | `POST /incidents` (`201`)                              | URL do recurso criado.                                                                   |
| `Retry-After`   | `429` e `503`                                          | Segundos que o cliente deve aguardar antes de repetir.                                   |
| `X-Request-Id`  | Todas                                                  | Eco do identificador de correlação.                                                      |
| `Cache-Control` | `GET`                                                  | `no-cache` no detalhe; `private, max-age=30` na listagem, sempre com revalidação.        |

### 13.3 Ciclo do `ETag`

```mermaid
sequenceDiagram
    participant C as Cliente
    participant S as API

    C->>S: GET /incidents/{id}
    S-->>C: 200 · ETag "3" · version 3
    Note over C: usuária edita o recurso
    C->>S: PATCH · If-Match "3"
    alt versão ainda é 3
        S-->>C: 200 · ETag "4" · version 4
    else alguém alterou antes
        S-->>C: 409 · serverState com version 4
    end
```

O `ETag` é o valor numérico de `version` entre aspas. Isso aproxima a
semântica HTTP do mecanismo de banco: o cabeçalho não é decoração, é a
precondição que o `UPDATE ... WHERE version = :expected` vai avaliar.

### 13.4 Versionamento da API

| Nível                 | Estratégia                                                                                             |
| --------------------- | ------------------------------------------------------------------------------------------------------ |
| Versão maior          | Prefixo no caminho (`/api/v1`). Mudança incompatível exige `/api/v2` e período de convivência.         |
| Adição compatível     | Novo campo opcional em resposta ou novo parâmetro de query opcional. Não incrementa versão.            |
| Remoção ou renomeação | Só em versão maior.                                                                                    |
| Códigos de erro       | **Estáveis.** Um `code` nunca muda de significado; adicionar código novo é compatível, renomear não é. |
| Depreciação           | Anunciada no `CHANGELOG.md` e nos cabeçalhos de resposta da rota afetada.                              |

### 13.4 Cabeçalhos de segurança

Toda resposta — de sucesso ou de erro — traz os cabeçalhos abaixo.

| Cabeçalho                   | Valor                                                  | Por quê                                                                                     |
| --------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| `X-Content-Type-Options`    | `nosniff`                                              | Impede o navegador de adivinhar o tipo e tratar um JSON como script                         |
| `Referrer-Policy`           | `no-referrer`                                          | Não vaza a URL da API, que carrega o id do incidente, para sites de terceiros               |
| `X-Frame-Options`           | `DENY`                                                 | A API não é feita para ser embutida em iframe                                               |
| `Permissions-Policy`        | `camera=(), microphone=(), geolocation=(), payment=()` | Nada aqui usa esses recursos; declarar tira o acesso das páginas que consomem a API         |
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains`                  | **Só em produção**: em HTTP o navegador ignora, e localmente fixaria `https` em `localhost` |

Eles são aplicados por middleware, e não por rota, justamente para valerem também
nas respostas de erro — que é onde um tipo de conteúdo mal interpretado faria
mais estrago. O middleware fica **fora** do limitador de taxa, então a resposta
`429` também sai com eles.

## 14. Limites de uso

| Operação                            | Padrão     | Configuração                  |
| ----------------------------------- | ---------- | ----------------------------- |
| Leitura (`GET`, `HEAD`)             | 60 req/min | `RATE_LIMIT_READ_PER_MINUTE`  |
| Escrita (`POST`, `PATCH`, `DELETE`) | 20 req/min | `RATE_LIMIT_WRITE_PER_MINUTE` |
| Desligar o teto                     | —          | `RATE_LIMIT_ENABLED=false`    |

A cota é **por cliente**: o `X-Forwarded-For` quando há proxy à frente, e o IP da
conexão caso contrário. A janela é **deslizante** — os últimos 60 segundos são
contados a cada requisição —, então o teto vale a qualquer momento e o
`Retry-After` sai exato, em vez de "até o fim do minuto".

`/health/live` e `/health/ready` **não consomem cota**, e o preflight de CORS
(`OPTIONS`) também não. Recusar o healthcheck faria a plataforma marcar o serviço
como doente e reiniciar o deploy.

Excedido o limite, a resposta é `429` com `Retry-After` e o envelope de erro
habitual, trazendo `details.retryAfterSeconds` e `details.limitPerMinute`. O
limite existe tanto para proteger o serviço quanto para conter um cliente com
retry mal configurado — que é exatamente o cenário de rede instável que o produto
precisa suportar.

## 15. Autenticação e autorização

> Esta seção é a referência do fluxo de login. A decisão e as alternativas
> descartadas estão no [ADR 0015](adr/0015-autenticacao-jwt.md).

### 15.1 Como o cliente se autentica

`POST /auth/login` devolve um **token JWT** que acompanha toda requisição
seguinte no cabeçalho:

```
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

**Onde guardar:** `sessionStorage`, com o instante de expiração calculado
localmente a partir de `expiresIn`. O token morre ao fechar a aba — a tela de
login não tem "lembrar-me", então guardá-lo por mais tempo seria exposição sem
contrapartida.

### 15.2 `POST /auth/login`

```jsonc
// requisição
{ "email": "ana@demo.example.com", "password": "ana.logos2026" }

// 200
{
  "accessToken": "eyJhbGciOi...",
  "tokenType": "Bearer",
  "expiresIn": 28800,                              // SEGUNDOS (8 h)
  "user": {
    "id": "9f3c...",
    "email": "ana@demo.example.com",
    "name": "Ana Paula Ribeiro",
    "role": "ANALYST",
    "lastLoginAt": "2026-10-15T09:12:00Z"          // o acesso ANTERIOR; null no primeiro
  }
}
```

**`lastLoginAt` é o acesso anterior, não o atual.** O valor do banco só é
atualizado **depois** de montar a resposta — devolver "agora" faria a interface
mostrar _"último acesso: agora"_, que não informa nada a quem acabou de entrar.

**E-mail inexistente, senha incorreta e conta desativada produzem a MESMA
resposta** (`401 INVALID_CREDENTIALS`, mensagem idêntica, tempo de resposta
equivalente). Diferenciá-las revelaria quais e-mails existem, e uma resposta
própria para conta desativada confirmaria que a senha estava certa.

### 15.3 `GET /auth/me`

```jsonc
{
  "id": "9f3c...",
  "email": "ana@demo.example.com",
  "name": "Ana Paula Ribeiro",
  "role": "ANALYST",
  "lastLoginAt": "2026-10-16T01:18:46Z",
}
```

É a fonte do nome e do papel que a interface exibe no cabeçalho.

### 15.4 `POST /auth/logout` → `204`

Revoga o token apresentado. **A revogação é real:** o `jti` entra numa lista de
bloqueio e o token deixa de valer imediatamente, mesmo antes de vencer. Sem isso,
sair da aplicação seria apenas o cliente esquecendo o token, e um token capturado
continuaria válido.

### 15.5 `POST /auth/change-password` → `204`

```jsonc
{ "currentPassword": "ana.logos2026", "newPassword": "uma-senha-bem-longa" }
```

A senha nova precisa de **mínimo 12 caracteres**. Não há exigência de símbolo ou
maiúscula: regra de composição empurra o usuário para `Senha@123`, que é
previsível e pior que uma frase longa.

### 15.6 Papéis e o que cada um pode

| Ação                   | `REPORTER` | `ANALYST` | `ADMIN` |
| ---------------------- | :--------: | :-------: | :-----: |
| Criar incidente        |     ✅     |    ✅     |   ✅    |
| Listar e ver detalhe   | só os seus |   todos   |  todos  |
| Ver a timeline         | só os seus |   todos   |  todos  |
| Assumir e transicionar |     ❌     |    ✅     |   ✅    |
| Remover (soft delete)  |     ❌     |    ❌     |   ✅    |

`REPORTER` é o operador de rádio ou do 0800: registra o que aconteceu na estrada
e acompanha o que ele mesmo abriu. `ANALYST` conduz a fila. `ADMIN` é o único que
remove, porque remover é irreversível pela API.

**Quem não enxerga um incidente recebe `404`, não `403`.** Responder _"existe, mas
não é seu"_ revelaria a existência de um registro que a pessoa não pode ver. O
`403` fica reservado para quando ela **pode ver** e não pode agir — aí a distinção
é útil e não vaza nada.

### 15.7 O que a interface deve fazer com cada 401

| Código                | Situação                    | Ação na interface                      |
| --------------------- | --------------------------- | -------------------------------------- |
| `INVALID_CREDENTIALS` | Erro no formulário de login | Mostrar o erro **sem limpar a sessão** |
| `UNAUTHENTICATED`     | Sessão inválida ou revogada | Descartar a sessão e voltar ao login   |
| `TOKEN_EXPIRED`       | Token venceu                | Único caso em que vale tentar renovar  |

> **Atenção ao implementar o interceptor:** o `401` do login é
> `INVALID_CREDENTIALS` e **não pode** disparar o mesmo tratamento de "sessão
> expirada" — senão uma senha digitada errada limpa a sessão e recarrega a tela.

### 15.8 Contas de demonstração

Criadas pelo seed quando a base está vazia:

| Conta                         | Senha                | Papel      |
| ----------------------------- | -------------------- | ---------- |
| `ana@demo.example.com`            | `ana.logos2026`      | `ANALYST`  |
| `carlos@demo.example.com`         | `carlos.logos2026`   | `ANALYST`  |
| `alyssonaraujowork@gmail.com` | `alysson.logos2026`  | `ANALYST`  |
| `renata.lima@example.org`     | `renata.logos2026`   | `ANALYST`  |
| `admin@demo.example.com`          | `admin.logos2026`    | `ADMIN`    |
| `carlos.menezes@example.com`  | `carlos.logos2026`   | `ADMIN`    |
| `marina@demo.example.com`         | `marina.logos2026`   | `REPORTER` |
| `joana.prado@example.net`     | `joana.logos2026`    | `REPORTER` |
| `marcos.tavares@example.org`  | — convite pendente — | `REPORTER` |

Todas as senhas seguem o padrão `<primeiro>.logos2026` e ficam **acima do mínimo
de 12 caracteres** da política — uma credencial de demonstração que a própria
aplicação recusaria seria um detalhe ruim de se ver em uma demonstração.

Os domínios `example.com`, `example.org` e `example.net` são reservados pela RFC
2606: não pertencem a ninguém. Como o convite sai por SMTP de verdade (§16), uma
conta de demonstração num domínio de gente real colocaria uma credencial na caixa
de entrada de um estranho no primeiro "Reenviar" clicado. As contas do edital
ficam em `demo.example.com`, subdomínio do reservado `example.com` — nunca
resolve e nunca recebe e-mail, e as distingue das demais contas do seed. A única
exceção deliberada é a conta pessoal de quem apresenta.

`marcos.tavares` nasce com **convite pendente** — inativo, com senha temporária
dentro do prazo e sem senha definitiva —, que é o estado com que a tela de
administração de contas abre. **O seed não envia e-mail nenhum**: quem envia é o
fluxo de administração.

**Não existe endpoint de cadastro.** Contas abertas numa central de incidentes
seriam um risco, não uma funcionalidade: usuários são criados pelo seed ou por
operação administrativa.

### 15.9 Autoria na auditoria

Com a autenticação, o campo `actor` da timeline passa a ser **quem realmente
agiu**, e não um texto do corpo da requisição:

| Evento           | Autor registrado  |
| ---------------- | ----------------- |
| `CREATED`        | quem cadastrou    |
| `STATUS_CHANGED` | quem transicionou |
| `DELETED`        | quem removeu      |

`reportedBy` **continua existindo** e continua vindo do corpo: é o **canal de
origem** do chamado (`"Rádio Frota 12"`, `"Central 0800"`), não uma pessoa. Os
dois convivem no registro — o rádio reporta, a analista cadastra, e a auditoria
guarda quem cadastrou.

Do mesmo modo, `assignedAnalyst` **não é mais um campo de texto**: passa a ser
consequência da ação.

| Transição para    | Efeito em `assignedAnalyst`                     |
| ----------------- | ----------------------------------------------- |
| `EM_INVESTIGACAO` | quem move **assume o caso**                     |
| `ABERTO`          | **limpa** — devolver à fila é devolver sem dono |
| `FECHADO`         | preserva quem conduziu                          |

### 15.10 Configuração

| Variável                 | Padrão        | Efeito                                                                            |
| ------------------------ | ------------- | --------------------------------------------------------------------------------- |
| `AUTH_SECRET_KEY`        | chave de dev  | Assina os tokens. **Em produção a aplicação recusa subir com o valor de exemplo** |
| `AUTH_TOKEN_TTL_SECONDS` | `28800` (8 h) | Validade do token de acesso                                                       |

A recusa em produção é deliberada: uma chave de assinatura pública é pior que
nenhuma, porque qualquer pessoa forja um token válido para qualquer usuário,
inclusive `ADMIN`. Falhar na subida é melhor que rodar em silêncio com a porta
aberta.

## 16. Administração de contas

> **Não existe endpoint de cadastro.** Contas abertas numa central de incidentes
> seriam um risco, não uma funcionalidade: quem entra é convidado por um
> administrador.

### 16.1 O fluxo, do convite ao acesso pleno

```mermaid
sequenceDiagram
    participant A as ADMIN
    participant API as Logos API
    participant M as E-mail
    participant P as Pessoa convidada
    A->>API: POST /users { email, role }
    API->>API: cria INATIVA + senha temporária (24 h)
    API->>M: convite com a senha
    API-->>A: 201 { id, email, role, inviteExpiresAt }
    Note over A,API: a senha NÃO volta na resposta
    P->>API: POST /auth/login (senha temporária)
    API-->>P: 200 { mustChangePassword: true }
    P->>API: GET /incidents
    API-->>P: 403 PASSWORD_CHANGE_REQUIRED
    P->>API: POST /auth/change-password
    API->>API: senha definitiva, conta ATIVA, convite concluído
    API-->>P: 204
    P->>API: POST /auth/login (senha nova)
    API-->>P: 200 { mustChangePassword: false }
```

### 16.2 Rotas

| Método  | Rota                 | Sucesso | Descrição                                  |
| ------- | -------------------- | ------- | ------------------------------------------ |
| `GET`   | `/users`             | `200`   | Lista as contas                            |
| `POST`  | `/users`             | `201`   | Cria a conta inativa e envia o convite     |
| `POST`  | `/users/{id}/invite` | `204`   | Reenvia: nova senha temporária, novo prazo |
| `PATCH` | `/users/{id}`        | `200`   | `{ isActive: bool }` ativa ou desativa     |

**Todas exigem `ADMIN`.** Os demais papéis recebem `403 INSUFFICIENT_ROLE` — não
por conveniência, mas porque é a permissão que **distribui todas as outras**:
quem administra contas escolhe quem entra e com que papel.

### 16.3 `GET /users`

```jsonc
[
  {
    "id": "9f3c...",
    "name": "Paula Mendes",
    "email": "paula.mendes@example.com",
    "role": "REPORTER",
    "isActive": false,
    "invitePending": true,
    "lastLoginAt": null,
    "createdAt": "2026-10-17T22:31:04Z",
  },
]
```

Ordenado das contas mais recentes para as mais antigas. **Nenhum hash de senha
sai nesta resposta** — nem o definitivo, nem o da temporária.

`invitePending` é derivado: existe senha temporária dentro do prazo e a pessoa
**ainda não entrou**. O primeiro acesso com a temporária não conta como entrada,
porque é uma troca de credencial e não uma sessão de trabalho — por isso o
convite só sai de pendente quando a senha definitiva é definida.

### 16.4 `POST /users`

```jsonc
// requisição — SEM campo de senha
{ "email": "paula.mendes@example.com", "role": "REPORTER", "name": "Paula Mendes" }

// 201
{
  "id": "9f3c...",
  "email": "paula.mendes@example.com",
  "role": "REPORTER",
  "inviteExpiresAt": "2026-10-18T22:31:04Z"
}
```

| Regra           | Comportamento                                                                                 |
| --------------- | --------------------------------------------------------------------------------------------- |
| E-mail          | Normalizado (minúsculo, sem espaços) e validado; duplicado devolve `409 EMAIL_ALREADY_EXISTS` |
| `name`          | Opcional. Sem ele, é derivado do e-mail: `paula.mendes@` → `Paula Mendes`                     |
| `role`          | `REPORTER`, `ANALYST` ou `ADMIN`                                                              |
| Estado inicial  | **Inativa**, com convite pendente                                                             |
| Senha           | **Gerada pelo servidor** e enviada por e-mail. O administrador não a vê nem a escolhe         |
| Falha de e-mail | Vira log de erro. A conta continua criada e a resposta continua `201`                         |

**Nunca aceite `password` neste corpo.** Se o campo vier, ele é descartado: quem
define a senha é quem vai usá-la. O administrador conhecer a credencial de outra
pessoa seria o oposto de auditoria.

**Sobre a falha de e-mail não derrubar a criação:** transformar um erro de
serviço externo em falha de cadastro faria o administrador achar que nada foi
criado — e tentar de novo produziria um conflito de e-mail, deixando a impressão
de que o sistema travou. O convite já está gravado quando o envio acontece; se
falhar, existe o botão **Reenviar**.

### 16.5 `POST /users/{id}/invite` → `204`

Reemite o convite com **senha temporária nova** e prazo novo. A anterior deixa de
valer no mesmo instante: dois convites válidos ao mesmo tempo seriam duas
credenciais circulando por e-mail. É também o caminho de recuperação do convite
vencido.

### 16.6 `PATCH /users/{id}`

```jsonc
{ "isActive": false }   // desativa e encerra as sessões abertas
{ "isActive": true }    // reativa
```

| Regra            | Comportamento                                                      |
| ---------------- | ------------------------------------------------------------------ |
| Desativar        | Encerra as sessões abertas **e invalida um convite pendente**      |
| Reativar         | O token emitido antes do afastamento **não volta à vida**          |
| PATCH sem efeito | Um pedido que não muda o estado não derruba a sessão de quem pediu |
| A própria conta  | `409 CANNOT_DEACTIVATE_SELF`                                       |

Desativar invalida o convite porque manter uma senha temporária válida numa conta
afastada deixaria uma porta de entrada aberta exatamente em quem foi removido. E
um administrador não se desativa porque, sem isso, o último administrador ativo
poderia se afastar e deixar o sistema sem ninguém capaz de gerenciar contas.

### 16.7 Senha temporária e primeiro acesso

| Aspecto       | Definição                                                             |
| ------------- | --------------------------------------------------------------------- |
| Prazo         | **24 horas**                                                          |
| Uso           | **Único**: concluir o primeiro acesso invalida a temporária           |
| Armazenamento | **Só o hash** Argon2id, como qualquer senha                           |
| Comprimento   | 16 caracteres                                                         |
| Alfabeto      | Sem `0`/`O` e sem `1`/`l`/`I` — a senha é digitada à mão de um e-mail |
| Geração       | `secrets`, e não `random`: é uma credencial, mesmo temporária         |

`POST /auth/login` passa a devolver **`mustChangePassword`**:

```jsonc
{
  "accessToken": "eyJhbGciOi...",
  "tokenType": "Bearer",
  "expiresIn": 28800,
  "mustChangePassword": true,
  "user": { "id": "9f3c...", "role": "REPORTER", "lastLoginAt": null, ... }
}
```

Com `mustChangePassword` verdadeiro, **só estas rotas respondem**:

| Rota                         | Por quê                          |
| ---------------------------- | -------------------------------- |
| `POST /auth/change-password` | É o objetivo da sessão           |
| `GET /auth/me`               | A tela precisa saber quem entrou |
| `POST /auth/logout`          | Ver a nota abaixo                |

Qualquer outra devolve `403 PASSWORD_CHANGE_REQUIRED`.

> **Por que o logout está na lista.** O contrato original citava apenas as duas
> primeiras rotas. Negar a saída deixaria a sessão viva por até 8 horas — o
> oposto do que a restrição existe para proteger — e sair não concede poder
> nenhum. É uma ampliação deliberada, não um esquecimento.

**Por que este bloqueio é o ponto de segurança mais importante da tarefa:** sem
ele, quem recebeu um convite tem o papel de `ANALYST` por 24 horas só por ter
aberto o e-mail. A senha temporária viajou por e-mail e foi escolhida por outra
pessoa — ela serve para **definir uma senha**, e não para operar a central.

**Convite vencido → `401 INVALID_CREDENTIALS`.** Não existe estado "logado com
convite vencido": a credencial simplesmente deixa de valer, e a resposta é
idêntica à de senha errada, para não revelar quais e-mails têm convite. O caminho
de recuperação é o administrador reenviar.

**A troca de senha no primeiro acesso faz três coisas numa transação só:** grava
a senha definitiva, apaga a temporária e **ativa a conta**. Uma conta ativa que
ainda guardasse a temporária seria uma credencial viva que ninguém controla.

### 16.8 Envio do e-mail

| Implementação   | Quando é usada                                                       |
| --------------- | -------------------------------------------------------------------- |
| `LoggingMailer` | **Padrão**, quando `SMTP_HOST` está vazio: escreve a mensagem no log |
| `SmtpMailer`    | Quando `SMTP_HOST` está configurado                                  |

Trocar de um para o outro é **configuração, não reescrita**. É o que permite
demonstrar o fluxo completo do convite — criar conta, ler a senha temporária no
log, entrar, trocar a senha — em qualquer máquina, sem credencial de e-mail.

> ⚠️ **Em produção, `SMTP_HOST` é obrigatório.** Sem ele a aplicação **recusa
> subir**, a menos que `EMAIL_DISABLED=true` esteja definido.
>
> O motivo é o modo de falha mais traiçoeiro deste fluxo: sem SMTP **nada
> quebra**. O `LoggingMailer` escreve o convite no log, a criação da conta
> responde `201`, e o administrador conclui que a pessoa foi convidada — **e
> ninguém recebe nada**. Como o envio é de propósito tolerante a falha (servidor
> de e-mail fora do ar não pode impedir um cadastro), esse erro não apareceria em
> lugar nenhum. Falhar no deploy transforma o silêncio em mensagem clara, na hora
> certa. `EMAIL_DISABLED` existe para separar "esqueci de configurar" de "escolhi
> assim".

#### Variáveis de SMTP

| Variável         | Padrão                             | Observação                                            |
| ---------------- | ---------------------------------- | ----------------------------------------------------- |
| `SMTP_HOST`      | vazio                              | Vazio = log. **Obrigatório em produção.**             |
| `SMTP_PORT`      | `587`                              | Porta de submissão com STARTTLS                       |
| `SMTP_USER`      | vazio                              | Vazio = servidor sem autenticação (MailHog, Mailpit)  |
| `SMTP_PASSWORD`  | vazio                              | No Gmail, é a **senha de aplicativo**, não a da conta |
| `SMTP_FROM`      | `Logos <nao-responda@logos.local>` | Precisa ser aceito pelo servidor                      |
| `SMTP_USE_TLS`   | `true`                             | `false` só em servidor local                          |
| `EMAIL_DISABLED` | `false`                            | Assume o log em produção, de propósito                |
| `FRONTEND_URL`   | `http://localhost:5173`            | Alvo do botão "Definir minha senha"                   |

**Com Gmail:** ligue a verificação em duas etapas e gere uma **senha de
aplicativo** em `myaccount.google.com/apppasswords`. A senha normal da conta
**não funciona** em SMTP quando há 2FA. A senha de aplicativo tem 16 caracteres
(os espaços que o Google mostra são visuais) e pode ser revogada sem trocar a
senha da conta — é por isso que ela é a escolha certa aqui.

O `SMTP_FROM` precisa ser um endereço que o servidor aceite enviar: no Gmail, a
própria conta ou um alias verificado nela.

O e-mail de convite segue o desenho `Convite · e-mail`: assunto **"Sua conta no
Logos foi criada"**, o papel em português, a senha temporária em destaque, o
prazo, o botão **"Definir minha senha"** apontando para `FRONTEND_URL` e o aviso
para ignorar a mensagem caso o convite seja inesperado.

### 16.9 Códigos de erro desta seção

| Código                     | HTTP  | Quando                                            |
| -------------------------- | ----- | ------------------------------------------------- |
| `EMAIL_ALREADY_EXISTS`     | `409` | Já existe conta com o e-mail                      |
| `USER_NOT_FOUND`           | `404` | Identificador de conta inexistente                |
| `CANNOT_DEACTIVATE_SELF`   | `409` | Um administrador tentou desativar a própria conta |
| `PASSWORD_CHANGE_REQUIRED` | `403` | Sessão de primeiro acesso chamando rota comum     |

### 16.10 Sessões encerradas por corte de tempo

Desativar uma conta e trocar a senha gravam um instante de corte
(`sessions_valid_from`). Todo token emitido **antes** dele deixa de ser aceito.

Isso resolve dois casos que uma lista de tokens revogados não resolveria sem
guardar tudo que já foi emitido: desativar encerra as sessões na hora, e reativar
**não ressuscita** o token que existia antes do afastamento. Trocar a senha
encerra as outras sessões — inclusive a que fez a troca, e é por isso que a
interface deve pedir um novo login depois.

> **Detalhe que virou bug:** o `iat` do token era emitido como inteiro (segundos)
> e o corte é gravado com microssegundos. Um token emitido às `12:00:00.900`
> parecia anterior a um corte de `12:00:00.500`, e a pessoa que acabou de definir
> a senha não conseguia entrar. O `iat` passou a ser emitido com fração de
> segundo.

## 17. Frota de veículos

O case descreve uma transportadora com **5.000 caminhões em rota**. Sem a frota, o
formulário de incidente pediria a placa digitada de memória — e placa errada é um
registro que não serve para nada depois.

### 17.1 `GET /vehicles`

```
GET /api/v1/vehicles?q=ABC&limit=8
Authorization: Bearer <token>
```

| Parâmetro | Tipo   | Padrão | Limite   | Descrição                                  |
| --------- | ------ | ------ | -------- | ------------------------------------------ |
| `q`       | string | `""`   | 8 chars  | Prefixo da placa. Normalizado para maiúsculas. |
| `limit`   | int    | `8`    | 1 a 25   | Quantas sugestões devolver.                |

```json
{
  "items": [
    {
      "id": "0f2c7a10-…",
      "plate": "ABC1D23",
      "model": "Volvo FH 460",
      "carrier": "Transnorte Cargas"
    }
  ],
  "total": 5000
}
```

**A busca é por prefixo, e não por trecho.** `ABC` encontra `ABC1D23`, e `1D23`
não encontra nada. É o que a digitação faz: a pessoa começa pela placa, não pelo
meio dela.

**`LIKE` sensível a caixa sobre coluna que guarda tudo em maiúsculas** — é o que
permite ao índice ser aproveitado. Um `ILIKE` varreria as 5.000 linhas a cada
tecla.

**Os curingas são neutralizados no texto digitado.** O `escape=` do SQLAlchemy diz
*qual* caractere escapar; ele **não** escapa a entrada. Sem `escape_like`,
digitar `%` devolveria a frota inteira.

**Qualquer papel autenticado consulta a frota**, inclusive `REPORTER` — ele só tem
`CREATE_INCIDENT`, e é justamente quem digita a placa no formulário.

### 17.2 Por que o incidente não tem chave estrangeira para o veículo

Um incidente pode envolver caminhão de terceiro, que nunca estará na frota. E um
veículo vendido sai do cadastro enquanto o incidente que ele teve continua sendo
um fato. A frota **sugere**, não autoriza: placa fora da lista continua sendo
aceita, porque travar isso impediria registrar o que o operador de rádio viu.

### 17.3 A frota e o SSE em produção

`GET /incidents/stream` está implementado ([ADR 0011](adr/0011-sse.md)) e funciona
no ambiente local. **Em produção ele não funciona:** a arquitetura migrou para
Lambda com Function URL em modo `BUFFERED`
([ADR 0017](adr/0017-lambda-s3-cloudfront.md)), que não mantém a resposta aberta.
O front trata a ausência do stream e continua atualizando por consulta.

É o único ponto em que a arquitetura nova é pior que a anterior, e está declarado
aqui e no ADR em vez de escondido.
