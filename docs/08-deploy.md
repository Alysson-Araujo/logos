# Deploy

Este documento descreve como publicar o Logos, quais variáveis cada serviço
precisa, como reproduzir o mesmo ambiente em AWS e como resolver os problemas
que realmente aparecem nesse processo.

## 1. Arquitetura de produção

```mermaid
flowchart LR
    U["Navegador da analista"] -->|HTTPS| V["Vercel<br/>build estático do Vite"]
    V -->|"HTTPS + CORS"| R["Render<br/>FastAPI (uvicorn)"]
    R -->|"sslmode=require"| N[("Neon<br/>PostgreSQL serverless")]
    U -.->|"SSE /incidents/stream"| R
```

| Serviço  | Plataforma           | Papel                                                |
| -------- | -------------------- | ---------------------------------------------------- |
| Frontend | Vercel               | Serve o build estático do Vite pela CDN.             |
| API      | Render (Web Service) | Roda o uvicorn com a aplicação FastAPI.              |
| Banco    | Neon                 | PostgreSQL serverless, com _branching_ por ambiente. |

A escolha está justificada no [ADR 0012](adr/0012-render-vercel-neon.md).

## 2. Passo a passo

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

1. **New → Web Service** → conectar o repositório `logos`.
2. Configurar:

| Campo             | Valor                                              |
| ----------------- | -------------------------------------------------- |
| Root Directory    | `backend`                                          |
| Environment       | Python 3                                           |
| Build Command     | `pip install -e .`                                 |
| Start Command     | `uvicorn app.main:app --host 0.0.0.0 --port $PORT` |
| Health Check Path | `/health/ready`                                    |

