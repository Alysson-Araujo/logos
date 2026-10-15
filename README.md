<div align="center">

# Logos

**Central de Resposta a Incidentes para operações logísticas: o caos de três planilhas e quatro grupos de WhatsApp vira uma fila priorizada em menos de cinco segundos.**

</div>

<!-- Badges: o slug do repositório é `Alysson-Araujo/logos`. Se o nome mudar, ajuste as URLs abaixo. -->

[![CI](https://github.com/Alysson-Araujo/logos/actions/workflows/ci.yml/badge.svg)](https://github.com/Alysson-Araujo/logos/actions/workflows/ci.yml)
[![Licença: MIT](https://img.shields.io/badge/licen%C3%A7a-MIT-blue.svg)](LICENSE)
[![Python 3.12](https://img.shields.io/badge/python-3.12-3776AB.svg?logo=python&logoColor=white)](https://www.python.org/)
[![Node 20+](https://img.shields.io/badge/node-%E2%89%A520-339933.svg?logo=nodejs&logoColor=white)](https://nodejs.org/)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

---

## Links rápidos

|                   |                                                                                                     |
| ----------------- | --------------------------------------------------------------------------------------------------- |
| **Demo ao vivo**  | _(a publicar)_ <!-- TODO-LINK: URL do frontend publicado na Vercel -->                              |
| **Vídeo (5 min)** | _(a publicar)_ <!-- TODO-LINK: URL pública do vídeo de demonstração -->                             |
| **Documentação**  | [`docs/`](docs/) — visão de produto, arquitetura, API, concorrência, design system, testes e deploy |
| **API (Swagger)** | _(a publicar)_ <!-- TODO-LINK: https://<servico>.onrender.com/docs -->                              |

---

## O problema

Uma transportadora com **5.000 caminhões em rota** opera hoje com a central de
resposta a incidentes apoiada em **quatro grupos de WhatsApp e três planilhas
compartilhadas**. Não existe uma fonte única da verdade: quando um incidente é
reportado pelo rádio, alguém cola a informação em um dos grupos, outra pessoa
transcreve para uma planilha, e o registro oficial passa a depender de quem
lembrou de atualizar o quê.

O efeito prático é que **não há priorização**. O pneu furado de um caminhão
vazio aparece lado a lado com o acidente com vítimas na mesma lista
cronológica. A analista da central decide a ordem de atendimento por leitura
sequencial, e a decisão correta depende de ela ter visto a mensagem certa no
grupo certo. Pior: dois analistas ligam para o mesmo motorista porque nenhum
dos dois sabe que o outro já assumiu o caso.

O custo disso é medido em horas de caminhão parado e em multa contratual por
SLA estourado. Um veículo parado em pista espera, em média, **horas** até que
alguém com autoridade perceba que aquele caso era prioritário — tempo em que
a carga atrasa, o cliente é notificado e a operação perde receita. Em uma
frota desse tamanho, cada incidente mal triado durante o dia se acumula em
**perda de milhões por ano**, sem que nenhuma linha de planilha registre a
causa raiz.

## A solução

O **Logos** substitui esse arranjo por uma única fila de incidentes, ordenada
por um _priority score_ determinístico calculado no servidor. A tela padrão já
responde à pergunta "o que está pegando fogo agora?" — a analista age somente
no que foge da normalidade, e todo o resto permanece visualmente silencioso.

Os incidentes são classificados em **5 categorias**, **3 níveis de
criticidade** e **4 estados de ciclo de vida**, todos validados no backend. O
status de cada caso é visível para toda a central, o que elimina a ligação
duplicada. Quando dois analistas agem sobre o mesmo incidente ao mesmo tempo,
o sistema **não deixa um sobrescrever o outro em silêncio**: a segunda tentativa
recebe `409 Conflict` com o estado atual do recurso e a interface mostra,
campo a campo, o que mudou.

<!--
  Prints da aplicação. Substituir os caminhos abaixo pelas capturas reais e
  remover as marcas de comentário quando os arquivos existirem em docs/assets/.
  São três telas: lista priorizada, drawer de detalhe e modal de conflito.

  ![Tela de triagem: lista de incidentes ordenada por prioridade](docs/assets/01-tela-de-triagem.png)

  ![Drawer de detalhe com status, SLA, transições permitidas e timeline](docs/assets/02-drawer-detalhe.png)

  ![Modal de conflito 409 mostrando o diff entre a tentativa e o estado no servidor](docs/assets/03-modal-conflito.png)
-->

| Tela                             | Arquivo previsto                     | Estado         |
| -------------------------------- | ------------------------------------ | -------------- |
| Lista priorizada (triagem)       | `docs/assets/01-tela-de-triagem.png` | _(a publicar)_ |
| Drawer de detalhe com timeline   | `docs/assets/02-drawer-detalhe.png`  | _(a publicar)_ |
| Modal de conflito `409` com diff | `docs/assets/03-modal-conflito.png`  | _(a publicar)_ |

## Funcionalidades

Situação real do repositório neste momento. O projeto está em fase inicial:
a fundação, a automação e a documentação estão prontas; o domínio e a
interface estão sendo construídos.

| Funcionalidade                                                                 | Status                |
| ------------------------------------------------------------------------------ | --------------------- |
| Estrutura do monorepo, workspaces e higiene de repositório                     | ✅ pronto             |
| Lint, formatação, tipagem e hooks de Git (`Ruff`, `mypy`, `ESLint`, `Husky`)   | ✅ pronto             |
| Integração contínua (lint, types, testes e build em cada PR)                   | ✅ pronto             |
| Documentação: 9 documentos temáticos + 14 ADRs                                 | ✅ pronto             |
| Modelo de domínio, enums e máquina de estados                                  | 🚧 em desenvolvimento |
| Cadastro de incidentes (5 categorias, 3 criticidades, 4 status)                | 🚧 em desenvolvimento |
| Listagem paginada por cursor com filtros combináveis                           | ⏳ planejado          |
| Transições de status validadas no servidor                                     | ⏳ planejado          |
| **Lock otimista** (`version` + `If-Match`) com `409` e payload do estado atual | ⏳ planejado          |
| **Idempotência** via `Idempotency-Key` nas mutações                            | ⏳ planejado          |
| **Priority score** determinístico, calculado e persistido no servidor          | ⏳ planejado          |
| SLA com contagem regressiva e alerta visual progressivo                        | ⏳ planejado          |
| Lista virtualizada (100+ incidentes) com modo compacto e confortável           | ⏳ planejado          |
| Filtros persistidos na URL (link compartilhável)                               | ⏳ planejado          |
| Busca textual com debounce e `keepPreviousData`                                | ⏳ planejado          |
| Modal de conflito `409` com diff campo a campo                                 | ⏳ planejado          |
| Resiliência: timeout, retry com jitter, circuit breaker e cache _stale_        | ⏳ planejado          |
| Estados de UI explícitos (loading, erro, vazio, offline, otimista)             | ⏳ planejado          |
| Tema claro/escuro persistido                                                   | ⏳ planejado          |
| Timeline de auditoria por incidente                                            | ⏳ planejado          |
| SSE com badge "N novos" sem reordenar a lista                                  | ⏳ planejado          |
| Command palette (`Ctrl+K`) e atalhos de teclado                                | ⏳ planejado          |
| Seed com 120 incidentes realistas para demonstração                            | ⏳ planejado          |
| Exportação CSV da visão filtrada                                               | ⏳ planejado          |
| Testes E2E com Playwright                                                      | ⏳ planejado          |

Legenda: ✅ pronto · 🚧 em desenvolvimento · ⏳ planejado.

## Decisões de arquitetura

Resumo das 14 decisões registradas. Cada uma tem um ADR completo em
[`docs/adr/`](docs/adr/) com contexto, alternativas descartadas e consequências.

| ADR                                                 | Decisão                                                         | Alternativa descartada                 |
| --------------------------------------------------- | --------------------------------------------------------------- | -------------------------------------- |
| [0001](docs/adr/0001-monorepo.md)                   | Monorepo `backend/` + `frontend/`                               | Dois repositórios                      |
| [0002](docs/adr/0002-fastapi.md)                    | FastAPI (Python 3.12)                                           | Flask, Django REST                     |
| [0003](docs/adr/0003-postgres-e-sqlite.md)          | SQLAlchemy 2.0 + Alembic, SQLite local / PostgreSQL em produção | JSON estruturado                       |
| [0004](docs/adr/0004-react-vite.md)                 | React 18 + TypeScript + Vite                                    | Next.js                                |
| [0005](docs/adr/0005-tanstack-query.md)             | TanStack Query para estado de servidor                          | Redux Toolkit, SWR                     |
| [0006](docs/adr/0006-zustand.md)                    | Zustand para estado de UI                                       | Context API puro                       |
| [0007](docs/adr/0007-tailwind-shadcn.md)            | Tailwind CSS + shadcn/ui (Radix)                                | MUI, Chakra                            |
| [0008](docs/adr/0008-optimistic-locking.md)         | Optimistic locking (`version`/ETag)                             | Pessimistic lock (`SELECT FOR UPDATE`) |
| [0009](docs/adr/0009-ruff-mypy.md)                  | Ruff + mypy no backend                                          | flake8 + black + isort                 |
| [0010](docs/adr/0010-cursor-pagination.md)          | Paginação por cursor                                            | Offset/limit                           |
| [0011](docs/adr/0011-sse.md)                        | SSE para tempo real                                             | WebSocket                              |
| [0012](docs/adr/0012-render-vercel-neon.md)         | Render + Vercel + Neon                                          | Hugging Face Spaces, Replit            |
| [0013](docs/adr/0013-priority-score-no-servidor.md) | Priority score no servidor                                      | Ordenar no cliente                     |
| [0014](docs/adr/0014-soft-delete.md)                | Soft delete                                                     | Hard delete                            |

## Os três pilares

O case não é sobre fazer um CRUD. É sobre garantir que o sistema **não corrompa
dados**, **não quebre sob falha** e **entregue a informação certa em segundos**.
Cada pilar tem uma decisão técnica concreta por trás.

### Pilar 1 — Integridade do ciclo de vida

Dois analistas abrem o mesmo incidente com `version = 3`. O analista A fecha o
caso. Oito segundos depois, o analista B — que ainda vê a tela antiga — tenta
marcar "em investigação" e, num sistema ingênuo, **apaga a resolução do colega
sem nunca saber**. Em logística, isso é um caminhão parado por horas e uma
justificativa impossível de reconstruir.

A solução não é código Python com `if`: é uma única instrução SQL em que a
comparação e a escrita são a mesma operação. Não existe janela de corrida
(TOCTOU), e o mecanismo é seguro mesmo com múltiplos _workers_ ou réplicas da
API.

```sql
UPDATE incidents
   SET status     = :new_status,
       version    = version + 1,
       updated_at = :now
 WHERE id         = :id
   AND version    = :expected_version   -- a linha inteira depende disto
   AND deleted_at IS NULL;
```

- `rowcount = 1` → sucesso. A resposta devolve a nova representação com `ETag: "4"`.
- `rowcount = 0` → **`409 Conflict`** com o estado **atual** do recurso no corpo,
  para a interface mostrar o diff campo a campo.

A versão esperada chega no cabeçalho `If-Match: "3"`, com _fallback_ para
`expectedVersion` no corpo. Detalhamento completo em
[`docs/04-concorrencia-e-resiliencia.md`](docs/04-concorrencia-e-resiliencia.md)
e no [ADR 0008](docs/adr/0008-optimistic-locking.md).

### Pilar 2 — Resiliência

A central opera com conexão oscilante e precisa **degradar com aviso**, não
quebrar. As camadas de defesa são: pool com `pool_pre_ping`, timeout de
statement, retry exponencial **com jitter**, circuit breaker com `503` e
`Retry-After`, cache com _stale-while-revalidate_ e rate limit por IP.

O jitter não é enfeite: quando o banco volta depois de uma indisponibilidade,
todos os clientes que estavam tentando reconectam no mesmo instante e derrubam
o banco de novo. Espalhar as tentativas resolve isso.

```python
def backoff_delay(attempt: int, *, base: float = 0.5, cap: float = 8.0) -> float:
    """Backoff exponencial com jitter completo.

    O jitter espalha as tentativas de todos os clientes que estavam
    bloqueados durante a mesma indisponibilidade, evitando que a
    reconexão simultânea derrube o banco outra vez (thundering herd).
    """
    ceiling = min(cap, base * (2 ** attempt))
    return random.uniform(0, ceiling)
```

O retry só se aplica a operações **idempotentes** e a falhas de infraestrutura
(`OperationalError`, `SerializationFailure`, `TimeoutError`). Um `PATCH` sem
`Idempotency-Key` **não é reexecutado cegamente** — se a falha puder ter
acontecido depois do `COMMIT`, reexecutar sobrescreveria uma decisão humana.
Nesse caso a API devolve `503` e deixa o cliente decidir. O raciocínio completo
está na seção "Por que não confiar em retry cego em `PATCH`" de
[`docs/04-concorrencia-e-resiliencia.md`](docs/04-concorrencia-e-resiliencia.md).

### Pilar 3 — Design da informação

O princípio é **gestão por exceção**: a tela padrão já responde "o que está
pegando fogo?". Tudo que é normal fica silencioso; a analista só age no que foge
da curva.

A peça central é o _priority score_ — inspirado em ITSM (`Prioridade = Impacto ×
Urgência`), determinístico e explicável. Ele é calculado e **persistido no
servidor**, para que dois analistas vejam exatamente a mesma ordem e para que a
ordenação seja testável e auditável.

```python
# score = impacto(categoria) + urgência(criticidade) + aging(tempo aberto) + pressão de SLA

IMPACTO = {
    "ACIDENTE_COM_VITIMAS": 300,
    "BLOQUEIO_DE_PISTA": 180,
    "ACIDENTE_COM_VEICULO": 150,
    "CONDICAO_CLIMATICA_ATIPICA": 100,
    "PROBLEMA_MECANICO": 60,
}
URGENCIA = {"ALTA": 500, "MEDIA": 250, "BAIXA": 80}

def priority_score(category: str, criticality: str,
                   hours_open: float, sla_due_in_minutes: float) -> int:
    aging = min(hours_open * 12, 400)          # teto: evita que todo caso vire ALTA
    sla_pressao = 200 if sla_due_in_minutes < 60 else 0
    return int(IMPACTO[category] + URGENCIA[criticality] + aging + sla_pressao)
```

O _aging_ faz um incidente antigo subir sozinho — o que era baixo vira alto se
ninguém olhar. A interface mostra o motivo em _tooltip_, termo a termo:
*"Prioridade 1.048 — Acidente com vítimas (300) + Alta (500) + 4h em aberto (48)

- SLA vencendo (200)"*. Explicabilidade gera confiança na fila. A criticidade é
  comunicada por **três canais redundantes** — cor, ícone e forma de borda — mais
  o rótulo textual, o que mantém a informação legível para pessoas daltônicas.
  Ver [`docs/05-design-system.md`](docs/05-design-system.md).

## Stack

| Camada             | Tecnologia                                     | Por que esta e não outra                                                                                                                                                                                                                                          |
| ------------------ | ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| API                | **FastAPI** + Pydantic v2                      | Validação declarativa e OpenAPI automático; `async` para I/O; é o "Python" pedido pelo briefing com o melhor custo/benefício. Flask exigiria montar validação e documentação à mão.                                                                               |
| Persistência       | **SQLAlchemy 2.0 + Alembic**                   | O lock otimista exige `UPDATE` condicional atômico, que um JSON estruturado não oferece de forma confiável. O versionamento de schema com Alembic é a issue #11 e ainda não está implementado — hoje o schema é criado por `Base.metadata.create_all` no startup. |
| Banco              | **PostgreSQL** local (container) e em produção | É o mesmo banco nos dois ambientes, então o comportamento de concorrência e os índices `GIN` são exercidos de verdade. O SQLite segue suportado como alternativa sem container, para rodar em qualquer máquina.                                                   |
| Frontend           | **React 18 + TypeScript `strict`**             | SPA que consome API. TypeScript estrito transforma o contrato da API em erro de compilação em vez de bug em produção.                                                                                                                                             |
| Build              | **Vite**                                       | Build quase instantâneo e HMR rápido. Next.js traria SSR desnecessário e acoplaria o deploy do front ao do back.                                                                                                                                                  |
| Estado de servidor | **TanStack Query**                             | Retry, cache, `staleTime`, `onMutate` otimista e rollback vêm de fábrica — são exatamente os critérios de resiliência. Redux seria boilerplate.                                                                                                                   |
| Estado de UI       | **Zustand**                                    | Tema, densidade e filtros efêmeros sem re-render global. Context sozinho faria a árvore inteira re-renderizar.                                                                                                                                                    |
| Estilo             | **Tailwind CSS**                               | Tokens controláveis e dark mode por classe, sem CSS morto.                                                                                                                                                                                                        |
| Componentes        | **shadcn/ui sobre Radix**                      | Acessibilidade (foco, teclado, ARIA) por padrão e o código no repositório, sem caixa preta.                                                                                                                                                                       |
| Lista              | **TanStack Virtual**                           | 100+ incidentes renderizando ~20 linhas, DOM estável e scroll fluido.                                                                                                                                                                                             |
| Contrato runtime   | **Zod**                                        | O front não confia cegamente no JSON: os schemas espelham o contrato e falham cedo.                                                                                                                                                                               |
| Testes             | **pytest** + **Vitest** + Playwright           | Um por nível da pirâmide, incluindo o teste de corrida com `ThreadPoolExecutor`.                                                                                                                                                                                  |
| Qualidade Python   | **Ruff + mypy `strict`**                       | Um binário que formata e faz lint, muito mais rápido que flake8 + black + isort; mypy garante que o contrato de tipos é real.                                                                                                                                     |
| Qualidade TS       | **ESLint 9 + Prettier**                        | Regras de hooks, `jsx-a11y` e `no-floating-promises` pegam bugs de UI antes do runtime.                                                                                                                                                                           |
| Automação          | **Husky + lint-staged + commitlint**           | Padrão de commit aplicado no `commit-msg`; formatação apenas do que mudou.                                                                                                                                                                                        |
| Deploy             | **Render + Vercel + Neon**                     | Free tier real, deploy via GitHub e Postgres gerenciado. Alternativas avaliadas no [ADR 0012](docs/adr/0012-render-vercel-neon.md).                                                                                                                               |

## Setup local

### Pré-requisitos

| Ferramenta | Versão | Verificação        |
| ---------- | ------ | ------------------ |
| Python     | 3.12   | `python --version` |
| Node.js    | 20+    | `node --version`   |
| pnpm       | 12     | `pnpm --version`   |
| Git        | 2.40+  | `git --version`    |

O banco de desenvolvimento é um **PostgreSQL em container**, subido com um
comando (`pnpm db:up`). Podman ou Docker é o único pré-requisito extra — e sem
ele o projeto também roda em SQLite, como explicado na seção de banco de dados.

### 1. Clonar e instalar dependências JavaScript

```bash
git clone https://github.com/Alysson-Araujo/logos.git
cd logos
pnpm install
```

### 2. Backend

```bash
python -m venv .venv
```

```bash
# Windows (PowerShell)
.venv\Scripts\Activate.ps1
```

```bash
# Linux / macOS
source .venv/bin/activate
```

```bash
pip install -e "backend[dev]"
cp backend/.env.example backend/.env      # no Windows: Copy-Item backend\.env.example backend\.env
```

```bash
cd backend
python -m app.infra.seed    # cria as tabelas e popula 120 incidentes de demonstração
uvicorn app.main:app --reload --port 8000
```

O schema não é criado por migração: a aplicação cria as tabelas no startup
(`Base.metadata.create_all`, em `backend/app/main.py`), e o próprio seed também
garante o schema antes de inserir. Migrações versionadas com **Alembic** são a
issue **#11** (`feat(db): configura Alembic e migracao inicial`, milestone
`M1 — Backend Core`) e **ainda não estão implementadas** — é por isso que este
passo não tem `alembic upgrade head`.

Verificação: `GET http://localhost:8000/health/ready` deve responder `200` e o
Swagger está em `http://localhost:8000/docs`.

### 3. Frontend

Em outro terminal, na raiz do repositório:

```bash
cp frontend/.env.example frontend/.env    # no Windows: Copy-Item frontend\.env.example frontend\.env
pnpm --filter web dev
```

Aplicação em `http://localhost:5173`.

### 4. Ou simplesmente os dois de uma vez

```bash
pnpm dev
```

Sobe API e frontend em paralelo, com reload nos dois lados.

### Banco de dados: PostgreSQL em container

O banco de desenvolvimento roda em container, para reproduzir o comportamento
real de concorrência e os índices `GIN` de busca textual que o SQLite não tem.

```bash
pnpm db:up        # sobe o PostgreSQL 16 (container logos-db)
pnpm seed         # cria as tabelas e popula os 120 incidentes
```

A porta exposta no host é a **5433**, e não a 5432, porque a 5432 costuma estar
ocupada por um PostgreSQL instalado nativamente. Dentro da rede do compose o
banco continua na 5432 — a mesma porta que a CI usa.

O `backend/.env` já vem apontando para ele:

```dotenv
DATABASE_URL=postgresql+psycopg://logos:logos@localhost:5433/logos
```

Outros comandos úteis:

```bash
pnpm db:logs      # acompanha os logs do banco
pnpm db:shell     # abre o psql dentro do container
pnpm db:reset     # derruba e recria o banco do zero
pnpm stack:up     # sobe banco E API em container (perfil full)
```

**Sem container?** Para rodar tudo em SQLite, use
`DATABASE_URL=sqlite:///./logos.db` no `backend/.env` — é o que a CI usa no job
principal, e o que `scripts/setup-local.ps1 -SkipDatabase` configura sozinho.

## Variáveis de ambiente

### Backend (`backend/.env`)

| Variável                  | Padrão                                                  | Descrição                                                                                                                                                           |
| ------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ENVIRONMENT`             | `development`                                           | `development`, `staging` ou `production`. Muda o nível de log e a política de CORS.                                                                                 |
| `DATABASE_URL`            | `postgresql+psycopg://logos:logos@localhost:5433/logos` | String de conexão SQLAlchemy. O padrão aponta para o container do `pnpm db:up`. Para rodar sem container: `sqlite:///./logos.db`. Em produção, `…?sslmode=require`. |
| `CORS_ORIGINS`            | `http://localhost:5173`                                 | Origens permitidas, separadas por vírgula. Nunca `*` em produção.                                                                                                   |
| `LOG_LEVEL`               | `INFO`                                                  | Nível do log estruturado em JSON.                                                                                                                                   |
| `RATE_LIMIT_PER_MINUTE`   | `60`                                                    | Teto de leitura por IP; escrita usa um limite menor.                                                                                                                |
| `DB_STATEMENT_TIMEOUT_MS` | `5000`                                                  | Timeout de statement no banco, para query não pendurar o worker.                                                                                                    |
| `RETRY_MAX_ATTEMPTS`      | `3`                                                     | Tentativas do retry interno com backoff e jitter.                                                                                                                   |
| `CACHE_TTL_SECONDS`       | `30`                                                    | TTL do cache da listagem com _stale-while-revalidate_.                                                                                                              |
| `SEED_ON_STARTUP`         | `true`                                                  | Popula dados de demonstração ao subir em ambiente de desenvolvimento.                                                                                               |

### Frontend (`frontend/.env`)

| Variável            | Padrão                         | Descrição                                                                             |
| ------------------- | ------------------------------ | ------------------------------------------------------------------------------------- |
| `VITE_API_BASE_URL` | `http://localhost:8000/api/v1` | Base da API consumida pelo cliente HTTP. Em produção aponta para o serviço no Render. |

Nenhum segredo é versionado. Apenas `.env.example`, com valores fictícios,
entra no repositório.

## Testes

```bash
pnpm test                                    # backend (pytest) + frontend (Vitest)
pnpm test:api                                # apenas backend
pnpm --filter web test:run                   # apenas frontend
cd backend && pytest tests/concurrency -v    # teste de corrida de status
```

Contra o PostgreSQL do container, em vez de SQLite (o banco `logos_test` é
criado uma vez com `podman exec logos-db psql -U logos -d logos -c "CREATE DATABASE logos_test;"`):

```bash
TEST_DATABASE_URL="postgresql+psycopg://logos:logos@localhost:5433/logos_test" pnpm test:api
```

| Nível                              | O que cobre                                                                                                                                                                                                                 |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unitário (`tests/unit`)            | Máquina de estados (`assert_transition_allowed`), cálculo do priority score por faixa, validadores de schema, normalização de placa.                                                                                        |
| Integração (`tests/integration`)   | Rotas completas, filtros combináveis, paginação por cursor, envelope de erro, `412`/`422`/`409`/`429`, soft delete e timeline de auditoria.                                                                                 |
| Concorrência (`tests/concurrency`) | **O teste que sustenta o Pilar 1**: dispara requisições simultâneas de mudança de status sobre o mesmo incidente com `ThreadPoolExecutor` e comprova que exatamente uma vence e as demais recebem `409` com o estado atual. |
| Frontend (Vitest)                  | Componentes de badge e status, `SlaTimer`, hooks de filtro, cliente HTTP (timeout, retry, `Idempotency-Key`) e o rollback otimista no conflito.                                                                             |

Cobertura mínima exigida no backend: **80%**, verificada na CI com
`--cov-fail-under=80`. No frontend ainda não há coleta de cobertura (o script
não existe em `frontend/package.json`); ela está planejada na issue **#60**
(`ci: adiciona cobertura, badge e checagem de bundle`, milestone
`M4 — Qualidade`).

A suíte roda em SQLite por padrão e **em PostgreSQL quando `TEST_DATABASE_URL`
está definida** — é exatamente o que o job `backend-postgres` da CI faz, e é
assim que o lock otimista é exercido sob concorrência real, e não apenas
descrito. A justificativa está em
[`docs/07-testes.md`](docs/07-testes.md).

## Deploy

Arquitetura de produção:

```mermaid
flowchart LR
    U["Navegador"] -->|HTTPS| V["Vercel<br/>React + Vite (estático)"]
    V -->|HTTPS + CORS| R["Render<br/>FastAPI (uvicorn)"]
    R -->|sslmode=require| N[("Neon<br/>PostgreSQL serverless")]
```

| Serviço  | Plataforma | Observação                                                           |
| -------- | ---------- | -------------------------------------------------------------------- |
| Frontend | Vercel     | Build do Vite; variável `VITE_API_BASE_URL`.                         |
| API      | Render     | `uvicorn app.main:app --host 0.0.0.0 --port $PORT`, raiz `backend/`. |
| Banco    | Neon       | PostgreSQL serverless; `DATABASE_URL` com `?sslmode=require`.        |

Reproduzir o deploy:

1. Criar o projeto no Neon e copiar a `DATABASE_URL` com `sslmode=require`.
2. No Render, criar um Web Service apontando para este repositório, com raiz
   `backend/`, build `pip install -e .` e start
   `uvicorn app.main:app --host 0.0.0.0 --port $PORT`.
3. Definir as variáveis de ambiente listadas acima (`ENVIRONMENT=production`,
   `CORS_ORIGINS` com a URL da Vercel, `DATABASE_URL` do Neon).
4. Subir a API uma vez para criar o schema (a aplicação cria as tabelas no
   startup) e rodar o seed no ambiente publicado. Migrações versionadas com
   Alembic são a issue **#11** — em produção real elas são pré-requisito, e é
   por isso que estão no milestone `M1 — Backend Core`.
5. Na Vercel, importar o repositório com raiz `frontend/`, framework Vite, e
   definir `VITE_API_BASE_URL`.
6. Voltar ao Render e ajustar `CORS_ORIGINS` com a URL real da Vercel.

O passo a passo detalhado, o caminho alternativo em AWS e os problemas reais
que aparecem nesse processo (cold start, CORS, SSL do Postgres, `$PORT`) estão
em [`docs/08-deploy.md`](docs/08-deploy.md).

## Estrutura de pastas

```
logos/
├── .github/
│   ├── workflows/
│   │   ├── ci.yml                    # lint + typecheck + testes + build (front e back)
│   │   └── cd.yml                    # deploy automático (Render + Vercel)
│   ├── ISSUE_TEMPLATE/               # bug_report, feature_request, task
│   ├── PULL_REQUEST_TEMPLATE.md
│   ├── CODEOWNERS
│   └── dependabot.yml
│
├── .husky/
│   ├── pre-commit                    # lint-staged (formata só o que mudou)
│   └── commit-msg                    # commitlint (Conventional Commits)
│
├── backend/
│   ├── app/
│   │   ├── main.py                   # app, middlewares, lifespan
│   │   ├── core/                     # config, database, logging, errors, security,
│   │   │                             # rate_limit, idempotency
│   │   ├── domain/                   # enums, entities, rules, priority
│   │   │                             # ↳ sem HTTP, sem ORM — testável isoladamente
│   │   ├── schemas/                  # contratos Pydantic (entrada e saída)
│   │   ├── repositories/             # SQL + CAS + paginação por cursor
│   │   ├── services/                 # regra de negócio e orquestração
│   │   ├── api/                      # deps, router e v1/{incidents,meta,health,stream}
│   │   ├── models/                   # ORM SQLAlchemy (incident, incident_event)
│   │   └── infra/                    # cache, retry, circuit_breaker, seed
│   ├── alembic/                      # planejado — issue #11 (env.py + versions/)
│   ├── tests/                        # unit/, integration/, concurrency/
│   ├── pyproject.toml                # deps + ruff + mypy + pytest + coverage
│   ├── .env.example
│   └── README.md
│
├── frontend/
│   ├── src/
│   │   ├── app/                      # App, providers (QueryClient, tema), rotas
│   │   ├── components/
│   │   │   ├── ui/                   # Button, Card, Dialog, Select, Badge
│   │   │   ├── layout/               # AppShell, Header, ThemeToggle
│   │   │   └── feedback/             # Skeletons, EmptyState, ErrorState, Toasts
│   │   ├── features/
│   │   │   ├── incidents/            # api, hooks, components, schemas (Zod), types
│   │   │   ├── dashboard/            # KPI cards
│   │   │   └── command-palette/      # Ctrl+K
│   │   ├── lib/                      # http.ts (timeout/retry/idempotência),
│   │   │                             # queryClient.ts, formatters.ts, utils.ts
│   │   ├── hooks/                    # useTheme, useDebounce, useOnlineStatus,
│   │   │                             # useKeyboardShortcuts, useMediaQuery
│   │   ├── styles/                   # globals.css, tokens.css (light + dark)
│   │   └── test/                     # setup, msw/handlers, factories
│   ├── e2e/                          # Playwright
│   ├── vite.config.ts
│   ├── tailwind.config.ts
│   ├── tsconfig.json
│   └── .env.example
│
├── docs/
│   ├── 01-visao-produto.md           # persona, jornada, dores, métricas
│   ├── 02-arquitetura.md             # C4, camadas, fluxos, ER, sequência
│   ├── 03-api.md                     # contrato, exemplos, catálogo de erros
│   ├── 04-concorrencia-e-resiliencia.md
│   ├── 05-design-system.md           # tokens, componentes, acessibilidade
│   ├── 06-git-workflow.md
│   ├── 07-testes.md
│   ├── 08-deploy.md
│   ├── 09-escolhas-tecnicas.md
│   ├── adr/                          # 14 registros de decisão de arquitetura
│   └── assets/                       # prints, gifs e diagramas
│
├── commitlint.config.cjs
├── package.json                      # scripts orquestradores, husky, lint-staged
├── pnpm-workspace.yaml
├── CONTRIBUTING.md
├── CHANGELOG.md
├── LICENSE
└── README.md
```

## Fora de escopo e roadmap

### O que ficou deliberadamente fora

Estas exclusões são decisões, não esquecimentos. O briefing não as pede e
incluí-las adicionaria superfície sem aprofundar o que está sendo avaliado.

| Fora de escopo                                     | Motivo                                                                                                                         |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Autenticação real, SSO e RBAC multiusuário         | Não está no escopo do case. O autor da ação é simulado por um `analyst_name` no header, com o caminho de evolução documentado. |
| Rastreamento GPS em tempo real dos 5.000 caminhões | É um produto de telemetria, não de triagem de incidentes.                                                                      |
| Notificações push, SMS ou WhatsApp                 | Dependem de integrações de terceiros e credenciais que o case não fornece.                                                     |
| Multi-tenant / multi-cliente                       | Exigiria modelagem de isolamento que desviaria o foco da concorrência e do design da informação.                               |
| Migração de dados legados das planilhas            | Sem acesso ao formato real dos dados de origem.                                                                                |

### Roadmap — o que faria com mais tempo

1. **Autenticação e autoria real.** Trocar o `analyst_name` por um provedor de
   identidade e tornar `assigned_analyst` uma chave estrangeira, habilitando
   RBAC por região e visão de "meus casos".
2. **Fila offline completa no cliente.** Mutações que falham por rede vão para
   uma fila em `localStorage` e são reenviadas quando a conexão volta, com
   reconciliação explícita de conflitos acumulados.
3. **Elasticsearch ou `pg_trgm` para busca.** O `GIN` sobre `title`/`description`
   resolve a busca do MVP; com histórico longo, um índice trigram melhora o
   ranking por relevância.
4. **Observabilidade.** Métricas de TTT, TTA, taxa de `409` e latência p95
   expostas em `/metrics`, com painel de acompanhamento da central.
5. **Reincidência e correlação.** Detectar automaticamente incidentes no mesmo
   trecho de rodovia em uma janela de tempo e sugerir agrupamento.
6. **Exportação e relatórios contratuais.** Exportação CSV e PDF por período
   para comprovação de SLA junto ao cliente.
7. **Testes de carga.** Um cenário sustentado com múltiplas réplicas da API
   para validar o comportamento do pool e do circuit breaker sob pressão real.

## Autor

**Alysson Araújo**

- E-mail: [alysson10araujo@gmail.com](mailto:alysson10araujo@gmail.com)
- LinkedIn: _(a publicar)_ <!-- TODO-LINK: URL do perfil no LinkedIn -->
- Repositório: [github.com/Alysson-Araujo/logos](https://github.com/Alysson-Araujo/logos)

---

<div align="center">

Projeto desenvolvido como case prático de Desenvolvedor Fullstack · AutoU · 2026
Distribuído sob a licença [MIT](LICENSE).

</div>
