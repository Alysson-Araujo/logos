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
- **Idempotência das mutações** (`Idempotency-Key`): reserva atômica garantida
  pela chave primária, replay da resposta original e `Idempotency-Replayed` no
  reenvio (#22).
- **Limitação de taxa** por cliente com janela deslizante e cotas separadas de
  leitura e escrita, com `429` e `Retry-After` (#33).
- **Retentativa** de falhas transitórias de banco com backoff exponencial
  (1 s, 2 s, 4 s) e jitter completo, restrita a operações repetíveis (#27).
- **Disjuntor de banco** (`CLOSED`/`OPEN`/`HALF_OPEN`) com uma sondagem por vez,
  respondendo `503` com `Retry-After` sem tocar no banco (#29).
- **Timeout de conexão** de 5 s no engine PostgreSQL (#29).
- **Cache da listagem** com _stale-while-revalidate_, exposto em
  `X-Cache-Status`, que mantém a lista na tela durante uma degradação (#30).
- **Timeouts de sessão no PostgreSQL**: `statement_timeout` (teto por consulta) e
  `idle_in_transaction_session_timeout` (teto com a transação ociosa), aplicados
  como opção de servidor para valerem desde a primeira consulta (#28).
- **Timeline de auditoria** (`GET /incidents/{id}/events`): eventos `CREATED`,
  `STATUS_CHANGED` e `DELETED` gravados na mesma transação da mudança que
  descrevem, com autor, status de origem e destino (#24).
- **Autenticação e autorização**: `POST /auth/login` com JWT de TTL curto, os
  papéis `REPORTER`, `ANALYST` e `ADMIN`, e a matriz de permissões centralizada
  em `app/domain/permissions.py` ([ADR 0015](docs/adr/0015-autenticacao-jwt.md)).
- **Administração de contas**: convite por e-mail com senha temporária, reenvio,
  ativação e desativação, e troca obrigatória de senha no primeiro acesso
  (`GET/POST/PATCH /users`, §16 de `docs/03-api.md`).
- **Frota de veículos**: tabela `vehicles` com 5.000 placas fictícias no padrão
  Mercosul (migration `0005`), `GET /vehicles?q=` com busca por prefixo e
  `escape_like` neutralizando os curingas do `LIKE`.
- **Sessão no `sessionStorage`**, e não em cookie ou `localStorage`
  ([ADR 0016](docs/adr/0016-sessao-no-sessionstorage.md)).

#### Frontend

- **Tela de triagem**: barra de filtros com busca e debounce, KPIs por status,
  lista virtualizada (`@tanstack/react-virtual`) e _drawer_ de detalhe.
- **Formulário de novo incidente** validado com Zod, com sugestão de placas da
  frota e de locais já usados em incidentes anteriores.
- **Sugestões de local** no campo Local: reusa `GET /incidents?search=`, então o
  recorte por papel vem do backend sem código novo no front. A proteção contra
  resposta fora de ordem é a chave de cache por termo, e não um `AbortController`.
- **Componente `Combobox`** construído à mão: o Radix não tem combobox, e o
  `Select` não serve porque o campo aceita valor fora da lista. Segue o padrão
  ARIA de combobox, com `aria-activedescendant` e o foco sempre no input.
- **Faixas de prioridade** (`▲ Crítica`, `◆ Alta`, `● Média`, `○ Baixa`) com
  tokens próprios e borda lateral colorida, para que a prioridade seja lida de
  relance em vez de comparada como número.
- **Diálogo de conflito** com diff campo a campo, e mutação otimista na mudança
  de status ([ADR 0008](docs/adr/0008-optimistic-locking.md)).
- **Tela de contas de acesso** para o papel `ADMIN`, com convite, reenvio e
  ativação — responsiva por CSS, sem duplicar o DOM.
- **API simulada com MSW**, que mantém a demonstração utilizável sem backend.
- `docs/10-registro-de-execucao.md`: registro do que foi construído, com o
  raciocínio e a evidência de cada decisão.
- **Deploy na AWS** ([ADR 0017](docs/adr/0017-lambda-s3-cloudfront.md)):
  S3 + CloudFront no front, Lambda com Function URL na API, Neon mantido como
  banco. Custo medido de **US$ 0,023/mês**, com o único item cobrado sendo o
  armazenamento da imagem no ECR.
- **Deploy contínuo por OIDC**: cada merge na `main` publica os dois lados sem
  nenhuma credencial AWS de longa duração no repositório. A confiança da role é
  restrita a `repo:…:ref:refs/heads/main`.
- **Aviso automático de deploy quebrado**: em falha, o workflow abre uma issue e
  reaproveita a aberta enquanto ela existir.
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
  - `docs/08-deploy.md` — arquitetura de produção, passo a passo e
    troubleshooting. A Onda 1 (Render + Vercel) permanece como registro
    histórico.
  - `docs/09-escolhas-tecnicas.md` — o porquê de cada biblioteca escolhida.
  - `docs/11-autenticacao-frontend.md` — sessão, guarda de rota e renovação.
  - `docs/12-deploy-aws.md` — recursos, custo medido, automação por OIDC e
    limites conhecidos da arquitetura em uso.
  - `docs/adr/0001` a `docs/adr/0017` — os 17 registros de decisão de
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

- O schema passou a ser criado **exclusivamente** por migrações do Alembic:
  `create_all` foi removido e a aplicação falha com instrução explícita quando a
  migração não foi aplicada (#11).
- O PostgreSQL de desenvolvimento passou a rodar em container, na porta 5433,
  para não disputar a porta com um servidor nativo (#88).
- **A plataforma de produção passou de Render + Vercel para AWS**
  ([ADR 0017](docs/adr/0017-lambda-s3-cloudfront.md)), substituindo o
  [ADR 0012](docs/adr/0012-render-vercel-neon.md). O Neon continua sendo o banco.
- **A borda lateral da linha da triagem passou a codificar a prioridade**, e não
  a criticidade: é a prioridade que ordena a fila, e a borda é o canal lido na
  periferia. A criticidade permanece no selo, com cor, forma e rótulo.
- **O domínio das contas de demonstração passou de `autou.com.br` para
  `demo.example.com`**, subdomínio reservado pela RFC 2606. O convite sai por
  SMTP de verdade, e uma conta de demonstração no domínio de terceiro entregaria
  credencial na caixa de entrada de um estranho.

### Deprecated

- Nada depreciado até o momento.

### Removed

- Nada removido até o momento.

### Fixed

- O CORS não anunciava `PATCH` nem `PUT`, então um preflight do navegador
  bloquearia qualquer cliente que usasse esses métodos (#22).
- A chave de idempotência ficava presa em `in_progress` quando o handler subia
  exceção, impedindo o cliente de corrigir o pedido e tentar de novo (#22).
- O `conftest` sobrescrevia a URL do banco, fazendo o job de PostgreSQL do CI
  testar SQLite — um falso positivo que escondia incompatibilidades (#90).
- **`GET /vehicles?q=%` devolvia a frota inteira.** O parâmetro `escape=` do
  SQLAlchemy diz *qual* caractere escapar; ele não escapa a entrada digitada.
  Curingas passaram a ser neutralizados por `escape_like`, com a barra invertida
  tratada primeiro.
- **A Function URL devolvia `403` enquanto `aws lambda invoke` devolvia `200`.**
  Desde outubro de 2025, Function URLs exigem `lambda:InvokeFunctionUrl` **e**
  `lambda:InvokeFunction`; criar a URL só adiciona a primeira.
- **O deploy falhou quatro vezes seguidas sem ninguém ver.** A confiança OIDC
  exigia casamento literal do claim `sub`, e o GitHub passou a incluí-lo com os
  IDs de dono e repositório. O workflow também ganhou o job que abre issue em
  falha — o erro existia e não tinha onde aparecer.
- **A tabela de contas era ilegível no celular.** Passou a virar blocos abaixo de
  768 px por CSS, e não por uma segunda árvore de elementos: duplicar o DOM
  tornaria ambígua toda consulta por texto, nos testes e para leitor de tela.
- **O `Esc` fechava o formulário inteiro** em vez de apenas a lista de sugestões.
  O Radix escuta `Escape` no documento em fase de captura; a solução é um
  listener de captura registrado antes de qualquer diálogo montar.
- **O `Combobox` forçava caixa alta**, correto para placa e errado para local.
  O comportamento virou a prop `uppercase`, ligada só onde o valor é código.

### Security

- Nenhum segredo é versionado: `.env` está no `.gitignore` e apenas os arquivos
  `.env.example` com valores fictícios entram no repositório.
- Cabeçalhos de segurança em toda resposta — `X-Content-Type-Options`,
  `Referrer-Policy`, `X-Frame-Options`, `Permissions-Policy` e HSTS em produção
  (#33).
- `/health/live` e `/health/ready` não consomem cota de requisições: recusar o
  healthcheck faria a plataforma reiniciar o serviço durante a queda (#33).

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
