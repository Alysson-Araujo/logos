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

|                        |                                                                                                                                                                                                               |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Protótipo no Figma** | [Prototipação AutoU · Case Logos](https://www.figma.com/design/MBi6vLG2IHBC6xuREsDjmW/Prototipa%C3%A7%C3%A3o-AutoU---Case-Logos?m=auto&t=1aX7uwejPSGdnUIQ-1) — todas as telas, estados e o convite por e-mail |
| **Demo ao vivo**       | **[debpv51kciojx.cloudfront.net](https://debpv51kciojx.cloudfront.net)** — S3 + CloudFront, publicada a cada merge na `main`                                                                                  |
| **Vídeo (5 min)**      | _(a publicar)_ <!-- TODO-LINK: URL pública do vídeo de demonstração -->                                                                                                                                       |
| **Documentação**       | [`docs/`](docs/) — 12 documentos temáticos + 18 ADRs com decisões e alternativas descartadas                                                                                                                  |
| **API (Swagger)**      | [Function URL + `/docs`](https://c33z3s4di7cywi7azqthdd62mu0ufnds.lambda-url.us-east-1.on.aws/docs) — Lambda com Mangum, ao vivo                                                                              |
| **Erros e soluções**   | Registro de **38 problemas reais** com causa e lição, resumido [nesta seção](#as-dificuldades-reais) e detalhado em [`docs/10-registro-de-execucao.md`](docs/10-registro-de-execucao.md)                      |

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

## Telas

Capturas da **aplicação publicada**, com os dados de demonstração do seed: tema
claro e 1440 × 900, salvo onde indicado. Os arquivos vivem em
[`docs/assets/`](docs/assets/) e são regerados por
[`scripts/captura.mjs`](scripts/captura.mjs) — `node scripts/captura.mjs`
(Playwright sobre o Edge do sistema, sem baixar navegador).

### Login

![Tela de login: card com e-mail e senha de demonstração já preenchidos e, no rodapé, a caixa "Acesso de demonstração" com as contas do seed agrupadas por papel](docs/assets/login.png)

A credencial de demonstração já vem preenchida: a tela abre pronta para entrar
com um clique. A caixa no rodapé do card lista as contas do seed **agrupadas por
papel** — quem avalia não precisa procurar a senha em outro documento, e vê
antes de entrar que `REPORTER` e `ANALYST` enxergam recortes diferentes da fila.

### Triagem — a fila priorizada

![Tela de triagem: quatro cartões de KPI por status no topo, barra de filtros com busca e criticidade, e a lista de incidentes com faixa colorida de prioridade na borda esquerda de cada linha](docs/assets/triagem.png)

É a tela que responde "o que está pegando fogo agora?". Os quatro contadores do
topo são também **filtros**: clicar em `ABERTO` recorta a fila por status. Cada
linha carrega os três canais redundantes de informação — a **faixa colorida na
borda esquerda** comunica a prioridade, o selo comunica a criticidade (cor,
forma e rótulo) e a direita mostra a contagem regressiva do SLA. A lista é
virtualizada: 120 incidentes no total, ~20 linhas no DOM.

### Detalhe do incidente

![Drawer de detalhe: status atual com as transições permitidas, consumo do prazo em barra, dados da operação e a decomposição do priority score termo a termo](docs/assets/drawer-detalhe.png)

O ciclo de vida acontece aqui. As transições oferecidas dependem do status atual
— `FECHADO` é terminal —, e a mudança que exige justificativa (`FECHADO`,
`INCONCLUSIVO`) abre o campo de texto antes de enviar. O bloco **"Por que esta
prioridade?"** itemiza o score, termo a termo, para que a ordem da fila seja
auditável em vez de opaca. O rodapé mostra o `ETag` que o lock otimista usa.

No fim do drawer fica o **histórico de auditoria**: cada evento com ícone, a
transição de origem e destino, o autor que veio do token e a versão que o cliente
declarou esperar. A ordem vem do servidor, de uma coluna `sequence` atribuída
dentro da transação — e não do `created_at`, porque o relógio do Windows empata
no milissegundo e o desempate sobrava para um UUID aleatório. O print acima é
anterior a essa seção; ela aparece abaixo da justificativa.

### Registro de incidente

![Painel lateral de registro de incidente: título preenchido e a lista de sugestões de placa aberta, mostrando modelo e transportadora de cada veículo da frota](docs/assets/novo-incidente.png)

O painel grava o incidente já priorizado. A placa é sugerida a partir da **frota
de 5.000 caminhões**, consultada por prefixo enquanto se digita; a linha de
apoio traz modelo e transportadora, porque quem está no rádio reconhece "Volvo
VM 270 da Transbrasil" mais rápido do que sete caracteres de código.

### Contas de acesso

![Tela de contas de acesso: tabela com pessoa, papel, situação, último acesso e ação de desativar, além do botão "Nova conta"](docs/assets/contas-de-acesso.png)

Administração de contas por convite, alcançável pelo menu do usuário **apenas
com o papel `ADMIN`** — para os demais a API responderia `403`. A tela mostra
papel, situação e último acesso, e é daqui que sai o reenvio do convite de quem
ainda não fez o primeiro acesso.

### Tema escuro e tela pequena

![A triagem em tema escuro: mesmos KPIs, faixas de prioridade e selos de criticidade, com os tokens do tema escuro](docs/assets/triagem-escuro.png)

<img src="docs/assets/triagem-mobile.png" alt="A triagem em 390 px de largura: KPIs em duas colunas, botão de novo incidente e filtros empilhados, e a mesma fila priorizada" width="390">

O tema claro/escuro é persistido e sobrevive ao recarregamento; a criticidade
continua legível nos dois porque a codificação é redundante (cor, ícone e
forma). Em 390 px de largura a triagem se reorganiza — KPIs em duas colunas,
filtros empilhados e a mesma fila priorizada, sem perder a faixa de prioridade
nem a contagem de SLA.

## Os diferenciais

O que este projeto tem além do que o briefing pediu. Cada item é verificável no
código e tem documentação própria.

| Diferencial                                  | Por que importa                                                                                                                       | Onde                                                    |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| **Lock otimista em uma única instrução SQL** | Comparação e escrita são a mesma operação. Não existe janela de corrida, mesmo com N réplicas da API                                  | [ADR 0008](docs/adr/0008-optimistic-locking.md)         |
| **Idempotência garantida pelo banco**        | A chave é a **chave primária** de uma tabela: quem impede a execução dupla é a restrição de unicidade, não um `if` no código          | [docs/04](docs/04-concorrencia-e-resiliencia.md)        |
| **Priority score explicável**                | A interface mostra o cálculo termo a termo em tooltip, então a ordem da fila é auditável em vez de opaca                              | [ADR 0013](docs/adr/0013-priority-score-no-servidor.md) |
| **Autenticação com revogação real**          | O logout invalida o `jti` no banco — não é só o cliente esquecendo o token                                                            | [ADR 0015](docs/adr/0015-autenticacao-jwt.md)           |
| **Sessões encerradas por corte de tempo**    | Desativar conta e trocar senha invalidam tokens já emitidos **sem** guardar todos os tokens, e reativar não ressuscita o token antigo | `core/tokens.py`, `api/deps.py`                         |
| **Autorização com escopo na query**          | O filtro por papel entra no `WHERE`, então o total do `meta` e os KPIs já vêm escopados de graça                                      | [docs/03 §15.6](docs/03-api.md)                         |
| **Administração de contas por convite**      | Senha temporária de 24 h, de uso único, e o primeiro acesso só serve para definir a senha                                             | [docs/03 §16](docs/03-api.md)                           |
| **Trilha de auditoria com autor do token**   | O autor do evento é quem agiu, não um texto que o cliente escolhe                                                                     | [docs/03 §15.9](docs/03-api.md)                         |
| **Combobox acessível construído à mão**      | O Radix não tem combobox; foi implementado com `aria-activedescendant`, foco no input e `Esc` que fecha só a lista                    | [docs/05 §10.5](docs/05-design-system.md)               |
| **Seed de 120 incidentes realistas**         | Rodovias reais, km coerente, placas no padrão Mercosul e SLA calculado — a demonstração convence                                      | `app/infra/seed.py`                                     |
| **Dois bancos exercitados na CI**            | SQLite (rápido) **e** PostgreSQL real: é onde o lock otimista é provado sob concorrência, não só descrito                             | [docs/07](docs/07-testes.md)                            |
| **Deploy na AWS**                            | Lambda + S3 + CloudFront + Neon, com CD por OIDC e **sem segredo de AWS no repositório**; custo medido de US$ 0,023/mês               | [ADR 0017](docs/adr/0017-lambda-s3-cloudfront.md)       |

## Funcionalidades

Situação real do repositório. **Tudo marcado como pronto está implementado,
coberto por teste e exercitado na CI** — não é declaração de intenção.

### O núcleo pedido pelo briefing

| Funcionalidade                                                                 | Status    |
| ------------------------------------------------------------------------------ | --------- |
| Cadastro de incidentes (5 categorias, 3 criticidades, 4 status)                | ✅ pronto |
| Listagem paginada por **cursor** com filtros combináveis                       | ✅ pronto |
| **Gestão por exceção**: filtros por criticidade, categoria e busca textual     | ✅ pronto |
| Transições de status validadas no servidor (máquina de estados)                | ✅ pronto |
| Justificativa obrigatória em `FECHADO` e `INCONCLUSIVO`                        | ✅ pronto |
| **Lock otimista** (`version` + `If-Match`) com `409` e o estado atual no corpo | ✅ pronto |
| **Idempotência** via `Idempotency-Key` nas mutações                            | ✅ pronto |
| **Priority score** determinístico, calculado e persistido no servidor          | ✅ pronto |
| SLA com contagem regressiva e alerta visual progressivo                        | ✅ pronto |
| Lista virtualizada (100+ incidentes, ~20 linhas no DOM)                        | ✅ pronto |
| Modo compacto e confortável                                                    | ✅ pronto |
| Filtros persistidos na URL (link compartilhável)                               | ✅ pronto |
| Busca textual com debounce e `keepPreviousData`                                | ✅ pronto |
| Modal de conflito `409` com diff campo a campo                                 | ✅ pronto |
| **Resiliência**: timeout, retry com jitter, disjuntor e cache _stale_          | ✅ pronto |
| Estados de UI explícitos (loading, erro, vazio, offline, otimista)             | ✅ pronto |
| Tema claro/escuro persistido                                                   | ✅ pronto |
| Seed com 120 incidentes realistas                                              | ✅ pronto |

### Além do briefing

O que o case não pedia, mas que a operação exige — e que mudou o patamar do
projeto.

| Funcionalidade | Status |
| --- | --- |
| **Autenticação** JWT, com revogação real no logout | ✅ pronto |
| **Autorização por papel** (`REPORTER`/`ANALYST`/`ADMIN`), com escopo na query | ✅ pronto |
| **Administração de contas por convite**, com senha temporária e primeiro acesso obrigatório | ✅ pronto |
| **Troca de senha** e menu do usuário no cabeçalho | ✅ pronto |
| **Timeline de auditoria** no drawer (`GET /incidents/{id}/events`), com autor vindo do token e ordem determinística por `sequence` | ✅ pronto |
| **Busca de frota** por prefixo de placa no cadastro | ✅ pronto |
| **Autocomplete de local** com combobox acessível | ✅ pronto |
| **Guia de boas-vindas** na primeira visita | ✅ pronto |
| **Faixas de prioridade** na borda da linha (crítica · alta · média · baixa) | ✅ pronto |
| Atalhos de teclado na fila (`j`/`k`/`Enter`/`Esc`) | ✅ pronto |
| Soft delete com trilha de auditoria preservada | ✅ pronto |
| Detecção de offline com aviso na tela | ✅ pronto |
| Tela de administração de contas, alcançável só com `ADMIN` | ✅ pronto |

### Qualidade, automação e publicação

| Funcionalidade | Status |
| --- | --- |
| Lint, formatação, tipagem e hooks de Git (`Ruff`, `mypy`, `ESLint`, `Husky`) | ✅ pronto |
| CI em cada PR: lint, tipos, testes **nos dois bancos** e build | ✅ pronto |
| Teste de **concorrência** com `ThreadPoolExecutor` (o que sustenta o Pilar 1) | ✅ pronto |
| Cobertura mínima de 80% no backend, verificada na CI (real: ~94%) | ✅ pronto |
| **Testes E2E com Cypress** em navegador real, contra a API de verdade | ✅ pronto |
| Cobertura mínima no frontend (piso) e orçamento de bundle por gzip, no build local | ✅ pronto |
| Testes diretos dos 21 hooks do frontend, além dos componentes | ✅ pronto |
| Documentação: 12 documentos temáticos + 18 ADRs | ✅ pronto |
| Publicação na AWS (Lambda + S3 + CloudFront) com CD via OIDC, **sem segredo no repositório** | ✅ pronto |
| Aviso automático em issue quando o deploy falha                                              | ✅ pronto |

### Roadmap

| Funcionalidade | Status |
| --- | --- |
| SSE com badge "N novos" sem reordenar a lista | ⏳ planejado |
| Relatórios em PDF/CSV por período | ⏳ planejado |

> **Removidos do roadmap por já estarem prontos**: `PATCH /incidents/{id}`
> (implementado, com `If-Match` e `409`), command palette (`Ctrl+K` já responde
> pelos atalhos da fila), cobertura no frontend, os testes E2E com Cypress e a
> **timeline na interface** (o drawer passou a consumir o endpoint).

Legenda: ✅ pronto · 🚧 em desenvolvimento · ⏳ planejado.

## Decisões de arquitetura

Resumo das 18 decisões registradas. Cada uma tem um ADR completo em
[`docs/adr/`](docs/adr/) com contexto, alternativas descartadas e consequências.

| ADR                                                 | Decisão                                                         | Alternativa descartada                    |
| --------------------------------------------------- | --------------------------------------------------------------- | ----------------------------------------- |
| [0001](docs/adr/0001-monorepo.md)                   | Monorepo `backend/` + `frontend/`                               | Dois repositórios                         |
| [0002](docs/adr/0002-fastapi.md)                    | FastAPI (Python 3.12)                                           | Flask, Django REST                        |
| [0003](docs/adr/0003-postgres-e-sqlite.md)          | SQLAlchemy 2.0 + Alembic, SQLite local / PostgreSQL em produção | JSON estruturado                          |
| [0004](docs/adr/0004-react-vite.md)                 | React 18 + TypeScript + Vite                                    | Next.js                                   |
| [0005](docs/adr/0005-tanstack-query.md)             | TanStack Query para estado de servidor                          | Redux Toolkit, SWR                        |
| [0006](docs/adr/0006-zustand.md)                    | Zustand para estado de UI                                       | Context API puro                          |
| [0007](docs/adr/0007-tailwind-shadcn.md)            | Tailwind CSS + shadcn/ui (Radix)                                | MUI, Chakra                               |
| [0008](docs/adr/0008-optimistic-locking.md)         | Optimistic locking (`version`/ETag)                             | Pessimistic lock (`SELECT FOR UPDATE`)    |
| [0009](docs/adr/0009-ruff-mypy.md)                  | Ruff + mypy no backend                                          | flake8 + black + isort                    |
| [0010](docs/adr/0010-cursor-pagination.md)          | Paginação por cursor                                            | Offset/limit                              |
| [0011](docs/adr/0011-sse.md)                        | SSE para tempo real                                             | WebSocket                                 |
| [0012](docs/adr/0012-render-vercel-neon.md)         | Render + Vercel + Neon — **substituído pelo 0017**              | Hugging Face Spaces, Replit               |
| [0013](docs/adr/0013-priority-score-no-servidor.md) | Priority score no servidor                                      | Ordenar no cliente                        |
| [0014](docs/adr/0014-soft-delete.md)                | Soft delete                                                     | Hard delete                               |
| [0015](docs/adr/0015-autenticacao-jwt.md)           | JWT HS256 + Argon2id, papéis e revogação por `jti`              | Sessão em cookie, token em `localStorage` |
| [0016](docs/adr/0016-sessao-no-sessionstorage.md)   | Token em `sessionStorage`, com `AbortController` no cliente     | `localStorage`, cookie `httpOnly`         |
| [0017](docs/adr/0017-lambda-s3-cloudfront.md)       | Lambda + S3 + CloudFront como Onda 2                            | EC2, App Runner (fechado a contas novas)  |
| [0018](docs/adr/0018-e2e-com-cypress.md)            | Cypress para os testes ponta a ponta                            | Playwright, sem E2E                       |

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
def backoff_delay(attempt: int, *, base: float = 1.0, cap: float = 8.0) -> float:
    """Backoff exponencial com jitter completo.

    O jitter espalha as tentativas de todos os clientes que estavam
    bloqueados durante a mesma indisponibilidade, evitando que a
    reconexão simultânea derrube o banco outra vez (thundering herd).
    """
    ceiling = min(cap, base * (2 ** (attempt - 1)))
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

## Arquitetura

### Visão geral

```mermaid
flowchart TB
    SPA["SPA React 18 + Vite<br/>build estático"]

    subgraph borda["Borda · AWS"]
        CF["CloudFront<br/>PriceClass_100 · OAC"]
    end

    subgraph api["API FastAPI"]
        L["Lambda (container)<br/>Mangum · Function URL"]
    end

    NEON[("Neon PostgreSQL<br/>sslmode=require<br/>fora da AWS")]
    SMTP["SMTP<br/>convite por e-mail"]
    LOGS["Log CloudWatch<br/>JSON com requestId"]
    ECR[("ECR<br/>imagem :latest")]

    SPA -->|"GET /"| CF
    CF -->|"OAC"| S3[("S3<br/>bucket privado")]
    CF -->|"/api/v1 com Bearer"| L
    L --> NEON
    L --> SMTP
    L --> LOGS
    ECR -.->|"update-function-code"| L
```

> **A Render e a Vercel saíram.** Elas publicaram a Onda 1 e foram substituídas na
> Onda 2 ([ADR 0017](docs/adr/0017-lambda-s3-cloudfront.md)). A arquitetura nova
> custa **US$ 0,023/mês** — o único item cobrado é o armazenamento da imagem no
> ECR. O passo a passo da antiga continua em
> [`docs/08-deploy.md` §2](docs/08-deploy.md), como registro histórico.

### O caminho de uma requisição

A ordem dos middlewares não é acidental: o `request_context` é o mais externo,
então **toda** resposta carrega `X-Request-Id` — inclusive o `429`. E os
cabeçalhos de segurança envolvem o limitador, então até a resposta de "calma lá"
sai protegida.

```mermaid
flowchart TD
    A["Requisição HTTP"] --> B["request_context<br/>id + log estruturado"]
    B --> C["security_headers<br/>nosniff · Referrer-Policy · HSTS em produção"]
    C --> D["rate_limit<br/>60 leituras / 20 escritas por minuto"]
    D --> E["CORS"]
    E --> F["Idempotência<br/>se houver Idempotency-Key"]
    F --> G{"Token válido?<br/>assinatura antes do I/O"}
    G -->|não| H["401 UNAUTHENTICATED"]
    G -->|sim| I{"Senha temporária?"}
    I -->|sim| J["403 PASSWORD_CHANGE_REQUIRED<br/>exceto change-password, me e logout"]
    I -->|não| K{"O papel permite?"}
    K -->|não| L2["403 INSUFFICIENT_ROLE"]
    K -->|sim| M["Serviço<br/>cache · disjuntor · retentativa · timeout"]
    M --> N["Repositório<br/>consulta ou UPDATE condicional"]
    N --> O[("PostgreSQL")]
```

### O ciclo de vida de um incidente

```mermaid
stateDiagram-v2
    [*] --> ABERTO
    ABERTO --> EM_INVESTIGACAO
    ABERTO --> FECHADO
    ABERTO --> INCONCLUSIVO
    EM_INVESTIGACAO --> ABERTO
    EM_INVESTIGACAO --> FECHADO
    EM_INVESTIGACAO --> INCONCLUSIVO
    INCONCLUSIVO --> EM_INVESTIGACAO
    INCONCLUSIVO --> FECHADO
    FECHADO --> [*]

    note right of FECHADO
        FECHADO e INCONCLUSIVO exigem
        resolutionNotes com 10+ caracteres
    end note

    note left of ABERTO
        Fechar direto de ABERTO e permitido.
        A API valida a JUSTIFICATIVA, nao o caminho.
    end note
```

### O lock otimista, em sequência

```mermaid
sequenceDiagram
    autonumber
    participant A as Analista A
    participant B as Analista B
    participant API as API
    participant DB as PostgreSQL

    A->>API: GET /incidents/{id}
    API-->>A: 200 + ETag "3"
    B->>API: GET /incidents/{id}
    API-->>B: 200 + ETag "3"

    Note over A,B: as duas telas partem da MESMA versão

    A->>API: POST /status  (If-Match "3")
    API->>DB: UPDATE ... WHERE id = :id AND version = 3
    DB-->>API: 1 linha afetada
    API-->>A: 200 + ETag "4"

    B->>API: POST /status  (If-Match "3")
    API->>DB: UPDATE ... WHERE id = :id AND version = 3
    DB-->>API: 0 linhas afetadas
    API->>DB: SELECT versão atual
    DB-->>API: version = 4
    API-->>B: 409 VERSION_CONFLICT
```

### As camadas do backend

```
app/
├── domain/       ← REGRAS PURAS: não conhece HTTP, banco nem configuração
├── models/       ← TABELAS (SQLAlchemy): o formato do dado no banco
├── schemas/      ← CONTRATO (Pydantic): o formato do dado na API
├── repositories/ ← ACESSO A DADOS: consultas, CAS, paginação
├── services/     ← COORDENAÇÃO: regra + banco + resiliência juntos
├── api/          ← ENTRADA: rotas, injeção de dependência, guardas
├── core/         ← INFRAESTRUTURA: config, erros, tokens, cache, mailer
└── infra/        ← APOIO: retry, disjuntor, seed, templates de e-mail
```

**A regra que sustenta tudo:** as dependências apontam **para dentro**. O
`domain/` não importa nada das outras camadas — é por isso que os testes de
prioridade e de máquina de estados rodam em milissegundos, sem banco.

## Stack

| Camada             | Tecnologia                                        | Por que esta e não outra                                                                                                                                                                                                            |
| ------------------ | ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| API                | **FastAPI** + Pydantic v2                         | Validação declarativa e OpenAPI automático; `async` para I/O; é o "Python" pedido pelo briefing com o melhor custo/benefício. Flask exigiria montar validação e documentação à mão.                                                 |
| Persistência       | **SQLAlchemy 2.0 + Alembic**                      | O lock otimista exige `UPDATE` condicional atômico, que um JSON estruturado não oferece de forma confiável. O schema é versionado pelo Alembic, e `alembic check` na CI acusa qualquer divergência entre os modelos e as migrações. |
| Banco              | **PostgreSQL** local (container) e em produção    | É o mesmo banco nos dois ambientes, então o comportamento de concorrência e os índices `GIN` são exercidos de verdade. O SQLite segue suportado como alternativa sem container, para rodar em qualquer máquina.                     |
| Frontend           | **React 18 + TypeScript `strict`**                | SPA que consome API. TypeScript estrito transforma o contrato da API em erro de compilação em vez de bug em produção.                                                                                                               |
| Build              | **Vite**                                          | Build quase instantâneo e HMR rápido. Next.js traria SSR desnecessário e acoplaria o deploy do front ao do back.                                                                                                                    |
| Estado de servidor | **TanStack Query**                                | Retry, cache, `staleTime`, `onMutate` otimista e rollback vêm de fábrica — são exatamente os critérios de resiliência. Redux seria boilerplate.                                                                                     |
| Estado de UI       | **Zustand**                                       | Tema, densidade e filtros efêmeros sem re-render global. Context sozinho faria a árvore inteira re-renderizar.                                                                                                                      |
| Estilo             | **Tailwind CSS**                                  | Tokens controláveis e dark mode por classe, sem CSS morto.                                                                                                                                                                          |
| Componentes        | **shadcn/ui sobre Radix**                         | Acessibilidade (foco, teclado, ARIA) por padrão e o código no repositório, sem caixa preta.                                                                                                                                         |
| Lista              | **TanStack Virtual**                              | 100+ incidentes renderizando ~20 linhas, DOM estável e scroll fluido.                                                                                                                                                               |
| Contrato runtime   | **Zod**                                           | O front não confia cegamente no JSON: os schemas espelham o contrato e falham cedo.                                                                                                                                                 |
| Testes             | **pytest** + **Vitest** + Cypress                 | Um por nível da pirâmide: unidade, integração, corrida com `ThreadPoolExecutor` e navegador real. O Cypress entra só onde o `jsdom` não chega — [ADR 0018](docs/adr/0018-e2e-com-cypress.md).                                       |
| Qualidade Python   | **Ruff + mypy `strict`**                          | Um binário que formata e faz lint, muito mais rápido que flake8 + black + isort; mypy garante que o contrato de tipos é real.                                                                                                       |
| Qualidade TS       | **ESLint 9 + Prettier**                           | Regras de hooks, `jsx-a11y` e `no-floating-promises` pegam bugs de UI antes do runtime.                                                                                                                                             |
| Automação          | **Husky + lint-staged + commitlint**              | Padrão de commit aplicado no `commit-msg`; formatação apenas do que mudou.                                                                                                                                                          |
| Deploy             | **Lambda + S3 + CloudFront**                      | Escala a zero; o banco fica fora da AWS, o que dispensa VPC e NAT. Custo medido de US$ 0,023/mês. Decisão e limites no [ADR 0017](docs/adr/0017-lambda-s3-cloudfront.md).                                                           |
| CD na AWS          | **OIDC federado**                                 | Nenhum segredo de AWS no repositório: o GitHub assume a role por identidade federada.                                                                                                                                               |
| E-mail             | **Porta `Mailer`** (`LoggingMailer`/`SmtpMailer`) | Trocar entre log e SMTP é configuração, não reescrita — permite demonstrar o convite sem credencial.                                                                                                                                |

## As dificuldades reais

O que deu errado, e o que mudou na forma de trabalhar por causa disso. O registro
completo tem **38 entradas**, cada uma com sintoma, causa, correção e lição — as
mais representativas estão abaixo, e a narrativa de execução está em
[`docs/10-registro-de-execucao.md`](docs/10-registro-de-execucao.md).

| Dificuldade                                          | O que aconteceu                                                                                                                                                          | O que ficou aprendido                                                                                                                          |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| **O banco parado que pendurou a API por 12 minutos** | Com o container derrubado, uma requisição não falhou — ficou pendurada. Faltava `connect_timeout`. Havia 203 testes verdes e nenhum parava o banco                       | Timeout é o que faz a falha **acontecer**. Sem ele, o disjuntor não tem o que contar e a tela fica carregando para sempre                      |
| **A guarda que quebrou o deploy do Lambda**          | Em produção, sem `SMTP_HOST` a aplicação **recusa subir** — e o `create-function.json` não tinha a variável                                                              | Validar na subida é melhor que descobrir depois que ninguém recebeu convite. Mas a guarda precisa estar escrita no mesmo lugar que o deploy lê |
| **OIDC parou de casar do nada**                      | O GitHub passou a embutir IDs de dono e repositório no campo `sub`, e o casamento literal na política de confiança deixou de bater                                       | Autenticação federada tem prazo de validade silencioso: o provedor muda a asserção e o sintoma é sempre "não autorizado"                       |
| **A migração editada depois de aplicada**            | Editei a migração `0004` depois de rodar o `upgrade`. O Alembic já tinha gravado a revisão, e o banco ficou sem a coluna — com a migração marcada como aplicada          | **Depois de aplicada, migração é imutável.** E o CI não pega: ele constrói o banco do zero e passa                                             |
| **O `iat` com precisão de segundo**                  | O corte de sessão grava microssegundos; o token gravava segundos. Quem trocava a senha não conseguia entrar — e o sintoma apareceu em testes de **remoção de incidente** | Bug no token pode aparecer no lugar errado. Teste que falha "longe" aponta para uma dependência compartilhada                                  |
| **As faixas de prioridade propostas vs. medidas**    | Propus `CRÍTICA ≥ 1000` olhando a leitura. A distribuição real colocava ~55% da fila numa faixa só                                                                       | **Medir antes de escolher.** Consultar os dados antes de implementar custou minutos e evitou implementar a versão errada                       |
| **O `Esc` fechava o formulário inteiro**             | Com a lista de sugestões aberta, `Esc` deveria fechar a lista. O Radix escuta `Escape` na **fase de captura**, e o `stopPropagation` do input chegava tarde              | Resolveu instrumentar o teste com uma asserção de diagnóstico, em vez de chutar outra correção                                                 |
| **O seed que não converge**                          | O seed tem guarda "tudo ou nada": popula banco vazio e desiste de banco parcial. As contas novas nunca foram criadas                                                     | **Idempotência de verdade é chegar ao estado desejado**, não pular o trabalho quando já existe algo                                            |
| **O deploy falhou quatro vezes em silêncio**         | Os checks do PR ficam verdes (a CI é outro workflow), o merge acontece e o deploy morre depois                                                                           | **Um erro que não tem onde aparecer não é um erro: é um silêncio.** Hoje há um job que abre issue quando o deploy falha                        |
| **PowerShell 5.1 corrompeu 24 arquivos**             | `Get-Content -Raw` leu UTF-8 sem BOM como Windows-1252, e eu gravei o erro de volta                                                                                      | Versionar antes de operação em lote é o que torna o erro reversível. O PowerShell ficou para comando e verificação                             |

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
alembic upgrade head        # cria o schema a partir das migrações
python -m app.infra.seed    # popula 120 incidentes e as contas de demonstração
uvicorn app.main:app --reload --port 8000
```

O schema é versionado pelo **Alembic**. A aplicação **não** cria tabelas: se o
banco estiver vazio, ela para na subida com a instrução do comando que falta —
o que evita o cenário de a API e as migrações divergirem sem ninguém perceber.
A migração inicial (`backend/alembic/versions/0001_esquema_inicial.py`) cria as
duas tabelas e todos os índices.

Verificação: `GET http://localhost:8000/health/ready` deve responder `200` e o
Swagger está em `http://localhost:8000/docs`.

#### Contas de demonstração

O `seed` cria nove contas — as oito ativas abaixo e uma que nasce com convite
pendente. **Todas as oito autenticam no app publicado**, verificado por HTTP
real contra a Function URL.

| Conta                         | Senha                | Papel      | Enxerga                      |
| ----------------------------- | -------------------- | ---------- | ---------------------------- |
| `ana@demo.example.com`        | `ana.logos2026`      | `ANALYST`  | A fila inteira               |
| `carlos@demo.example.com`     | `carlos.logos2026`   | `ANALYST`  | A fila inteira               |
| `alyssonaraujowork@gmail.com` | `alysson.logos2026`  | `ANALYST`  | A fila inteira               |
| `renata.lima@example.org`     | `renata.logos2026`   | `ANALYST`  | A fila inteira               |
| `admin@demo.example.com`      | `admin.logos2026`    | `ADMIN`    | Tudo, e remove contas        |
| `carlos.menezes@example.com`  | `carlos.logos2026`   | `ADMIN`    | Tudo, e remove contas        |
| `marina@demo.example.com`     | `marina.logos2026`   | `REPORTER` | Apenas o que ela mesma abriu |
| `joana.prado@example.net`     | `joana.logos2026`    | `REPORTER` | Apenas o que ela mesma abriu |
| `marcos.tavares@example.org`  | — convite pendente — | `REPORTER` | O que ele mesmo abrir        |

> **O seed converge, não é "tudo ou nada".** A guarda antiga era
> `if repository.count() > 0: return`: ela populava banco vazio e desistia de
> banco parcial. Quando a lista de contas cresceu depois da última execução, as
> novas nunca foram criadas — e a tela de login passou a anunciar credenciais que
> respondiam `401`. Hoje o seed avalia conta por conta pelo e-mail: a que falta
> entra, a que existe fica **exatamente como está** (ele nunca sobrescreve senha
> de conta viva) e uma segunda execução cria zero. O teste
> `test_seed_converge_banco_parcial` guarda esse comportamento.

Os domínios são os reservados pela RFC 2606 (`example.com`, `example.org`,
`example.net`, e o subdomínio `demo.example.com`): não pertencem a ninguém, então
um "Reenviar convite" clicado por engano não entrega credencial na caixa de
entrada de um estranho — o convite sai por SMTP de verdade (#129). A única
exceção deliberada é a conta pessoal de quem apresenta.

`marcos.tavares` nasce com **convite pendente**: inativo, sem senha definitiva e
com uma senha temporária que o seed **não envia** a ninguém. É o estado que a tela
_Contas de acesso_ mostra com o botão **Reenviar**, que gera outra temporária e a
entrega pelo canal configurado.

Ambas as contas `ADMIN` (`admin@demo.example.com` e
`carlos.menezes@example.com`) abrem a administração de contas pelo menu do
usuário.

Entrar como `joana.prado` e como `ana` é a forma mais rápida de ver a autorização
funcionando: a mesma listagem devolve recortes diferentes. O contrato completo do
fluxo está em [`docs/03-api.md` §15](docs/03-api.md) e a decisão em
[ADR 0015](docs/adr/0015-autenticacao-jwt.md).

#### Criar uma conta (convite)

Contas não se cadastram sozinhas: quem entra é convidado por um administrador.
Entre como `admin@demo.example.com` e use `POST /api/v1/users` (ou a tela de
administração de contas, no menu do usuário):

```bash
curl -X POST http://localhost:8000/api/v1/users \
  -H "Authorization: Bearer <token do admin>" \
  -H "Content-Type: application/json" \
  -d '{"email": "paula.mendes@example.com", "role": "REPORTER"}'
```

A conta nasce **inativa**, com uma senha temporária válida por **24 horas**. A
senha **não** volta na resposta — ela sai no e-mail. Sem `SMTP_HOST` configurado,
o envio vai para o **log do servidor**, que é como se percorre o fluxo inteiro
sem credencial de e-mail:

```bash
# no terminal da API, procure a linha do convite:
#   email_para_log destinatario=paula.mendes@example.com assunto=Sua conta no Logos foi criada
```

No primeiro login, `POST /auth/login` responde `mustChangePassword: true`, e a
sessão só serve para definir a senha: qualquer outra rota devolve
`403 PASSWORD_CHANGE_REQUIRED`. Depois da troca, a conta fica ativa e a senha
temporária morre. O contrato está em
[`docs/03-api.md` §16](docs/03-api.md).

### 3. Frontend

Em outro terminal, na raiz do repositório:

```bash
cp frontend/.env.example frontend/.env    # no Windows: Copy-Item frontend\.env.example frontend\.env
pnpm --filter web dev
```

Aplicação em `http://localhost:5173`.

#### Acesso de demonstração

A aplicação abre na tela de login, com a credencial de demonstração já
preenchida:

| Campo  | Valor                  |
| ------ | ---------------------- |
| E-mail | `ana@demo.example.com` |
| Senha  | `ana.logos2026`        |

O usuário vem do `seed` da API (perfil `ANALYST`, que enxerga a fila inteira).
Sem o backend no ar, o frontend sobe com a API simulada (`VITE_USE_MOCK`) e
aceita as mesmas credenciais: o mock lê a constante que a tela exibe, então as
duas não têm como divergir.

A caixa **Acesso de demonstração**, no rodapé do card, lista as contas do seed
agrupadas por papel — a mesma tabela deste README, com a senha de cada uma. A do
convite pendente aparece sem senha, porque ela ainda não tem uma: o primeiro
acesso é definido a partir do convite.

A sessão fica em `sessionStorage` — recarregar mantém o acesso, fechar a aba
encerra. O token vai em `Authorization: Bearer`, e um `401` devolve à tela de
login com aviso de sessão expirada. O porquê dessas escolhas está no
[ADR 0016](docs/adr/0016-sessao-no-sessionstorage.md) e em
[`docs/11`](docs/11-autenticacao-frontend.md).

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

| Variável                            | Padrão                                                  | Descrição                                                                                                                                                           |
| ----------------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ENVIRONMENT`                       | `development`                                           | `development`, `staging` ou `production`. Muda o nível de log e a política de CORS.                                                                                 |
| `DATABASE_URL`                      | `postgresql+psycopg://logos:logos@localhost:5433/logos` | String de conexão SQLAlchemy. O padrão aponta para o container do `pnpm db:up`. Para rodar sem container: `sqlite:///./logos.db`. Em produção, `…?sslmode=require`. |
| `CORS_ORIGINS`                      | `http://localhost:5173`                                 | Origens permitidas, separadas por vírgula. Nunca `*` em produção.                                                                                                   |
| `LOG_LEVEL`                         | `INFO`                                                  | Nível do log estruturado em JSON.                                                                                                                                   |
| `RATE_LIMIT_ENABLED`                | `true`                                                  | Liga o teto de requisições por cliente. Desligar é útil ao rodar carga local.                                                                                       |
| `RATE_LIMIT_READ_PER_MINUTE`        | `60`                                                    | Leituras (`GET`/`HEAD`) por minuto, por cliente.                                                                                                                    |
| `RATE_LIMIT_WRITE_PER_MINUTE`       | `20`                                                    | Escritas por minuto, por cliente. Mutação é deliberada e mais cara que a listagem.                                                                                  |
| `DB_STATEMENT_TIMEOUT_MS`           | `5000`                                                  | Teto de duração de **uma consulta**; a que estourar é cancelada com SQLSTATE `57014`.                                                                               |
| `DB_IDLE_TRANSACTION_TIMEOUT_MS`    | `10000`                                                 | Teto com a **transação aberta e ociosa**; sem ele, um worker interrompido segura locks e derruba a capacidade do pool.                                              |
| `RETRY_MAX_ATTEMPTS`                | `3`                                                     | Tentativas do retry interno com backoff e jitter, contando a primeira.                                                                                              |
| `RETRY_BASE_DELAY_SECONDS`          | `1.0`                                                   | Teto do backoff da primeira espera; dobra a cada tentativa (1s, 2s, 4s) e satura em 8s.                                                                             |
| `CIRCUIT_BREAKER_ENABLED`           | `true`                                                  | Desligar só para observar a falha crua do banco.                                                                                                                    |
| `CIRCUIT_BREAKER_FAILURE_THRESHOLD` | `5`                                                     | Falhas transitórias consecutivas que abrem o circuito.                                                                                                              |
| `CIRCUIT_BREAKER_COOLDOWN_SECONDS`  | `30.0`                                                  | Espera antes de autorizar a sondagem de recuperação.                                                                                                                |
| `CACHE_TTL_SECONDS`                 | `30`                                                    | TTL do cache da listagem com _stale-while-revalidate_.                                                                                                              |
| `SEED_ON_STARTUP`                   | `true`                                                  | Popula dados de demonstração ao subir em ambiente de desenvolvimento.                                                                                               |

### Frontend (`frontend/.env`)

| Variável            | Padrão                         | Descrição                                                                             |
| ------------------- | ------------------------------ | ------------------------------------------------------------------------------------- |
| `VITE_API_BASE_URL` | `http://localhost:8000/api/v1` | Base da API consumida pelo cliente HTTP. Em produção aponta para a Function URL da Lambda. |

Nenhum segredo é versionado. Apenas `.env.example`, com valores fictícios,
entra no repositório.

## Testes

```bash
pnpm test                                    # backend (pytest) + frontend (Vitest)
pnpm test:api                                # apenas backend
pnpm --filter web test:run                   # apenas frontend
cd backend && pytest tests/concurrency -v    # teste de corrida de status
pnpm e2e                                     # ponta a ponta no navegador (Cypress)
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
| Ponta a ponta (Cypress)            | Login, triagem e atalhos, cadastro, ciclo de vida, **conflito `409` com diff**, guia de boas-vindas, contas por convite e encerramento de sessão — contra a API de verdade, num banco descartável.                          |

O E2E sobe tudo sozinho: `pnpm e2e` (`scripts/e2e.mjs`) cria um SQLite
descartável, aplica as migrações, roda o seed, sobe a API e o **front compilado**
e só então chama o Cypress. O limite de requisições fica desligado nesse
ambiente — ele existe para proteger a operação, não para reprovar teste. Os
detalhes estão em [`docs/07-testes.md` §6](docs/07-testes.md) e no
[ADR 0018](docs/adr/0018-e2e-com-cypress.md).

Cobertura é tratada como **piso, não meta** nos dois lados:

- **Backend**: mínimo de **80%**, verificado na CI com `--cov-fail-under=80`;
  a suíte real fica em ~94%.
- **Frontend**: `@vitest/coverage-v8` configurado em `vitest.config.ts`, com
  pisos de 80% (statements, lines, functions) e 75% (branches). O `exclude`
  tira o que não é produto — `main.tsx`, os próprios testes, o setup e as
  fábricas do MSW —, porque medir o aparato de teste inflaria o número.

Além da cobertura, o build tem um **orçamento de tamanho**
(`scripts/verifica-bundle.mjs`): mede o gzip de cada chunk e falha se passar do
teto, para uma dependência pesada não entrar sem ninguém ver. O teto é calibrado
sobre o build real, e subir esse número é uma decisão que aparece no diff.

A suíte roda em SQLite por padrão e **em PostgreSQL quando `TEST_DATABASE_URL`
está definida** — é exatamente o que o job `backend-postgres` da CI faz, e é
assim que o lock otimista é exercido sob concorrência real, e não apenas
descrito. A justificativa está em
[`docs/07-testes.md`](docs/07-testes.md).

## Deploy

O produto roda em **AWS**: S3 + CloudFront no front, Lambda com Function URL na
API, e o Neon como banco — fora da AWS, o que é a decisão central do desenho.

```mermaid
flowchart LR
    U["Navegador"] -->|HTTPS| CF["CloudFront<br/>PriceClass_100"]
    CF -->|OAC| S3[("S3<br/>privado")]
    CF -->|Function URL| L["Lambda<br/>Mangum · sem VPC"]
    L -->|TLS| N[("Neon<br/>fora da AWS")]
```

| Camada   | Serviço                            | Configuração                                              |
| -------- | ---------------------------------- | --------------------------------------------------------- |
| Frontend | **S3 + CloudFront**                | Bucket privado, acesso só por OAC. Invalidação no deploy. |
| API      | **Lambda (imagem) + Function URL** | 1.024 MB, timeout de 30 s, **sem VPC**                    |
| Banco    | **Neon**                           | Endpoint direto, `?sslmode=require`                       |
| Imagem   | **ECR**                            | Base `public.ecr.aws/lambda/python:3.12`                  |

**Custo medido: US$ 0,023/mês.** O único item cobrado é o armazenamento da
imagem no ECR (0,228 GB × US$ 0,10). Lambda, CloudFront e S3 cabem nas faixas
_Always Free_. O detalhamento — incluindo os recursos que **não** existem na conta
e por quê — está em [`docs/12-deploy-aws.md`](docs/12-deploy-aws.md).

> **Por que não há NAT Gateway.** É a pergunta que decide a conta. Função em VPC
> perde rota para a internet e precisa de NAT (US$ 32,85/mês) para alcançar um
> banco fora da AWS. Mantendo o Neon, a Lambda fica **fora de VPC** e o custo cai
> de ~US$ 33/mês para centavos.

O CD roda por **OIDC federado** (`.github/workflows/deploy-aws.yml`): **nenhum
segredo de AWS no repositório**. Cada merge na `main` publica os dois lados, e uma
falha **abre issue sozinha** — o deploy já falhou quatro vezes em silêncio antes
disso existir.

Um `warm.yml` mantém um container quente batendo em `/health/live` — que **não
toca no banco**, então o Neon continua suspenso e os 100 CU-hours do plano
gratuito não são consumidos.

### Reproduzir

1. Criar o projeto no Neon e copiar a `DATABASE_URL` com `sslmode=require`
   (**endpoint direto**, sem `-pooler`: o PgBouncer recusa o `statement_timeout`).
2. Criar o repositório ECR e publicar a imagem com
   `backend/Dockerfile.lambda` — a base **tem** que ser a da AWS (§5.3 do
   `12-deploy-aws.md`).
3. Criar a função Lambda a partir da imagem, **sem VPC**, e definir
   `DATABASE_URL`, `AUTH_SECRET_KEY`, `ENVIRONMENT=production`, `CORS_ORIGINS` e
   as variáveis de SMTP (ou `EMAIL_DISABLED=true`).
4. Criar a Function URL e **duas** permissões:
   `lambda:InvokeFunctionUrl` **e** `lambda:InvokeFunction` — só a primeira
   devolve `403` em HTTP real enquanto o `aws lambda invoke` responde `200`.
5. Buildar o front com `VITE_API_BASE_URL`, sincronizar no bucket e invalidar o
   CloudFront.
6. Rodar as migrações e o seed contra o banco publicado.

O passo a passo completo, com custo item a item e os cinco problemas que aparecem
nesse processo, está em [`docs/12-deploy-aws.md`](docs/12-deploy-aws.md).

> **A Onda 1 (Render + Vercel) foi aposentada.** Ela publicou a primeira versão e
> foi substituída na [ADR 0017](docs/adr/0017-lambda-s3-cloudfront.md). O passo a
> passo dela permanece em [`docs/08-deploy.md` §2](docs/08-deploy.md) como
> registro histórico — a comparação entre as duas arquiteturas é o que sustenta a
> decisão.

## Estrutura de pastas

```
logos/
├── .github/
│   └── workflows/
│       ├── ci.yml                    # lint + tipos + testes (SQLite E PostgreSQL) + build
│       ├── deploy-aws.yml            # CD para AWS via OIDC, sem segredo no repositório
│       └── warm.yml                  # mantém um container do Lambda quente
│
├── .husky/
│   ├── pre-commit                    # lint-staged (formata só o que mudou)
│   └── commit-msg                    # commitlint (Conventional Commits)
│
├── backend/
│   ├── app/
│   │   ├── main.py                   # app, middlewares, lifespan, verificação de schema
│   │   ├── lambda_handler.py         # entrada ASGI no Lambda (mangum)
│   │   ├── core/                     # config, database, logging, errors, security,
│   │   │                             # rate_limit, idempotency, tokens, cache, mailer
│   │   ├── domain/                   # enums, rules, priority, permissions, identity,
│   │   │                             # accounts ↳ sem HTTP, sem ORM: testável isolado
│   │   ├── schemas/                  # contratos Pydantic, todos em camelCase
│   │   ├── repositories/             # SQL, CAS, paginação por cursor, busca
│   │   ├── services/                 # regra de negócio e orquestração
│   │   ├── api/                      # deps (injeção + guardas) e router
│   │   │   └── v1/                   # health, auth, incidents, meta, users, vehicles
│   │   ├── models/                   # ORM (incident, incident_event, user,
│   │   │                             # revoked_token, idempotency_key)
│   │   └── infra/                    # retry, circuit_breaker, seed, mail_templates
│   ├── alembic/versions/             # 0001 → 0004, migrações versionadas
│   ├── tests/                        # unit/ · integration/ · concurrency/
│   ├── Dockerfile                    # desenvolvimento local (compose.yaml)
│   ├── Dockerfile.lambda             # Onda 2 (base oficial do Lambda)
│   ├── pyproject.toml                # deps + ruff + mypy + pytest + coverage
│   └── .env.example
│
├── frontend/
│   ├── cypress/                      # E2E no navegador: e2e/ (specs) e support/
│   └── src/
│       ├── app/                      # App, providers, RootScreen, ErrorBoundary
│       ├── components/
│       │   ├── ui/                   # button, input, select, dialog, drawer, badge,
│       │   │                         # toast, tooltip, skeleton, card, combobox
│       │   ├── layout/               # AppShell, Header, AppFooter, ThemeToggle, UserMenu
│       │   └── feedback/             # EmptyState, ErrorState, SkeletonList,
│       │                             # OfflineBanner, RefetchBar
│       ├── features/
│       │   ├── incidents/            # api, hooks, components, schemas (Zod), types
│       │   ├── auth/                 # AuthGate, Login, ChangePassword, useLogin
│       │   ├── accounts/             # administração de contas (só ADMIN)
│       │   ├── vehicles/             # busca de frota por placa
│       │   └── tour/                 # guia de boas-vindas
│       ├── lib/                      # http.ts (timeout/retry/idempotência),
│       │                             # queryClient.ts, formatters.ts, location.ts
│       ├── hooks/                    # useDebounce, useOnlineStatus, useToast,
│       │                             # useKeyboardShortcuts, useMediaQuery
│       ├── styles/                   # globals.css, tokens.css (light + dark)
│       └── test/                     # setup, msw/handlers, factories
│
├── scripts/
│   ├── e2e.mjs                       # banco + API + front descartáveis e o Cypress
│   ├── captura.mjs                   # prints do README (Playwright sobre o Edge)
│   ├── setup-local.ps1               # prepara a máquina do zero (Windows)
│   └── github-bootstrap.ps1          # labels, milestones e issues do projeto
│
├── docs/
│   ├── 01-visao-produto.md           # persona, jornada, dores, métricas
│   ├── 02-arquitetura.md             # C4, camadas, fluxos, ER, sequência
│   ├── 03-api.md                     # contrato completo, 17 seções
│   ├── 04-concorrencia-e-resiliencia.md
│   ├── 05-design-system.md           # tokens, componentes, acessibilidade
│   ├── 06-git-workflow.md
│   ├── 07-testes.md
│   ├── 08-deploy.md                  # deploy e troubleshooting (a Onda 1 fica como registro)
│   ├── 09-escolhas-tecnicas.md
│   ├── 10-registro-de-execucao.md    # o que foi feito, com evidência
│   ├── 11-autenticacao-frontend.md   # sessão, 401, combobox, decisões
│   ├── 12-deploy-aws.md              # Onda 2
│   ├── adr/                          # 17 registros de decisão de arquitetura
│   └── assets/                       # prints, gifs e diagramas
│
├── compose.yaml                      # Postgres de desenvolvimento em container
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

| Fora de escopo                                       | Motivo                                                                                                                           |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| **SSO corporativo** (SAML/OIDC com provedor externo) | A autenticação local com papéis **já existe e funciona**. Integrar um IdP exigiria uma conta corporativa que o case não fornece. |
| Rastreamento GPS em tempo real dos 5.000 caminhões   | É um produto de telemetria, não de triagem de incidentes.                                                                        |
| Notificações push, SMS ou WhatsApp                   | Dependem de integrações de terceiros e credenciais que o case não fornece.                                                       |
| Multi-tenant / multi-cliente                         | Exigiria modelagem de isolamento que desviaria o foco da concorrência e do design da informação.                                 |
| Migração de dados legados das planilhas              | Sem acesso ao formato real dos dados de origem.                                                                                  |
| Reset de senha por e-mail sem login ("esqueci")      | O fluxo é convite → senha temporária → troca obrigatória. Recuperação por link mágico é outra funcionalidade.                    |

### Roadmap — o que faria com mais tempo

1. **Relatórios em PDF e CSV por período.** O dado existente já permite o corte
   mais acionável: **por hora do dia** (se 60% dos incidentes ocorrem entre 22h e
   4h, isso é decisão de escala de turno, não de operação) e, em segundo,
   **reincidência por ponto** (o mesmo km aparecendo 8 vezes em 6 meses não é
   azar, é infraestrutura). O painel consultaria a **API**, nunca um CSV salvo —
   arquivo armazenado não tem autenticação e passaria por cima do escopo por
   papel.
2. **SSE para atualização ao vivo**, com o cuidado de não reordenar a lista sob o
   cursor do analista: itens novos entram como selo "N novos", não empurrando as
   linhas.
3. **`PATCH /incidents/{id}`** com o mesmo lock otimista, para corrigir placa,
   categoria ou local sem passar por uma transição de status.
4. **Observabilidade.** Métricas de TTP, TTA, taxa de `409` e latência p95 em
   `/metrics`, com painel de acompanhamento da central.
5. **Fila offline completa no cliente.** Mutações que falham por rede vão para
   uma fila em `localStorage` e são reenviadas quando a conexão volta, com
   reconciliação explícita dos conflitos acumulados.
6. **Elasticsearch ou `pg_trgm` para busca.** O `GIN` resolve a busca do MVP; com
   histórico longo, um índice trigram melhora o ranking por relevância.
7. **Testes de carga** com múltiplas réplicas, para validar o comportamento do
   pool e do disjuntor sob pressão real.

### Limites conhecidos do que está no ar

Dito com todas as letras — o que eu corrigiria antes de chamar de produção:

| Limite                                                                      | Impacto                                                                                                                   | O que resolveria                                                     |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| **Rate limit, disjuntor e cache vivem na memória do processo**               | Com 1 container o teto é exato; com N containers vira `60 × N`                                                            | Store compartilhado (Redis) — custaria mais que a hospedagem inteira |
| **O rate limit lê o primeiro item do `X-Forwarded-For`**                     | Atrás de um proxy, quem quiser contornar troca o valor do cabeçalho                                                       | Ler da **direita** (a entrada que o proxy confiável adicionou)       |
| **Sem métricas nem tracing**                                                 | Não há como responder "quantas requisições falharam na última hora"                                                       | `/metrics` + OpenTelemetry                                           |
| **`/health/ready` não mostra pool, disjuntor nem cache**                     | É justamente o que se olha numa queda                                                                                     | Enriquecer o payload do readiness                                    |
| **O piso de cobertura do frontend e o orçamento de bundle não rodam na CI**   | Existem na configuração e falham localmente, mas nenhum passo do workflow os executa — na prática, só o backend tem portão | Um `--coverage` e o `verifica-bundle` no job do frontend             |

### O que eu faria diferente se recomeçasse

- **Mediria a distribuição do score antes** de propor as faixas de prioridade. A
  primeira proposta colocava 55% da fila numa faixa só.
- **Usaria `batch_alter_table` desde a primeira migração** com constraint: o
  SQLite não suporta `ALTER TABLE ADD CONSTRAINT`, e o erro só apareceu quando a
  suíte rodou nele.
- **Escreveria o teste do `SmtpMailer` no mesmo dia** em que escrevi o
  `SmtpMailer`, em vez de deixá-lo sem cobertura até precisar dele funcionando.
- **Semeava transições na timeline, não só a criação.** Cada incidente do seed
  tem o evento `CREATED` e nada mais, então a trilha de auditoria — uma das
  funcionalidades mais fortes — aparece com uma linha só na demonstração.
  Semear um histórico de transições faria o recurso se explicar sozinho.

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
