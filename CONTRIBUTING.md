# Contribuindo com o Logos

Guia de contribuição do **Logos**: como preparar o ambiente, o fluxo de branch,
o padrão de commit, o que é exigido antes de abrir um pull request e o critério
de conclusão de uma tarefa.

> Este é um projeto de case avaliado por processo. O histórico de commits, a
> granularidade das mudanças e a clareza das mensagens **fazem parte do
> entregável** — não são detalhe cosmético.

---

## 1. Pré-requisitos

| Ferramenta | Versão | Observação                                         |
| ---------- | ------ | -------------------------------------------------- |
| Python     | 3.12   | Backend (FastAPI + SQLAlchemy 2.0).                |
| Node.js    | 20+    | Frontend (React + Vite).                           |
| pnpm       | 12     | Gerenciador de pacotes e orquestração do monorepo. |
| Git        | 2.40+  | Fluxo trunk-based com branches curtas.             |

Podman ou Docker são **opcionais**: o backend sobe com SQLite e nenhum
container é necessário para desenvolver. Um PostgreSQL local só é necessário
para validar o comportamento de concorrência contra o banco de produção.

---

## 2. Rodando o projeto

### 2.1 Setup completo (recomendado)

```bash
# 1. Clone e entre no repositório
git clone https://github.com/Alysson-Araujo/logos.git
cd logos

# 2. Backend
python -m venv .venv
.venv\Scripts\activate          # Windows
# source .venv/bin/activate     # Linux/macOS
pip install -e "backend[dev]"
cp backend/.env.example backend/.env

# 3. Frontend
pnpm install
cp frontend/.env.example frontend/.env

# 4. Schema + dados de demonstração
cd backend
alembic upgrade head            # cria o schema a partir das migrações
python -m app.infra.seed        # popula os incidentes de demonstração
cd ..

# 5. Subir API e web juntos
pnpm dev
```

> O schema é versionado pelo **Alembic**; a aplicação não cria tabelas. Ao
> alterar um modelo, gere a migração correspondente e revise o arquivo antes de
> commitar:
>
> ```bash
> cd backend && alembic revision --autogenerate -m "descricao da mudanca"
> ```
>
> A CI roda `alembic upgrade head` e `alembic check`, então um modelo alterado
> sem migração correspondente **reprova o pull request**.

Serviços esperados após o `pnpm dev`:

| Serviço         | URL padrão                   |
| --------------- | ---------------------------- |
| API (FastAPI)   | `http://localhost:8000`      |
| Swagger UI      | `http://localhost:8000/docs` |
| Frontend (Vite) | `http://localhost:5173`      |

### 2.2 Comandos do dia a dia

| Comando          | O que faz                                                      |
| ---------------- | -------------------------------------------------------------- |
| `pnpm dev`       | Sobe API e frontend em paralelo, com reload.                   |
| `pnpm dev:api`   | Sobe apenas a API.                                             |
| `pnpm dev:web`   | Sobe apenas o frontend.                                        |
| `pnpm seed`      | Repopula o banco com os incidentes de demonstração.            |
| `pnpm lint`      | Ruff no backend e ESLint no frontend.                          |
| `pnpm format`    | Formata os dois lados (Ruff format e Prettier).                |
| `pnpm typecheck` | mypy no backend e `tsc --noEmit` no frontend.                  |
| `pnpm test`      | pytest no backend e Vitest no frontend.                        |
| `pnpm build`     | Build de produção do frontend.                                 |
| `pnpm verify`    | **Lint + typecheck + testes + build.** É o portão antes do PR. |
| `pnpm commit`    | Assistente interativo de Conventional Commits.                 |

> `pnpm verify` roda exatamente o mesmo conjunto de verificações que a
> integração contínua executa. Rodar antes de abrir o PR é o hábito que evita
> pull request vermelho.

### 2.3 Banco de dados em container

O banco de desenvolvimento é um PostgreSQL, subido pelo `compose.yaml` da raiz
do projeto:

```bash
pnpm db:up        # sobe o container logos-db
pnpm seed         # cria as tabelas e popula os dados de demonstração
```

A porta exposta no host é a **5433**, e não a 5432, porque a 5432 costuma estar
ocupada por um PostgreSQL instalado nativamente. Dentro da rede do compose o
banco continua na 5432, como na CI. O `backend/.env` já aponta para
`localhost:5433`.

Para rodar a suíte contra esse banco, e não contra SQLite:

```powershell
cd backend
$env:TEST_DATABASE_URL = "postgresql+psycopg://logos:logos@localhost:5433/logos_test"
python -m pytest -q
```

```bash
cd backend
TEST_DATABASE_URL="postgresql+psycopg://logos:logos@localhost:5433/logos_test" python -m pytest -q
```

O banco de teste é criado uma vez, com:
`podman exec logos-db psql -U logos -d logos -c "CREATE DATABASE logos_test;"`.

