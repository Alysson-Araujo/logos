# Registro de execução

Este documento registra **o que foi construído, em que ordem, com qual
raciocínio e com qual evidência**. Ele não substitui o `README.md` (como rodar),
nem o `docs/04` (como as decisões funcionam). Ele existe para responder a uma
pergunta que a documentação técnica normalmente não responde: _por que cada coisa
está do jeito que está, e como se sabe que funciona._

Cada seção segue o mesmo formato: **problema → decisão → evidência → o que
aprendi**. Onde houve erro, o erro está registrado — um registro que só conta
acertos não serve para avaliar nada.

---

## 1. Panorama

| #   | Assunto                                            | PR                                                     | Issue | Resultado                                       |
| --- | -------------------------------------------------- | ------------------------------------------------------ | ----- | ----------------------------------------------- |
| 1   | Separação entre execução real e simulação (`MOCK`) | [#86](https://github.com/Alysson-Araujo/logos/pull/86) | —     | Base do projeto                                 |
| 2   | Reconciliação da documentação com o código         | [#87](https://github.com/Alysson-Araujo/logos/pull/87) | —     | Docs deixam de prometer o que não existe        |
| 3   | PostgreSQL de desenvolvimento em container         | [#89](https://github.com/Alysson-Araujo/logos/pull/89) | #88   | `pnpm db:up` sobe o banco                       |
| 4   | Schema versionado com Alembic                      | [#90](https://github.com/Alysson-Araujo/logos/pull/90) | #11   | Migrações versionadas, `create_all` removido    |
| 5   | `Idempotency-Key` nas mutações                     | [#91](https://github.com/Alysson-Araujo/logos/pull/91) | #22   | Reenvio não duplica incidente                   |
| 6   | Rate limit e cabeçalhos de segurança               | [#92](https://github.com/Alysson-Araujo/logos/pull/92) | #33   | Teto por cliente, `429` com `Retry-After`       |
| 7   | Retentativa com backoff e jitter                   | [#93](https://github.com/Alysson-Araujo/logos/pull/93) | #27   | Falha transitória não vira erro para o analista |
| 8   | Disjuntor de banco                                 | [#94](https://github.com/Alysson-Araujo/logos/pull/94) | #29   | Falha rápido: 21 s → 10 ms                      |
| 9   | Cache com _stale-while-revalidate_                 | [#95](https://github.com/Alysson-Araujo/logos/pull/95) | #30   | Lista continua na tela durante a queda          |

Estado ao final: **211 arquivos**, **16 commits** na `main`, **65 issues abertas**,
cobertura de **93%** com 218 testes verdes em SQLite e PostgreSQL.

---

## 2. Fundação: container e migrações

### 2.1 Banco em container

**Problema.** O case precisa rodar na máquina de quem avalia. Um PostgreSQL
instalado à mão é o tipo de pré-requisito que faz a avaliação parar antes de
começar.

**Decisão.** `compose.yaml` como fonte única, com o banco em `postgres:16-alpine`.
O container expõe a porta **5433**, não 5432: a máquina já tinha um PostgreSQL
nativo na porta padrão, e disputar porta é um erro que só aparece na hora errada.

**O que deu errado.**

- `podman compose` falhou com _"looking up compose provider failed"_ — não havia
  provider instalado. Resolvido com um `podman-compose.cmd` no diretório de
  scripts do usuário, porque o `C:\Python312\Scripts` é somente leitura.
- `pnpm db:reset` não apagava o volume: `down -v` ignora volumes declarados com
  `name:` no compose. Corrigido com um `podman volume rm -f` explícito.
- O `HEALTHCHECK` no `Dockerfile` era ignorado no formato OCI. Movido para o
  `compose.yaml`, que é onde o orquestrador o lê.

### 2.2 Migrações com Alembic

**Problema.** A aplicação criava o schema com `Base.metadata.create_all`. Isso
funciona até a primeira alteração de coluna em produção — e aí não há caminho.

**Decisão.** Alembic como único caminho de criação de schema. `create_all` foi
**removido**, e a aplicação agora verifica se a migração foi aplicada antes de
servir tráfego:

```python
REQUIRED_TABLE = "incidents"
# se a tabela não existe, RuntimeError com o comando exato:
#   cd backend && alembic upgrade head
```

A escolha de _falhar com instrução_ em vez de _criar a tabela_ é deliberada: um
processo que conserta o schema sozinho esconde o fato de que a migração não
rodou — e o conserto silencioso aparece como divergência entre ambientes meses
depois.

**Evidência.** `alembic check` sem divergências, migração `0002` aplicada em
desenvolvimento e no banco de teste, e um passo do CI que roda `alembic upgrade
head` seguido de `alembic check`. A suíte de testes usa as migrações de verdade
em vez de `create_all`, então uma migração quebrada falha no CI.

---

## 3. `Idempotency-Key` — issue #22

**Problema.** A rede oscila, o cliente não sabe se a requisição chegou e
reenvia. Sem proteção, o reenvio cria um **segundo incidente**: uma ocorrência
fantasma na fila, com placa e local repetidos, e alguém liga para o mesmo
motorista duas vezes.

**Decisão.** A chave é a **chave primária** da tabela `idempotency_keys`. Quem
impede duas execuções simultâneas é a restrição de unicidade do banco, e não um
`if` em Python — então a garantia vale com múltiplos workers, exatamente como o
compare-and-swap do lock otimista.

| Situação                      | Resposta                                                      |
| ----------------------------- | ------------------------------------------------------------- |
| Chave nova                    | Executa e guarda a resposta                                   |
| Mesma chave, mesmo corpo      | Devolve a resposta original, com `Idempotency-Replayed: true` |
| Mesma chave, corpo diferente  | `409 IDEMPOTENCY_KEY_REUSED`                                  |
| Mesma chave ainda em execução | `409 IDEMPOTENCY_KEY_IN_PROGRESS`                             |

**Evidência (teste ao vivo, contra a API real):**

```
1a tentativa : HTTP 201  code=INC-2026-000121  id=58222a97-…
2a tentativa : HTTP 201  Replayed=true  code=INC-2026-000121  id=58222a97-…
3a tentativa : HTTP 409  (mesma chave, corpo diferente)

incidentes antes: 121   depois: 121   criados: 0
```

**Dois defeitos encontrados no caminho:**

1. **Erro que levanta exceção não liberava a chave.** O `422` de validação e o
   `409` do lock otimista sobem como exceção, então o registro da resposta nunca
   rodava e a chave ficava presa como "em processamento". Na prática: o analista
   corrigia o pedido e esbarrava na própria reserva até ela expirar. Dois testes
   pegaram isso.
2. **O CORS não anunciava `PATCH` nem `PUT`.** Um preflight do navegador
   bloquearia qualquer cliente que usasse esses métodos. Bug latente, que só
   apareceria quando alguém tentasse.

**O que aprendi.** A migração do Alembic entrou **antes** desta issue, e por
isso a tabela nova nasceu com caminho de migração. Na ordem inversa, haveria
dois jeitos de criar schema — e um deles sem volta.

---

## 4. Rate limit e segurança — issue #33

**Problema.** Sem teto de requisições, um cliente em laço — integração mal
configurada, retry sem backoff — ocupa a API inteira. Numa central de resposta a
incidentes isso é grave: o sistema fica indisponível justamente durante a
ocorrência que ele existe para tratar.

**Decisão.** Janela **deslizante**, não fixa. Com a fixa, o cliente gasta o teto
nos últimos segundos de um minuto e de novo nos primeiros do seguinte — o dobro
do limite em um instante curto. Com a deslizante, o teto vale a qualquer momento
e o `Retry-After` devolvido é o tempo **exato** até a requisição mais antiga sair
da janela.

| Operação                            | Padrão                 |
| ----------------------------------- | ---------------------- |
| Leitura (`GET`, `HEAD`)             | 60 req/min por cliente |
| Escrita (`POST`, `PATCH`, `DELETE`) | 20 req/min por cliente |

**Duas isenções que são detalhe operacional, não conveniência:**

- **`/health/live` e `/health/ready` não consomem cota.** Recusar o healthcheck
  faria a plataforma marcar o serviço como doente e **reiniciar o deploy** — o
  limitador derrubaria o próprio serviço que deveria proteger.
- Preflight de CORS também não, porque não é trabalho da API.

**Evidência (ao vivo, teto de leitura baixado para 3):**

```
Cabeçalhos em 200: nosniff · no-referrer · DENY · Permissions-Policy
                   (HSTS ausente fora de produção, correto)
Health (cota de 3): 5 chamadas, todas 200   ← isento
Estourando a cota:  tentativa 1 → 200
                    tentativa 2 → 429  Retry-After=60
                    tentativa 3 → 429  ...  e nosniff presente no 429
```

**Duas decisões que valem registro:**

1. **O `429` é montado no middleware, não levantando exceção.** Middleware fica
   fora do `ExceptionMiddleware` do Starlette: uma exceção levantada ali viraria
   **`500`** em vez de passar pelos handlers globais.
2. **A ordem dos middlewares é funcional, não estética.**
   `request_context → security_headers → rate_limit → CORS`. O `request_id`
   precisa existir quando o rate limit recusar, para a resposta e o log terem
   correlação; e os cabeçalhos de segurança precisam envolver o limitador para
   valerem no `429`. Há teste para cada uma das duas garantias.

---

## 5. Retentativa com backoff e jitter — issue #27

**Problema.** Parte das falhas de banco não é defeito e não se repete: a conexão
do pool morreu por ociosidade, o banco reiniciou para aplicar um patch, duas
transações se encontraram e uma foi abortada por _deadlock_, o
`statement_timeout` cancelou uma consulta que voltaria na segunda tentativa.
Devolver erro ao analista nesses casos joga fora uma operação que daria certo.

**Decisão — e a parte que importa.** A pergunta "posso repetir?" **não é sobre o
método HTTP, é sobre a operação**:

| Situação                      | Repete?             | Por quê                                                                               |
| ----------------------------- | ------------------- | ------------------------------------------------------------------------------------- |
| Leitura (`GET`)               | ✅ até 3 tentativas | Não muda estado                                                                       |
| Escrita com `Idempotency-Key` | ✅ até 3 tentativas | Guardada por compare-and-swap: a 2ª execução não acha a versão esperada               |
| Escrita sem `Idempotency-Key` | ❌                  | Repetir poderia reaplicar uma decisão humana                                          |
| `POST /incidents` (`INSERT`)  | ❌ **sempre**       | Sem guarda natural: repetir após um commit não visto criaria um **segundo incidente** |

O `INSERT` é o caso que justifica a terceira regra. Um `POST` que falhou depois
de um commit que o cliente não viu é indistinguível de um que não chegou;
repetir criaria uma ocorrência fantasma na fila. Aí a API devolve `503` e quem
reenvia é o cliente, com a mesma chave — que é exatamente o papel da idempotência
no nível HTTP, entregue na issue #22.

**Backoff.** Teto dobra a cada tentativa — 1 s, 2 s, 4 s, saturando em 8 s — e a
espera é sorteada dentro do teto (jitter completo). O sorteio não é enfeite:
quando o banco volta, todos os clientes bloqueados tentam reconectar no mesmo
instante e derrubam o banco de novo.

**A classificação é por código, não por texto.** SQLSTATE `40001`, `40P01`,
`55P03`, `57014` e a família `08`, mais `OperationalError`, `DisconnectionError`
e `TimeoutError`. Violação de constraint é determinística: repetir devolveria o
mesmo erro, com o custo somado.

**Duas decisões de implementação:**

1. **A retentativa envolve a unidade de trabalho inteira**, não cada consulta.
   Repetir uma consulta isolada deixaria a operação pela metade, com parte das
   escritas aplicada. Entre tentativas a sessão recebe `rollback()`.
2. **O marcador de "requisição reenviável" é um `ContextVar`.** Quem lê o
   cabeçalho é o middleware (contexto assíncrono); quem decide a retentativa é o
   serviço, que roda em thread do pool. O `anyio` copia o contexto, então o
   serviço decide sem conhecer HTTP.

---

## 6. Disjuntor de banco — issue #29

**Problema.** Quando o banco fica lento, cada requisição espera o timeout
inteiro antes de falhar. Com o pool ocupado por requisições condenadas, o serviço
inteiro trava. E a retentativa da issue anterior, **sem interruptor, trabalha
contra**: três tentativas por requisição multiplicam a carga justamente quando o
banco está pior.

**Decisão.** `CLOSED → OPEN → HALF_OPEN`, com três escolhas que valem registro:

1. **Uma sondagem de cada vez.** Vencido o cooldown, o circuito autoriza **uma**
   requisição. Liberar tráfego em massa para um banco que talvez não tenha
   voltado o derrubaria de novo — seria o disjuntor causando a segunda queda.
2. **A sonda que falha reabre na hora**, sem esperar o limiar de novo: o banco já
   provou que não voltou.
3. **Falha é a unidade de trabalho, não a tentativa interna.** Cinco requisições
   que falharam, e não as quinze tentativas de cinco requisições — assim o limiar
   não muda de significado quando alguém ajusta a política de retentativa.

**Erro de negócio não conta como falha.** Um `404` que chega rápido prova que o
banco respondeu; contá-lo como doença faria o circuito abrir por causa de tráfego
normal. E o `/health/live` continua respondendo com o circuito aberto: se ele
caísse junto, a plataforma reiniciaria o serviço, o que não conserta o banco e
ainda derruba o processo que estava de pé.

### O achado que mudou o escopo desta issue

Fui testar com o container do banco **realmente parado** — e a requisição não
devolveu `503`. **Ficou pendurada por mais de doze minutos.**

O engine não configurava `connect_timeout`, e o padrão do driver é **zero:
esperar para sempre**. Sem timeout de conexão, o disjuntor **não tem o que
contar**: nenhuma falha chega ao contador, o circuito nunca abre, e o resultado é
exatamente a fila de timeouts que ele deveria evitar. O código estava certo, os
testes passavam, e o critério de aceite "falhar rápido" era **inatingível**.

| Momento                               | Antes                  | Depois                               |
| ------------------------------------- | ---------------------- | ------------------------------------ |
| 1ª requisição                         | pendurada **> 12 min** | `503` em 21,2 s                      |
| 2ª requisição                         | —                      | `503` em 20,8 s _(abre o circuito)_  |
| 3ª requisição                         | —                      | `503` em **10 ms**, `Retry-After: 5` |
| `/health/live` e `/meta/enums`        | —                      | `200` em 38 ms                       |
| Após o cooldown, com o banco de volta | —                      | `200` em 157 ms                      |

**21.250 ms → 10 ms.** O `connect_timeout` é por **conexão** e entrou nesta
issue; o `statement_timeout`, por **consulta**, continua na #28. A distinção está
registrada em `docs/04` para não se perder.

**O que aprendi.** Se eu tivesse me contentado com os testes de integração —
que passavam — teria entregue um disjuntor que não protege nada. Foi o teste
manual com o cenário real que expôs o problema. Teste que simula a falha no
lugar certo nem sempre simula a falha que importa.

---

## 7. Cache com _stale-while-revalidate_ — issue #30

**Problema.** Durante uma degradação do banco, a tela de triagem esvazia: o
analista perde a lista justamente quando precisa dela. Só que, para triagem, um
dado de trinta segundos atrás é **utilizável** — o que não é utilizável é a tela
de erro.

**Decisão.** A listagem fica em cache por um TTL curto, com o estado exposto no
cabeçalho `X-Cache-Status`:

| Estado        | Quando                          | O que acontece                                  |
| ------------- | ------------------------------- | ----------------------------------------------- |
| `MISS`        | Não havia cópia                 | Vem do banco e passa a ser guardada             |
| `HIT`         | Dentro do TTL                   | Resposta imediata, sem tocar no banco           |
| `REVALIDATED` | TTL vencido, banco respondendo  | Busca, atualiza e responde com o dado novo      |
| `STALE`       | TTL vencido, banco indisponível | Serve a cópia antiga, **marcada como defasada** |

**Quatro decisões que valem registro:**

- **A chave é o pedido inteiro** — filtros, ordenação, limite e cursor. Servir a
  página de um filtro para outro entregaria dado errado com aparência de certo,
  que é o pior tipo de erro de cache, porque não parece erro.
- **Toda mutação bem-sucedida esvazia o cache.** Invalidar só a chave afetada
  exigiria saber quais combinações de filtro incluem o registro alterado; errar
  isso **esconderia a mudança** de quem olha a lista. Um cache frio custa uma
  consulta a mais; um cache errado custa a confiança no painel.
- **O "em segundo plano" é adiado, não concorrente.** A revalidação não roda em
  thread própria: quem revalida é a próxima requisição que encontrar o banco de
  volta. O efeito para quem usa é o mesmo — a tela não espera por uma
  revalidação que provavelmente vai falhar —, sem gerenciar threads, filas e
  erros que ninguém observa.
- **Sem cópia guardada, o `503` sobe.** Devolver lista vazia seria mentir sobre o
  estado do sistema: "não há incidentes" e "não consigo ler os incidentes" são
  coisas diferentes, e confundi-las numa central de incidentes é perigoso.

### O defeito que o teste pegou

A primeira versão só servia a cópia quando o disjuntor **já estava aberto**. Isso
deixava um furo: a requisição que _acabava de_ derrubar o banco recebia o erro
cru (`503`) em vez da cópia, porque o circuito ainda estava fechado quando ela
começou. Ou seja: a **primeira** requisição durante a queda mostraria tela de
erro tendo cache — exatamente o que a issue existe para evitar.

Corrigido reconhecendo a degradação por **dois** caminhos: o circuito aberto e a
falha transitória que acabou de abri-lo. Erro de cliente, como cursor inválido,
não conta como degradação: servir dado antigo para um pedido malformado
esconderia o defeito.

---

## 8. Achados que atravessam as issues

| Achado                                               | Impacto                                                       | Onde ficou registrado          |
| ---------------------------------------------------- | ------------------------------------------------------------- | ------------------------------ |
| `create_all` criava schema fora do Alembic           | Divergência entre ambientes sem volta                         | `app/core/database.py`, PR #90 |
| `conftest` forçava SQLite                            | O job de PostgreSQL do CI testava SQLite — **falso positivo** | `tests/conftest.py`            |
| Sem `connect_timeout`                                | Requisição pendurava > 12 min; disjuntor inoperante           | `app/core/database.py`, PR #94 |
| Documentação descrevia rate limit por _token bucket_ | Descrevia algo que o código não fazia                         | `docs/04`, PR #92              |
| Documentação citava `test_backoff.py`                | Arquivo inexistente                                           | `docs/07`, PR #93              |
| `#<número>` no corpo do commit                       | Quebrava o `commitlint` (`footer-leading-blank`)              | `CONTRIBUTING.md` §4.5         |
| Documentação citava `RATE_LIMIT_PER_MINUTE`          | Variável que nunca existiu                                    | `README.md`, `docs/03`         |

O denominador comum é **documentação escrita antes do código**. Ela é útil como
plano — foi ela que definiu os critérios de aceite —, mas vira mentira se não for
reconciliada a cada issue. Por isso cada PR desta série termina atualizando a
documentação, e não apenas o código.

---

## 9. Erros de processo (meus)

Registrados porque são o tipo de coisa que se repete se não for anotada.

1. **Commitei na `main` em vez de numa branch (issue #33).** Percebi no momento do
   push. Corrigido criando a branch no commit atual e devolvendo a `main` ao
   estado do remoto — nada se perdeu, mas foi falha de processo. A proteção da
   `main` no GitHub bloquearia o push; o que faltou foi o bloqueio local.
2. **Repeti o risco na issue #27**, e desta vez peguei **antes** de commitar: o
   `git status` mostrou a branch `main` com todo o trabalho pronto. A branch foi
   criada antes de qualquer commit.
3. **`connect_timeout` só apareceu no teste manual.** Os 203 testes passavam. Um
   disjuntor que passa em tudo e não protege nada é o pior resultado possível —
   pior que um erro, porque parece pronto.

A partir da #30 o primeiro passo de toda issue é criar a branch, antes de abrir o
editor.

---

## 10. Como verificar o que está aqui

```bash
# Banco e dependências
pnpm db:up                 # PostgreSQL em container na porta 5433

# Qualidade
cd backend
ruff check . && ruff format --check .
mypy app
pytest                     # 218 testes, cobertura ~93%

# Contra PostgreSQL de verdade, e não só SQLite
TEST_DATABASE_URL="postgresql+psycopg://logos:logos@localhost:5433/logos_test" pytest
```

Cada afirmação numérica deste documento sai de um destes comandos, ou de um
teste ao vivo registrado na seção correspondente.
