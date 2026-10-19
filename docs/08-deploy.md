# Deploy

Este documento descreve como publicar o Logos, quais variáveis cada serviço
precisa e como resolver os problemas que realmente aparecem nesse processo.

> **Qual arquitetura está no ar.** O produto roda em **AWS** — S3 + CloudFront no
> front, Lambda com Function URL na API, Neon no banco. A Onda 1 (Render + Vercel)
> foi aposentada; o passo a passo dela permanece em §2 **como registro histórico**,
> não como caminho a seguir. O detalhamento da AWS está em
> [`12-deploy-aws.md`](12-deploy-aws.md) e no [ADR 0017](adr/0017-lambda-s3-cloudfront.md).

## 1. Arquitetura de produção

```mermaid
flowchart LR
    U["Navegador da analista"] -->|HTTPS| CF["CloudFront<br/>PriceClass_100"]
    CF -->|OAC| S3[("S3<br/>build estático do Vite")]
    CF -->|"Function URL"| LM["Lambda<br/>FastAPI + Mangum"]
    LM -->|"sslmode=require"| N[("Neon<br/>PostgreSQL serverless")]
```

| Serviço  | Plataforma               | Papel                                                          |
| -------- | ------------------------ | -------------------------------------------------------------- |
| Frontend | S3 + CloudFront          | Serve o build estático do Vite; bucket privado, acesso só por OAC. |
| API      | Lambda (imagem) + Function URL | Roda a aplicação FastAPI via Mangum. Fora de VPC, 1.024 MB. |
| Banco    | Neon                     | PostgreSQL serverless, com _branching_ por ambiente.           |

A escolha está justificada no [ADR 0017](adr/0017-lambda-s3-cloudfront.md), que
substitui o [ADR 0012](adr/0012-render-vercel-neon.md).

> **A conexão SSE não sobrevive à Lambda.** `GET /incidents/stream` é o único
> ponto em que a arquitetura nova é pior que a antiga: a Function URL é
> `BUFFERED` e não mantém a resposta aberta. Está declarado em §4.5 e no ADR.

## 2. Passo a passo — Onda 1 (aposentada)

> **Não siga esta seção para publicar.** Ela descreve o caminho Render + Vercel,
> que foi usado na primeira entrega e depois substituído. Fica registrada porque
> a comparação entre as duas arquiteturas é parte da decisão do ADR 0017 — e
> porque o Neon, que nasceu aqui, continua sendo o banco em uso (§2.1).

### 2.1 Neon (banco)

1. Criar o projeto `logos` no Neon.
2. Copiar a _connection string_ do **pooled endpoint** (é a que aparece por
   padrão no painel) com `?sslmode=require`.
3. Guardar duas versões da string:

| Uso       | Formato                                                         | Para que serve                                        |
| --------- | --------------------------------------------------------------- | ----------------------------------------------------- |
| Aplicação | `postgresql+psycopg://usuario:senha@host/logos?sslmode=require` | Conexões da API em tempo de execução.                 |
| Migrações | A mesma, com `-pooler` removido do host                         | `alembic upgrade head`, que precisa de sessão direta. |

A distinção importa: o _pooler_ do Neon usa PgBouncer em modo transação, e
migrações que abrem transações longas (ou usam _prepared statements_) se
comportam mal através dele.

### 2.2 Render (API)

> **Caminho recomendado:** o `render.yaml` na raiz do repositório já descreve
> este serviço. Use **New → Blueprint** e o Render preenche a configuração
> sozinho, pedindo apenas `DATABASE_URL` e `CORS_ORIGINS`. Os passos abaixo são
> o equivalente manual, para quem preferir criar o serviço à mão.

1. **New → Web Service** → conectar o repositório `logos`.
2. Configurar:

| Campo             | Valor                                                                      |
| ----------------- | -------------------------------------------------------------------------- |
| Root Directory    | `backend`                                                                  |
| Environment       | Python 3                                                                   |
| Build Command     | `pip install -e .`                                                         |
| Start Command     | `alembic upgrade head && uvicorn app.main:app --host 0.0.0.0 --port $PORT` |
| Health Check Path | `/health/live`                                                             |