**Sem Podman?** Use `DATABASE_URL=sqlite:///./logos.db` no `backend/.env`. A
suíte roda em SQLite automaticamente quando `TEST_DATABASE_URL` não está
definida.

---

## 3. Fluxo de branch

O projeto usa **trunk-based development** com branches curtas (horas a 2 dias).
`main` está sempre verde e sempre implantável.

```
main ──●──●──────────●──────────●──────►
        \            /          /
         feat/20-…  ┘  fix/31-…┘
```

### 3.1 Nomenclatura

```
<tipo>/<numero-da-issue>-<slug-curto-em-kebab-case>
```

| Prefixo     | Uso                                    | Exemplo                                |
| ----------- | -------------------------------------- | -------------------------------------- |
| `feat/`     | Nova funcionalidade                    | `feat/20-optimistic-lock`              |
| `fix/`      | Correção de defeito                    | `fix/31-cursor-pagination-off-by-one`  |
| `refactor/` | Reestruturação sem mudar comportamento | `refactor/22-extract-priority-service` |
| `test/`     | Apenas testes                          | `test/26-concurrency-test`             |
| `docs/`     | Apenas documentação                    | `docs/70-adrs`                         |
| `chore/`    | Build, dependências, configuração      | `chore/3-husky`                        |
| `perf/`     | Performance                            | `perf/43-virtual-list`                 |

### 3.2 Regras

- **Uma issue por branch.** Uma branch, um PR, um objetivo.
- **Nunca faça push direto na `main`.** A branch é protegida.
- Crie a branch a partir de `main` atualizada: `git switch -c feat/20-optimistic-lock main`.
- Rebase em `main` em vez de merge, para manter o histórico linear.
- Branches são apagadas após o merge.

---

## 4. Padrão de commit

O projeto segue **Conventional Commits**. O hook `commit-msg` valida cada
mensagem com `commitlint`; mensagem fora do padrão é rejeitada localmente.

### 4.1 Formato

```
<tipo>(<escopo>): <descrição no imperativo, minúscula, sem ponto final>

<corpo: o PORQUÊ da mudança, não o "o quê">
<quebra de linha a cada 72 colunas>

<footer: refs, breaking changes>
```

### 4.2 Tipos permitidos

`feat` · `fix` · `docs` · `style` · `refactor` · `perf` · `test` · `build` ·
`ci` · `chore` · `revert`

### 4.3 Escopos permitidos

`api` · `web` · `db` · `ux` · `ci` · `docs` · `deps` · `infra` · `release`

### 4.4 Limites impostos pela configuração

| Regra                                | Valor                                           |
| ------------------------------------ | ----------------------------------------------- |
| Comprimento máximo do cabeçalho      | 72 caracteres                                   |
| Comprimento máximo da linha do corpo | 100 caracteres                                  |
| `subject-case`                       | Não pode começar em maiúscula nem em PascalCase |

### 4.5 Exemplos reais

```
feat(api): adiciona lock otimista na transição de status

Dois analistas podiam sobrescrever o mesmo incidente quando abriam a
tela antes de o colega salvar. A comparação e a escrita passam a ser
uma única instrução UPDATE ... WHERE version = :expected, eliminando
a janela de corrida (TOCTOU) mesmo com múltiplos workers.

Refs #18
```

```
fix(web): impede reordenação da lista ao chegar evento via SSE

A lista reordenava embaixo do cursor do analista e causava clique no
incidente errado. Novos eventos passam a alimentar um contador e a
lista só reordena sob ação explícita.

Closes #35
```

```
perf(web): virtualiza a lista de incidentes

Com 100+ itens o DOM mantinha mais de 3.000 nós e o scroll engasgava.
A virtualização reduz para ~20 linhas montadas e mantém 60fps.

Refs #29
```

### 4.6 Granularidade dentro do PR

Um commit por unidade lógica coerente. Ao construir uma funcionalidade de
backend, por exemplo: schema → repositório → service → rota → teste →
documentação. Isso mostra o processo de construção, que é um critério de
avaliação explícito.

O merge é feito com **Squash and merge**, e o título do PR já é a mensagem
Conventional Commit — o corpo do squash preserva o histórico de commits da
branch.

### 4.7 O que não fazer

- `git commit -m "wip"`, `"ajustes"`, `"correções"`, `"case"`.
- Um único commit gigante com tudo dentro.
- `--amend` em massa no final para "arrumar" o histórico.
- Commits retroativos: o histórico deve refletir o desenvolvimento real.

---

## 5. Definition of Done

Nenhuma issue é fechada antes de todos os itens abaixo estarem satisfeitos.