3. Definir as variáveis de ambiente da [seção 3](#3-variáveis-de-ambiente).
4. Fazer o deploy. O primeiro build pode demorar alguns minutos.
5. O comando de start já aplica as migrações antes de subir o servidor
   (`alembic upgrade head`, no `backend/Dockerfile`). Para popular os dados de
   demonstração, use o **Shell** do próprio Render, que já tem as variáveis
   carregadas:

```bash
alembic upgrade head
python -m app.infra.seed
```

6. Conferir `GET /health/ready` (deve responder `200`) e abrir `/docs`.

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

| Variável                            | Valor em produção                        | Observação                                                                   |
| ----------------------------------- | ---------------------------------------- | ---------------------------------------------------------------------------- |
| `ENVIRONMENT`                       | `production`                             | Muda nível de log e política de CORS.                                        |
| `DATABASE_URL`                      | `postgresql+psycopg://…?sslmode=require` | Do Neon, endpoint com `-pooler` para a aplicação.                            |
| `CORS_ORIGINS`                      | `https://<projeto>.vercel.app`           | Lista separada por vírgula. Nunca `*`.                                       |
| `LOG_LEVEL`                         | `INFO`                                   | `DEBUG` só em investigação pontual.                                          |
| `RATE_LIMIT_ENABLED`                | `true`                                   | Desligar só para rodar carga local.                                          |
| `RATE_LIMIT_READ_PER_MINUTE`        | `60`                                     | Leituras por cliente.                                                        |
| `RATE_LIMIT_WRITE_PER_MINUTE`       | `20`                                     | Escritas por cliente.                                                        |
| `DB_STATEMENT_TIMEOUT_MS`           | `5000`                                   | Query não pode pendurar o worker.                                            |
| `RETRY_MAX_ATTEMPTS`                | `3`                                      | Retry interno, contando a primeira tentativa.                                |
| `RETRY_BASE_DELAY_SECONDS`          | `1.0`                                    | Teto do backoff da primeira espera; dobra até 8s.                            |
| `CIRCUIT_BREAKER_ENABLED`           | `true`                                   | Desligar só para observar a falha crua.                                      |
| `CIRCUIT_BREAKER_FAILURE_THRESHOLD` | `5`                                      | Falhas consecutivas que abrem o circuito.                                    |
| `CIRCUIT_BREAKER_COOLDOWN_SECONDS`  | `30.0`                                   | Espera antes da sondagem de recuperação.                                     |
| `CACHE_TTL_SECONDS`                 | `30`                                     | TTL da listagem com _stale-while-revalidate_.                                |
| `SEED_ON_STARTUP`                   | `false`                                  | Dados de demonstração são carregados uma vez, pelo Shell, não a cada deploy. |

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

| Item                   | Valor                            |
| ---------------------- | -------------------------------- |
| SSL                    | Obrigatório (`sslmode=require`). |
| Endpoint da aplicação  | Pooled (`…-pooler.…`)            |
| Endpoint das migrações | Direto (sem `-pooler`)           |

## 4. Caminho alternativo em AWS

Esta seção descreve como replicar o mesmo produto em AWS. Ela existe porque a
escolha da plataforma foi uma **decisão**, e decisão sem alternativa descrita é
preferência.

### 4.1 Arquitetura

```mermaid
flowchart LR
    U["Navegador"] --> CF["CloudFront<br/>+ certificado ACM"]
    CF -->|OAC| S3[("S3<br/>build estático do Vite")]
    CF -->|"/api/*"| AR["App Runner<br/>container FastAPI"]
    AR -->|"5432, subnet privada"| RDS[("RDS PostgreSQL<br/>db.t4g.micro")]
    AR --> SM["Secrets Manager<br/>DATABASE_URL"]
```

### 4.2 Componentes

| Camada            | Serviço AWS                  | Configuração                                                                                        |
| ----------------- | ---------------------------- | --------------------------------------------------------------------------------------------------- |
| Frontend estático | **S3 + CloudFront**          | Bucket privado, acesso apenas via CloudFront Origin Access Control. Invalidação de cache no deploy. |
| API (opção A)     | **App Runner**               | Build de container; escala automática; health check em `/health/ready`. Mais próximo do Render.     |
| API (opção B)     | **Lambda + API Gateway**     | FastAPI adaptada com Mangum; escala a zero, com cold start por requisição.                          |
| Banco             | **RDS PostgreSQL**           | `db.t4g.micro`, subnet privada, sem IP público, acesso restrito ao _security group_ da API.         |
| Segredos          | **Secrets Manager**          | `DATABASE_URL` e demais valores sensíveis, injetados como variável de ambiente.                     |
| Observabilidade   | **CloudWatch Logs + Alarms** | Log estruturado JSON já enviado por `stdout`, com alarme de taxa de `5xx`.                          |

### 4.3 Por que a opção B exige cuidado extra

Lambda escala a zero e não mantém estado entre invocações. Com PostgreSQL, isso
significa que cada _cold start_ abre uma conexão nova — e um pico de invocações
paralelas pode esgotar o limite de conexões do RDS. A mitigação não é aumentar o
pool: é usar **RDS Proxy** (que multiplexa conexões) e `NullPool` no
SQLAlchemy, deixando o proxy fazer o trabalho de pool. Sem isso, o padrão
"serverless + banco relacional" falha no primeiro pico real.

### 4.4 Comparação das opções de hospedagem

| Opção                                        | Prós                                                                               | Contras                                                                                  | Veredito                          |
| -------------------------------------------- | ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | --------------------------------- |
| **Render + Vercel + Neon**                   | Free tier real, deploy via GitHub em minutos, Postgres gerenciado, logs acessíveis | Cold start de aproximadamente 30 s no plano gratuito                                     | **Escolhido**                     |
| **AWS (S3 + CloudFront + App Runner + RDS)** | Controle total, IAM, escalabilidade real, RDS Proxy                                | Configuração longa, custo não trivial, muito mais superfície para errar no prazo do case | Alternativa descrita, não adotada |
| Fly.io                                       | Excelente rede e runtime                                                           | Exige Docker instalado no ambiente de desenvolvimento                                    | Reserva                           |
| Railway                                      | Boa experiência de desenvolvimento                                                 | O free tier deixou de ser generoso                                                       | Reserva                           |
| Hugging Face Spaces                          | Simples para Python                                                                | Feito para demonstração de modelo, não para API REST com Postgres; hiberna               | Descartado                        |
| Replit                                       | Rápido para começar                                                                | Recursos expiram e o ambiente é instável para demo                                       | Descartado                        |
| Vercel Serverless Python                     | Um provedor só                                                                     | Limitações de runtime e cold start no acesso a banco                                     | Descartado                        |

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

O comando de start definido no `backend/Dockerfile` já faz isso antes de subir o
`uvicorn`. Em um serviço configurado sem ele, use o **Shell** do Render, que já
tem as variáveis carregadas. A regra operacional vale sempre: **deploy de código
que depende de schema novo só termina depois da migração.**

### 5.6 Lista vazia em produção

**Sintoma.** A API responde `200` com `items: []` e a interface mostra o estado
vazio.

**Causa.** O seed não foi executado no ambiente publicado.

**Correção.** Rodar `python -m app.infra.seed` no Shell do Render, uma única
vez. Por isso `SEED_ON_STARTUP` é `false` em produção: semear a cada deploy
recriaria dados de demonstração por cima de dados reais.

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
