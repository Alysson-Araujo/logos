# Changelog

Todas as mudanças relevantes deste projeto são registradas neste arquivo.

O formato segue o [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/) e o
versionamento segue o [Semantic Versioning](https://semver.org/lang/pt-BR/).

> **Estado atual:** nenhuma versão foi publicada ainda. Tudo abaixo está em
> `Unreleased` e será movido para uma seção versionada no momento da tag
> correspondente (`v0.1.0`, `v0.2.0`, `v1.0.0`), conforme a estratégia de
> releases descrita em [`docs/06-git-workflow.md`](docs/06-git-workflow.md).

---

## [Unreleased]

### Added

- Estrutura inicial do monorepo `logos` com os workspaces `backend/` e `frontend/`
  e a pasta `docs/` de documentação.
- Arquivos de higiene de repositório: `.gitignore`, `.gitattributes`
  (normalização de fim de linha com `eol=lf`, obrigatória no ambiente Windows
  deste projeto) e `.editorconfig`.
- Configuração de qualidade do backend: `pyproject.toml` com Ruff (lint +
  format) e mypy em modo `strict`, além da configuração do pytest com
  cobertura mínima.
- Configuração de qualidade do frontend: ESLint 9 (flat config) com
  `typescript-eslint` estrito, `eslint-plugin-jsx-a11y` e Prettier.
- Orquestração no root: `package.json` com scripts `dev`, `lint`, `format`,
  `typecheck`, `test`, `build` e o agregador `verify`, que roda exatamente o
  mesmo conjunto de verificações da integração contínua.
- Hooks de Git com Husky: `pre-commit` (lint-staged, formatando apenas o que
  mudou) e `commit-msg` (commitlint validando Conventional Commits).
- Pipeline de integração contínua em GitHub Actions (`ci.yml`) com os jobs
  `backend` (lint, types, testes), `frontend` (lint, types, testes, build) e
  `commits` (validação das mensagens de commit no PR).
- Templates de repositório: `bug_report.yml`, `feature_request.yml`, `task.yml`,
  `PULL_REQUEST_TEMPLATE.md` e `CODEOWNERS`.
- Arquivos de exemplo de variáveis de ambiente (`backend/.env.example` e
  `frontend/.env.example`), sem nenhum segredo real versionado.
- Documentação do projeto:
  - `README.md` raiz com problema, solução, os três pilares técnicos, stack,
    setup local, variáveis de ambiente, testes, deploy e roadmap.
  - `CONTRIBUTING.md` com o fluxo de contribuição e o Definition of Done.
  - `docs/01-visao-produto.md` — persona, jornada, dores e métricas de sucesso.
  - `docs/02-arquitetura.md` — diagramas C4 nível 2, camadas e fluxos.
  - `docs/03-api.md` — contrato da API, exemplos e catálogo de erros.
  - `docs/04-concorrencia-e-resiliencia.md` — lock otimista, idempotência,
    retry, circuit breaker e cache.
  - `docs/05-design-system.md` — tokens, acessibilidade e design da informação.
  - `docs/06-git-workflow.md` — branching, commits, PRs e proteção da `main`.
  - `docs/07-testes.md` — pirâmide de testes e estratégia de execução.
  - `docs/08-deploy.md` — deploy em Render + Vercel + Neon e troubleshooting.
  - `docs/09-escolhas-tecnicas.md` — o porquê de cada biblioteca escolhida.
  - `docs/adr/0001` a `docs/adr/0014` — os 14 registros de decisão de
    arquitetura do projeto.
- Licença MIT (`LICENSE`).

<!--
  Ao publicar a primeira versão, mova as entradas acima para a seção da tag e
  use a data real do release, por exemplo:

  ## [0.1.0] - AAAA-MM-DD

  ### Added
  - ...

  [Unreleased]: https://github.com/Alysson-Araujo/logos/compare/v0.1.0...HEAD
  [0.1.0]: https://github.com/Alysson-Araujo/logos/releases/tag/v0.1.0
-->

### Changed

- Nenhuma alteração registrada até o momento.

### Deprecated

- Nada depreciado até o momento.

### Removed

- Nada removido até o momento.

### Fixed

- Nada corrigido até o momento.

### Security

- Nenhum segredo é versionado: `.env` está no `.gitignore` e apenas os arquivos
  `.env.example` com valores fictícios entram no repositório.

---

## Tipos de mudança

| Seção        | Quando usar                                                |
| ------------ | ---------------------------------------------------------- |
| `Added`      | Funcionalidade nova.                                       |
| `Changed`    | Mudança em comportamento já existente.                     |
| `Deprecated` | Recurso ainda disponível, mas marcado para remoção.        |
| `Removed`    | Recurso removido.                                          |
| `Fixed`      | Correção de defeito.                                       |
| `Security`   | Correção de vulnerabilidade ou endurecimento de segurança. |

## Versionamento

O projeto usa SemVer (`MAJOR.MINOR.PATCH`) com as seguintes tags previstas:

| Tag      | Marco                                                            |
| -------- | ---------------------------------------------------------------- |
| `v0.1.0` | API publicada e funcional (backend no ar).                       |
| `v0.2.0` | Frontend integrado à API, com o fluxo de triagem completo.       |
| `v1.0.0` | Entrega final do case: documentação, testes e deploy acessíveis. |

Como o projeto ainda está em fase inicial (`0.x`), mudanças incompatíveis podem
ocorrer em versões `MINOR`. A partir de `v1.0.0` a política estrita do SemVer
passa a valer.