- [ ] Código formatado (`pnpm format`) e sem aviso de lint
- [ ] `pnpm typecheck` limpo (sem `any` novo)
- [ ] Testes escritos/atualizados e verdes (`pnpm test`)
- [ ] Cobertura não caiu (mín. 80% no backend)
- [ ] Tratamento de erro e estado de UI implementados (loading/erro/vazio)
- [ ] Sem `console.log`, `print()` ou código comentado
- [ ] Documentação/ADR atualizado se a decisão mudou
- [ ] `.env.example` atualizado se nova variável
- [ ] PR com `Closes #N`, CI verde, descrição explicando o _porquê_
- [ ] Print/GIF anexado se alterou interface

---

## 6. Abrindo um pull request

### 6.1 Antes de abrir

```bash
git fetch origin
git rebase origin/main
pnpm verify
```

Ambos precisam passar sem erro. Se algo falhar, corrija antes de abrir o PR.

### 6.2 Criando o PR

```bash
git push -u origin feat/20-optimistic-lock
gh pr create --base main --fill
```

O título do PR deve ser uma mensagem Conventional Commit válida, porque ele se
torna a mensagem do squash na `main`. O corpo deve conter `Closes #N`.

### 6.3 O que o template exige

O template de pull request do repositório solicita, obrigatoriamente:

| Item                 | Detalhe                                                               |
| -------------------- | --------------------------------------------------------------------- |
| **Issue vinculada**  | `Closes #N` no corpo.                                                 |
| **O porquê**         | Duas a três frases explicando o motivo da mudança, não o que ela faz. |
| **Como testar**      | Passos objetivos para quem revisa reproduzir.                         |
| **Evidência de UI**  | Print ou GIF sempre que a interface mudar.                            |
| **Checklist de DoD** | Os dez itens da seção 5, marcados.                                    |
| **Tipo de mudança**  | Feature, correção, refatoração, documentação ou infraestrutura.       |

### 6.4 Após abrir

1. Aguarde a CI ficar verde (`backend`, `frontend` e `commits`).
2. Faça o self-review no diff completo, como se fosse revisar código de outra pessoa.
3. Resolva todas as conversas de review antes do merge.
4. Merge com **Squash and merge**.
5. Apague a branch e confirme que a issue foi fechada.

---

## 7. Estrutura do código

O projeto é um monorepo com duas aplicações e fronteiras de camada explícitas.

```
logos/
├── backend/app/
│   ├── api/           # Rotas HTTP — não contém regra de negócio
│   ├── services/      # Regra de negócio e orquestração
│   ├── domain/        # Regras puras: sem HTTP, sem ORM
│   ├── repositories/  # Acesso a dados (SQL + CAS)
│   ├── models/        # ORM SQLAlchemy
│   ├── schemas/       # Contratos Pydantic
│   ├── infra/         # Cache, retry, circuit breaker, seed
│   └── core/          # Config, banco, logs, erros, segurança
├── frontend/src/
│   ├── app/           # Providers, rotas, shell
│   ├── components/    # UI, layout, feedback
│   ├── features/      # Domínio do front (incidents, dashboard, palette)
│   ├── lib/           # HTTP, query client, formatadores
│   └── hooks/         # Hooks reutilizáveis
└── docs/              # Documentação temática + ADRs
```

### 7.1 Regras de camada (não negociáveis)

- **O domínio não conhece HTTP nem ORM.** `app/domain/` contém apenas regras
  puras e tipos; é testável sem banco e sem servidor.
- **A rota não contém regra de negócio.** Ela valida entrada, chama o service e
  serializa a saída.
- **Nada de `SELECT` + `if` + `UPDATE`.** Toda atualização condicional usa
  compare-and-swap em uma única instrução SQL no repositório (ver
  [`docs/04-concorrencia-e-resiliencia.md`](docs/04-concorrencia-e-resiliencia.md)).
- **Tipos do contrato são espelhados no frontend** (`features/incidents/types.ts`)
  e validados em runtime com Zod — o front não confia cegamente no JSON.

---

## 8. Testes

Antes de pedir revisão, o mínimo esperado é:

| Nível        | O que deve estar coberto                                               |
| ------------ | ---------------------------------------------------------------------- |
| Unitário     | Regras de transição de status, cálculo do priority score, validadores. |
| Integração   | Rotas, filtros, paginação por cursor, envelopes de erro.               |
| Concorrência | Corrida de status com `ThreadPoolExecutor` provando o `409`.           |
| Frontend     | Componentes e hooks críticos com Vitest.                               |

```bash
pnpm test:api                        # pytest no backend
pnpm --filter web test:run           # Vitest no frontend
cd backend && pytest tests/concurrency -v   # teste de corrida
```

Detalhes da estratégia em [`docs/07-testes.md`](docs/07-testes.md).

---

## 9. Dúvidas e decisões

- Antes de propor uma mudança estrutural, verifique se ela já foi decidida em
  [`docs/adr/`](docs/adr/). Se a decisão mudou, o ADR correspondente deve ser
  atualizado no mesmo PR.
- Toda dependência nova precisa de justificativa no corpo do PR: o que resolve,
  qual era a alternativa e qual trade-off está sendo aceito.
