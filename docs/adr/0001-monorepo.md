# ADR 0001 — Monorepo com `backend/` e `frontend/`

- **Status:** Aceito
- **Data:** 2026-02-11
- **Contexto relacionado:** E0 — Fundação (issue #1, `chore/1-monorepo`)

## Contexto

O case é avaliado como um produto único: a API em Python e a interface em React só existem juntas. As decisões centrais atravessam a fronteira entre os dois lados — o lock otimista exige que o frontend envie `If-Match` e trate `409` com rollback, e o envelope de erro exige que o cliente interprete `error.code`. Ao mesmo tempo, são duas aplicações com runtimes e gerenciadores distintos (Python e Node) e dois deploys independentes.

## Decisão

Um único repositório, `Alysson-Araujo/logos`, com `backend/` (FastAPI, SQLAlchemy), `frontend/` (React, Vite) e `docs/` (documentação temática e ADRs). O gerenciamento JavaScript usa `pnpm` workspaces na raiz, que orquestra `pnpm dev` e `pnpm verify`; o backend mantém `pyproject.toml` e ambiente virtual próprios, sem misturar os dois gerenciadores no mesmo arquivo.

## Alternativas consideradas

- **Dois repositórios (`logos-api` e `logos-web`).** Descartado: a mudança de contrato mais importante do projeto — a introdução do lock otimista — toca os dois lados na mesma unidade lógica e viraria dois PRs coordenados, com as branches `main` incompatíveis entre os merges. Também obrigaria quem avalia a navegar entre dois repositórios para entender um produto.
- **Monorepo com ferramenta de orquestração (Nx, Turborepo, Bazel).** Descartado: complexidade de configuração que não se paga com dois pacotes e um único desenvolvedor.
- **Backend e frontend na mesma pasta, sem separação.** Descartado: `pyproject.toml` e `package.json` no mesmo nível tornariam ambíguo o *root directory* de cada serviço no deploy.
- **Frontend consumindo a API por pacote publicado.** Descartado: adicionaria versionamento de pacote interno para um projeto em que o contrato muda toda semana.

## Consequências

### Positivas

- Um PR atômico altera contrato, API e interface na mesma revisão, com CI validando os dois lados.
- O sistema inteiro — incluindo `docs/` com os ADRs — é legível em um único clone.
- A raiz expõe `pnpm verify` como o comando único que roda exatamente o que a CI roda.

### Negativas / trade-offs

- O clone traz as duas stacks; `pnpm dev:api` e `pnpm dev:web` permitem subir cada lado isoladamente.
- A CI precisa de dois *jobs* com ambientes distintos, o que aumenta o tempo total do pipeline.
- O repositório concentra o histórico de duas aplicações, com controle de acesso uniforme entre elas.