3. Definir as variáveis de ambiente da [seção 3](#3-variáveis-de-ambiente).
4. Fazer o deploy. O primeiro build pode demorar alguns minutos.
5. O seed dos dados de demonstração roda **sozinho**, uma vez, pelo
   `initialDeployHook` do Blueprint. Em um serviço criado à mão, rode o seed da
   sua máquina apontando para o Neon — o plano gratuito do Render **não tem
   Shell**:

```bash
cd backend
export DATABASE_URL="postgresql+psycopg://…@ep-xxx.aws.neon.tech/logos?sslmode=require"
python -m app.infra.seed
```

6. Conferir `GET /health/ready` (deve responder `200`) e abrir `/docs`.

> **Por que o health check é `/health/live`, e não `/health/ready`.** O
> `/health/ready` consulta o banco, e o Neon suspende a computação quando fica
> ocioso: durante um deploy essa consulta pode estourar o timeout do Render e
> marcar como falha um deploy que estava correto. Há também uma razão de
> desenho: o health check da plataforma responde _"o processo está de pé?"_, e
> reiniciar o processo **não conserta** um banco fora do ar — usar um endpoint
> que depende do banco faria o Render reiniciar o serviço em laço durante uma
> queda. O `/health/live` é justamente o que continua respondendo com o
> disjuntor aberto. O `/health/ready` segue sendo o alvo da verificação manual
> da [seção 2.5](#25-verificação-pós-deploy).

> **Schema e migrações.** O schema é versionado pelo Alembic e a aplicação não
> cria tabelas: se o banco estiver vazio, ela para na subida dizendo qual comando
> falta. A CI roda `alembic upgrade head` e `alembic check`, que acusa qualquer
> divergência entre os modelos e as migrações. A URL usada pelas migrações deve
> ser a conexão **direta** do Neon, sem `-pooler`: o PgBouncer em modo transação
> se comporta mal com migrações.
>
> Em um deploy com **várias réplicas**, mover o `alembic upgrade head` do comando
> de start para um passo de release separado — do contrário, duas réplicas podem
> tentar migrar ao mesmo tempo.

### 2.3 Vercel (frontend)

1. **Add New → Project** → importar o repositório.
2. Configurar:

| Campo            | Valor                            |
| ---------------- | -------------------------------- |
| Root Directory   | `frontend`                       |
| Framework Preset | Vite                             |
| Build Command    | `pnpm build`                     |
| Output Directory | `dist`                           |
| Install Command  | `pnpm install --frozen-lockfile` |

3. Definir `VITE_API_BASE_URL` com a URL pública da API, incluindo o sufixo
   `/api/v1`.
4. Fazer o deploy.

### 2.4 Fechar o ciclo do CORS

O Render não sabe a URL da Vercel antes de ela existir. A ordem é:

1. Publicar a API com `CORS_ORIGINS` apontando para `http://localhost:5173`
   (temporário).
2. Publicar o frontend na Vercel e copiar a URL gerada.
3. Voltar ao Render, atualizar `CORS_ORIGINS` com a URL real e reimplantar.
4. Abrir o front em uma **janela anônima** e conferir no console que não há erro
   de CORS.

O passo 3 é obrigatório. Uma API com `CORS_ORIGINS=*` funcionaria, e é
justamente por isso que ela não é usada: em produção, a origem precisa ser
declarada.

### 2.5 Verificação pós-deploy

```bash
# A API responde e o banco está acessível?
curl -sS -o /dev/null -w "%{http_code}\n" https://<servico>.onrender.com/api/v1/health/ready

# O CORS libera a origem do front?
curl -sS -I -X OPTIONS https://<servico>.onrender.com/api/v1/incidents \
  -H "Origin: https://<projeto>.vercel.app" \
  -H "Access-Control-Request-Method: GET"

# A listagem devolve dados de demonstração?
curl -sS "https://<servico>.onrender.com/api/v1/incidents?limit=1"
```

Os três comandos cobrem as três falhas mais comuns: API fora do ar, CORS
mal configurado e banco sem dados.

## 3. Variáveis de ambiente

### 3.1 Backend (Render)

| Variável                            | Valor em produção                        | Observação                                                                                 |
| ----------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------ |
| `ENVIRONMENT`                       | `production`                             | Muda nível de log e política de CORS.                                                      |
| `DATABASE_URL`                      | `postgresql+psycopg://…?sslmode=require` | Do Neon, endpoint com `-pooler` para a aplicação.                                          |
| `CORS_ORIGINS`                      | `https://<projeto>.vercel.app`           | Lista separada por vírgula. Nunca `*`.                                                     |
| `LOG_LEVEL`                         | `INFO`                                   | `DEBUG` só em investigação pontual.                                                        |
| `RATE_LIMIT_ENABLED`                | `true`                                   | Desligar só para rodar carga local.                                                        |
| `RATE_LIMIT_READ_PER_MINUTE`        | `60`                                     | Leituras por cliente.                                                                      |
| `RATE_LIMIT_WRITE_PER_MINUTE`       | `20`                                     | Escritas por cliente.                                                                      |
| `DB_STATEMENT_TIMEOUT_MS`           | `5000`                                   | Teto por **consulta**; cancelada com SQLSTATE `57014`.                                     |
| `DB_IDLE_TRANSACTION_TIMEOUT_MS`    | `10000`                                  | Teto com a **transação ociosa**: libera locks de worker interrompido.                      |
| `RETRY_MAX_ATTEMPTS`                | `3`                                      | Retry interno, contando a primeira tentativa.                                              |
| `RETRY_BASE_DELAY_SECONDS`          | `1.0`                                    | Teto do backoff da primeira espera; dobra até 8s.                                          |
| `CIRCUIT_BREAKER_ENABLED`           | `true`                                   | Desligar só para observar a falha crua.                                                    |
| `CIRCUIT_BREAKER_FAILURE_THRESHOLD` | `5`                                      | Falhas consecutivas que abrem o circuito.                                                  |
| `CIRCUIT_BREAKER_COOLDOWN_SECONDS`  | `30.0`                                   | Espera antes da sondagem de recuperação.                                                   |
| `CACHE_TTL_SECONDS`                 | `30`                                     | TTL da listagem com _stale-while-revalidate_.                                              |
| `SEED_ON_STARTUP`                   | `false`                                  | Dados de demonstração são carregados uma vez, pelo `initialDeployHook`, não a cada deploy. |

### 3.2 Frontend (Vercel)

| Variável            | Valor                                   | Observação                 |
| ------------------- | --------------------------------------- | -------------------------- |
| `VITE_API_BASE_URL` | `https://<servico>.onrender.com/api/v1` | Precisa incluir `/api/v1`. |

No Vite, variáveis `VITE_*` são **embutidas no bundle em tempo de build**. Isso
tem duas consequências diretas:

1. Segredo nenhum pode ter prefixo `VITE_` — ele estaria no JavaScript servido
   ao navegador.
2. Alterar `VITE_API_BASE_URL` exige **novo deploy**, não apenas reiniciar o
   serviço. Editar a variável sem _redeploy_ deixa o bundle antigo no ar.

### 3.3 Banco (Neon)

| Item                   | Valor                                           |
| ---------------------- | ----------------------------------------------- |
| SSL                    | Obrigatório (`sslmode=require`).                |
| Endpoint da aplicação  | **Direto** (sem `-pooler`) — ver a nota abaixo. |
| Endpoint das migrações | Direto (sem `-pooler`)                          |

> **O endpoint com `-pooler` não serve para esta aplicação.** O PgBouncer do Neon
> recusa o parâmetro de _startup_ que o driver envia:
> `unsupported startup parameter in options: statement_timeout`. A aplicação usa
> o endpoint **direto** nos dois casos. O caminho pooled foi medido e descartado —
> não é preferência, é incompatibilidade.

## 4. AWS — a arquitetura em uso

> **Esta seção foi reescrita.** Até a entrega da Onda 1, a AWS era o caminho
> alternativo e a Render era o escolhido. **A decisão mudou:** o produto roda em
> AWS, e a Render saiu do caminho. O que está descrito abaixo é o que está no ar,
> não uma hipótese.
>
> O detalhamento — decisões, custo medido item a item, automação de deploy e o
> que deu errado no caminho — está em [`12-deploy-aws.md`](12-deploy-aws.md).

### 4.1 Arquitetura

```mermaid
flowchart LR
    U["Navegador"] --> CF["CloudFront<br/>PriceClass_100"]
    CF -->|OAC| S3[("S3<br/>build estático do Vite")]
    CF -->|"Function URL"| LM["Lambda<br/>container FastAPI + Mangum"]
    LM -->|"5432, TLS"| NEON[("Neon PostgreSQL<br/>fora da AWS")]
```

**A peça que mudou o desenho foi o banco.** O plano original previa RDS numa
subnet privada, o que arrasta VPC, _security groups_, Secrets Manager e RDS Proxy
— e um NAT Gateway de US$ 32,85/mês só para a Lambda alcançar o banco. Mantendo o
Neon (que já existia e é gratuito), a Lambda roda **fora de VPC**, sem NAT, sem
RDS e sem Secrets Manager. O custo medido caiu para **US$ 0,023/mês**.

### 4.2 Componentes

| Camada            | Serviço AWS                  | Configuração                                                                       |
| ----------------- | ---------------------------- | ---------------------------------------------------------------------------------- |
| Frontend estático | **S3 + CloudFront**          | Bucket privado, acesso só via Origin Access Control. Invalidação de cache no deploy. |
| API               | **Lambda (imagem) + Function URL** | FastAPI adaptada com Mangum. 1.024 MB, timeout de 30 s, fora de VPC.           |
| Imagem            | **ECR**                      | Base `public.ecr.aws/lambda/python:3.12` — a única que traz o `aws-lambda-ric`.      |
| Banco             | **Neon PostgreSQL**          | Fora da AWS. Endpoint direto, TLS obrigatório.                                     |
| Segredos          | **Variáveis de ambiente da função** | `DATABASE_URL` e `AUTH_SECRET_KEY`, injetadas na criação da função.          |
| Observabilidade   | **CloudWatch Logs**          | Retenção de 14 dias. Log estruturado JSON já emitido em `stdout`.                  |
| Deploy            | **GitHub Actions + OIDC**    | Sem segredo de longa duração no repositório. Ver [`12-deploy-aws.md`](12-deploy-aws.md). |

### 4.3 Por que a Lambda não entra em VPC

É a decisão que mais economiza e a que mais surpreende.

Lambda escala a zero e não mantém estado entre invocações: cada _cold start_ abre
uma conexão nova com o banco. Com RDS numa subnet privada, isso obrigaria a
função a entrar na VPC — e **função em VPC não tem rota para a internet sem NAT
Gateway**, que custa US$ 32,85/mês, mais que todo o resto somado.

Mantendo o Neon como serviço externo, a função fica fora de VPC, alcança o banco
pela internet com TLS e usa `NullPool` no SQLAlchemy — cada invocação abre e fecha
a sua conexão, e o pool fica do lado do Neon. Foi verificado no recurso publicado:
`VpcConfig` é `null`.

### 4.4 Comparação das opções de hospedagem

| Opção                                        | Prós                                                                               | Contras                                                                                  | Veredito                            |
| -------------------------------------------- | ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ----------------------------------- |
| **AWS (S3 + CloudFront + Lambda + Neon)**    | Controle total, IAM, escala a zero, custo medido de US$ 0,023/mês                  | Configuração longa, superfície grande para errar                                          | **Em uso**                          |
| **Render + Vercel + Neon**                   | Free tier real, deploy via GitHub em minutos, Postgres gerenciado, logs acessíveis | Cold start de aproximadamente 30 s no plano gratuito; front nunca subiu (ver nota)         | **Aposentado na Onda 2**            |
| Fly.io                                       | Excelente rede e runtime                                                           | Exige Docker instalado no ambiente de desenvolvimento                                    | Reserva                             |
| Railway                                      | Boa experiência de desenvolvimento                                                 | O free tier deixou de ser generoso                                                       | Reserva                             |
| Hugging Face Spaces                          | Simples para Python                                                                | Feito para demonstração de modelo, não para API REST com Postgres; hiberna                | Descartado                          |
| Replit                                       | Rápido para começar                                                                | Recursos expiram e o ambiente é instável para demo                                        | Descartado                          |
| Vercel Serverless Python                     | Um provedor só                                                                     | Limitações de runtime e cold start no acesso a banco                                     | Descartado                          |

> **Por que a Onda 1 saiu de cena.** O `deploy-aws.yml` publica os dois lados a
> cada merge na `main`, sem intervenção, e o custo é de centavos. Manter duas
> arquiteturas no ar significaria manter duas para sempre — e a que ninguém usa é
> a que quebra sem ninguém ver.

## 5. Troubleshooting

Problemas que aparecem de fato, na ordem em que costumam aparecer.

### 5.1 Cold start do Render free

**Sintoma.** O primeiro acesso depois de um período de inatividade demora
cerca de 30 segundos. O navegador pode mostrar erro de rede antes da resposta
chegar.

**Causa.** O serviço gratuito é suspenso após inatividade e precisa subir de
novo no primeiro acesso.

**Mitigação.**

- Fazer uma requisição de aquecimento (`GET /api/v1/health/live`) antes de
  gravar a demonstração ou de apresentar o produto.
- Manter o timeout do cliente HTTP generoso na primeira carga, para que o front
  não classifique o cold start como erro. Um timeout curto transforma lentidão
  em tela de erro.
- Um monitor de uptime fazendo _ping_ periódico mantém o serviço quente, às
  custas de consumir a cota gratuita.

Como isso é uma característica conhecida da plataforma e não um defeito da
aplicação, a decisão do produto é **explicitar** o comportamento em vez de
esconder: a interface mantém o skeleton enquanto espera, em vez de falhar.

### 5.2 CORS

**Sintoma.** O front carrega, mas a lista fica vazia e o console mostra
`blocked by CORS policy: No 'Access-Control-Allow-Origin' header`.

**Causas comuns, em ordem de frequência.**

| Causa                                                 | Correção                                                                           |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `CORS_ORIGINS` ainda aponta para `localhost:5173`     | Atualizar com a URL real da Vercel e reimplantar a API.                            |
| Origem com barra no final (`https://x.vercel.app/`)   | Remover a barra: a origem, por definição, não a inclui.                            |
| _Preview deployments_ da Vercel em domínio diferente  | Adicionar o domínio de preview à lista, ou testar sempre pelo domínio de produção. |
| `CORS_ORIGINS` precisa ser lista separada por vírgula | Conferir que não há espaço sobrando entre os valores.                              |

**Verificação rápida.** A requisição `OPTIONS` de _preflight_ mostrada na
[seção 2.5](#25-verificação-pós-deploy) responde com
`Access-Control-Allow-Origin` igual à origem enviada? Se não, o problema é
configuração, não código.

`CORS_ORIGINS=*` faria tudo funcionar e **não é a correção**. Em produção, ela
remove a única barreira que impede um site qualquer de chamar esta API a partir
do navegador do usuário.

### 5.3 SSL do PostgreSQL

**Sintoma.** `FATAL: no pg_hba.conf entry for host …, SSL off`, ou
`SSL connection has been closed unexpectedly`, ou ainda
`server does not support SSL, but SSL was required`.

**Causa.** O Neon exige TLS. A string copiada do painel pode vir sem
`sslmode=require`, ou com o driver errado no prefixo.

**Correções.**

```dotenv
# correto, com driver psycopg 3 e SSL obrigatório
DATABASE_URL=postgresql+psycopg://usuario:senha@host/logos?sslmode=require

# errado: driver antigo, sem SSL
DATABASE_URL=postgresql://usuario:senha@host/logos
```

| Problema                        | Detalhe                                                                                                                     |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Driver errado                   | O projeto usa `psycopg[binary]` (psycopg 3); o prefixo precisa ser `postgresql+psycopg://`, e não `postgresql+psycopg2://`. |
| Senha com caracteres especiais  | `@`, `:` e `/` precisam de _percent-encoding_ na URL.                                                                       |
| Migração falhando pelo _pooler_ | Usar o endpoint direto (sem `-pooler`) para `alembic upgrade head`.                                                         |
| IPv6                            | O endpoint direto do Neon pode resolver em IPv6; em redes que não suportam, usar o endpoint _pooled_, que oferece IPv4.     |

### 5.4 `$PORT` do Render

**Sintoma.** O deploy "tem sucesso" mas o serviço responde `502`, e o log do
Render registra que nenhuma porta aberta foi detectada.

**Causa.** O Render injeta a porta em `$PORT` e espera que a aplicação escute
nela. Fixar `--port 8000` faz a aplicação subir em uma porta que a plataforma
não está monitorando.

**Correção.**

```bash
# correto
uvicorn app.main:app --host 0.0.0.0 --port $PORT
```

Dois detalhes andam junto:

- `--host 0.0.0.0` é obrigatório. Com `127.0.0.1`, a aplicação só aceita
  conexões de dentro do próprio container e a plataforma não a alcança.
- Em imagem de container, use uma forma que tenha valor padrão para
  desenvolvimento local:

```dockerfile
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
```

### 5.5 Schema não aplicado no banco

**Sintoma.** `GET /health/ready` responde `503`, ou a listagem devolve
`ProgrammingError: relation "incidents" does not exist`.

**Causa.** O deploy publicou o código, mas o schema do banco não foi criado.

**Correção.** Rode as migrações no ambiente publicado:

```bash
alembic upgrade head
```

O `startCommand` do serviço já faz isso antes de subir o `uvicorn`. Em um serviço
configurado sem ele, rode `alembic upgrade head` da sua máquina contra a conexão
**direta** do Neon — o plano gratuito do Render não tem Shell. A regra
operacional vale sempre: **deploy de código que depende de schema novo só
termina depois da migração.**

### 5.6 Lista vazia em produção

**Sintoma.** A API responde `200` com `items: []` e a interface mostra o estado
vazio.

**Causa.** O seed não foi executado no ambiente publicado.

**Correção.** O seed roda sozinho pelo `initialDeployHook` do Blueprint, uma
única vez, após o primeiro deploy bem-sucedido. Em um serviço criado à mão, rode
`python -m app.infra.seed` da sua máquina contra o Neon. Por isso
`SEED_ON_STARTUP` é `false` em produção: semear a cada deploy recriaria dados de
demonstração por cima de dados reais.

### 5.7 SSE bufferizado

**Sintoma.** O stream de eventos não chega, ou chega todo de uma vez depois de
muito tempo, embora o `curl` local mostre os eventos em tempo real.

**Causa.** Proxies e CDNs costumam acumular a resposta até completar um buffer
antes de repassá-la. Sem conteúdo periódico, a conexão fica parada.

**Correção.** O servidor envia um comentário de _heartbeat_ periodicamente, o
que mantém o buffer fluindo e também detecta conexões mortas. Do lado do
cliente, `EventSource` reconecta sozinho; ao reconectar, um `refetch` fecha a
eventual lacuna de eventos perdidos durante a queda.

### 5.8 Variável do front alterada sem efeito

**Sintoma.** `VITE_API_BASE_URL` foi corrigida na Vercel, mas a aplicação
continua chamando a URL antiga.

**Causa.** O Vite embute as variáveis `VITE_*` no bundle durante o build. Não
existe leitura em tempo de execução.

**Correção.** Disparar um novo deploy depois de alterar a variável
(_Redeploy_ com cache de build desabilitado, se necessário).

### 5.9 Banco suspenso no Neon

**Sintoma.** A primeira requisição depois de um período longo devolve `503` ou
demora; as seguintes funcionam.

**Causa.** O Neon suspende a computação após inatividade e a retoma no primeiro
acesso.

**Correção.** Nenhuma no código: o circuit breaker e o retry com jitter já
absorvem esse primeiro acesso. O comportamento esperado é a interface mostrar o
banner de instabilidade e a lista reaparecer em seguida — desde que o
`/health/ready` tenha sido chamado antes de apresentar o produto.

## 6. Reproduzir o ambiente publicado localmente

Quando algo funciona em produção e não localmente (ou o contrário), este é o
caminho mais curto para a diferença aparecer:

```bash
# 1. Banco igual ao de produção (container definido na raiz do projeto)
pnpm db:up

# 2. Backend com as variáveis de produção
cd backend
export ENVIRONMENT=production
export DATABASE_URL="postgresql+psycopg://logos:logos@localhost:5433/logos"
export CORS_ORIGINS="http://localhost:5173"
python -m app.infra.seed
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

A porta do host é a **5433** porque a 5432 costuma estar ocupada por um
PostgreSQL nativo da máquina. Dentro da rede do compose o banco continua na
5432, que é a porta usada pela CI.

```bash
# 3. Frontend com a mesma configuração de API do deploy
cd frontend
echo "VITE_API_BASE_URL=http://localhost:8000/api/v1" > .env
pnpm dev --host
```

Rodar o front com `--host` é o detalhe que reproduz o cenário real: o navegador
passa a acessar a aplicação por IP de rede, e não por `localhost`, o que é
exatamente o que faz aparecer metade dos problemas de CORS.

## 7. Checklist de publicação

- [ ] `GET /health/ready` responde `200` no ambiente publicado.
- [ ] `/docs` abre e lista todos os endpoints.
- [ ] Migrações aplicadas (`alembic upgrade head`) e `alembic_version` no head esperado.
- [ ] Seed carregado.
- [ ] `CORS_ORIGINS` com a URL real do frontend, sem `*` e sem barra final.
- [ ] `VITE_API_BASE_URL` com `/api/v1` e deploy refeito após qualquer alteração.
- [ ] Front acessível em janela anônima, sem erro no console.
- [ ] Tema escuro funcionando em produção.
- [ ] Testado em tela de celular.
- [ ] Rodapé da tela inicial com link do repositório e do vídeo.
