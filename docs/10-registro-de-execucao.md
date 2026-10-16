# Registro de execuÃ§Ã£o

Este documento registra **o que foi construÃ­do, em que ordem, com qual
raciocÃ­nio e com qual evidÃªncia**. Ele nÃ£o substitui o `README.md` (como rodar),
nem o `docs/04` (como as decisÃµes funcionam). Ele existe para responder a uma
pergunta que a documentaÃ§Ã£o tÃ©cnica normalmente nÃ£o responde: _por que cada coisa
estÃ¡ do jeito que estÃ¡, e como se sabe que funciona._

Cada seÃ§Ã£o segue o mesmo formato: **problema â†’ decisÃ£o â†’ evidÃªncia â†’ o que
aprendi**. Onde houve erro, o erro estÃ¡ registrado â€” um registro que sÃ³ conta
acertos nÃ£o serve para avaliar nada.

---

## 1. Panorama

| #   | Assunto                                            | PR                                                     | Issue | Resultado                                       |
| --- | -------------------------------------------------- | ------------------------------------------------------ | ----- | ----------------------------------------------- |
| 1   | SeparaÃ§Ã£o entre execuÃ§Ã£o real e simulaÃ§Ã£o (`MOCK`) | [#86](https://github.com/Alysson-Araujo/logos/pull/86) | â€”     | Base do projeto                                 |
| 2   | ReconciliaÃ§Ã£o da documentaÃ§Ã£o com o cÃ³digo         | [#87](https://github.com/Alysson-Araujo/logos/pull/87) | â€”     | Docs deixam de prometer o que nÃ£o existe        |
| 3   | PostgreSQL de desenvolvimento em container         | [#89](https://github.com/Alysson-Araujo/logos/pull/89) | #88   | `pnpm db:up` sobe o banco                       |
| 4   | Schema versionado com Alembic                      | [#90](https://github.com/Alysson-Araujo/logos/pull/90) | #11   | MigraÃ§Ãµes versionadas, `create_all` removido    |
| 5   | `Idempotency-Key` nas mutaÃ§Ãµes                     | [#91](https://github.com/Alysson-Araujo/logos/pull/91) | #22   | Reenvio nÃ£o duplica incidente                   |
| 6   | Rate limit e cabeÃ§alhos de seguranÃ§a               | [#92](https://github.com/Alysson-Araujo/logos/pull/92) | #33   | Teto por cliente, `429` com `Retry-After`       |
| 7   | Retentativa com backoff e jitter                   | [#93](https://github.com/Alysson-Araujo/logos/pull/93) | #27   | Falha transitÃ³ria nÃ£o vira erro para o analista |
| 8   | Disjuntor de banco                                 | [#94](https://github.com/Alysson-Araujo/logos/pull/94) | #29   | Falha rÃ¡pido: 21 s â†’ 10 ms                      |
| 9   | Cache com _stale-while-revalidate_                 | [#95](https://github.com/Alysson-Araujo/logos/pull/95) | #30   | Lista continua na tela durante a queda          |
| 10  | Timeouts de pool e de consulta                     | [#96](https://github.com/Alysson-Araujo/logos/pull/96) | #28   | Consulta lenta nÃ£o consome o worker             |
| 11  | Timeline de auditoria por incidente                | [#97](https://github.com/Alysson-Araujo/logos/pull/97) | #24   | Toda mudanÃ§a de estado fica registrada          |

Estado ao final: **213 arquivos**, **18 commits** na `main`, **63 issues abertas**,
cobertura de **93%** â€” 230 testes no PostgreSQL; no SQLite, 227 passam e os 3 que
dependem de `statement_timeout` sÃ£o pulados.

---

## 2. FundaÃ§Ã£o: container e migraÃ§Ãµes

### 2.1 Banco em container

**Problema.** O case precisa rodar na mÃ¡quina de quem avalia. Um PostgreSQL
instalado Ã  mÃ£o Ã© o tipo de prÃ©-requisito que faz a avaliaÃ§Ã£o parar antes de
comeÃ§ar.

**DecisÃ£o.** `compose.yaml` como fonte Ãºnica, com o banco em `postgres:16-alpine`.
O container expÃµe a porta **5433**, nÃ£o 5432: a mÃ¡quina jÃ¡ tinha um PostgreSQL
nativo na porta padrÃ£o, e disputar porta Ã© um erro que sÃ³ aparece na hora errada.

**O que deu errado.**

- `podman compose` falhou com _"looking up compose provider failed"_ â€” nÃ£o havia
  provider instalado. Resolvido com um `podman-compose.cmd` no diretÃ³rio de
  scripts do usuÃ¡rio, porque o `C:\Python312\Scripts` Ã© somente leitura.
- `pnpm db:reset` nÃ£o apagava o volume: `down -v` ignora volumes declarados com
  `name:` no compose. Corrigido com um `podman volume rm -f` explÃ­cito.
- O `HEALTHCHECK` no `Dockerfile` era ignorado no formato OCI. Movido para o
  `compose.yaml`, que Ã© onde o orquestrador o lÃª.

### 2.2 MigraÃ§Ãµes com Alembic

**Problema.** A aplicaÃ§Ã£o criava o schema com `Base.metadata.create_all`. Isso
funciona atÃ© a primeira alteraÃ§Ã£o de coluna em produÃ§Ã£o â€” e aÃ­ nÃ£o hÃ¡ caminho.

**DecisÃ£o.** Alembic como Ãºnico caminho de criaÃ§Ã£o de schema. `create_all` foi
**removido**, e a aplicaÃ§Ã£o agora verifica se a migraÃ§Ã£o foi aplicada antes de
servir trÃ¡fego:

```python
REQUIRED_TABLE = "incidents"
# se a tabela nÃ£o existe, RuntimeError com o comando exato:
#   cd backend && alembic upgrade head
```

A escolha de _falhar com instruÃ§Ã£o_ em vez de _criar a tabela_ Ã© deliberada: um
processo que conserta o schema sozinho esconde o fato de que a migraÃ§Ã£o nÃ£o
rodou â€” e o conserto silencioso aparece como divergÃªncia entre ambientes meses
depois.

**EvidÃªncia.** `alembic check` sem divergÃªncias, migraÃ§Ã£o `0002` aplicada em
desenvolvimento e no banco de teste, e um passo do CI que roda `alembic upgrade
head` seguido de `alembic check`. A suÃ­te de testes usa as migraÃ§Ãµes de verdade
em vez de `create_all`, entÃ£o uma migraÃ§Ã£o quebrada falha no CI.

---

## 3. `Idempotency-Key` â€” issue #22

**Problema.** A rede oscila, o cliente nÃ£o sabe se a requisiÃ§Ã£o chegou e
reenvia. Sem proteÃ§Ã£o, o reenvio cria um **segundo incidente**: uma ocorrÃªncia
fantasma na fila, com placa e local repetidos, e alguÃ©m liga para o mesmo
motorista duas vezes.

**DecisÃ£o.** A chave Ã© a **chave primÃ¡ria** da tabela `idempotency_keys`. Quem
impede duas execuÃ§Ãµes simultÃ¢neas Ã© a restriÃ§Ã£o de unicidade do banco, e nÃ£o um
`if` em Python â€” entÃ£o a garantia vale com mÃºltiplos workers, exatamente como o
compare-and-swap do lock otimista.

| SituaÃ§Ã£o                      | Resposta                                                      |
| ----------------------------- | ------------------------------------------------------------- |
| Chave nova                    | Executa e guarda a resposta                                   |
| Mesma chave, mesmo corpo      | Devolve a resposta original, com `Idempotency-Replayed: true` |
| Mesma chave, corpo diferente  | `409 IDEMPOTENCY_KEY_REUSED`                                  |
| Mesma chave ainda em execuÃ§Ã£o | `409 IDEMPOTENCY_KEY_IN_PROGRESS`                             |

**EvidÃªncia (teste ao vivo, contra a API real):**

```
1a tentativa : HTTP 201  code=INC-2026-000121  id=58222a97-â€¦
2a tentativa : HTTP 201  Replayed=true  code=INC-2026-000121  id=58222a97-â€¦
3a tentativa : HTTP 409  (mesma chave, corpo diferente)

incidentes antes: 121   depois: 121   criados: 0
```

**Dois defeitos encontrados no caminho:**

1. **Erro que levanta exceÃ§Ã£o nÃ£o liberava a chave.** O `422` de validaÃ§Ã£o e o
   `409` do lock otimista sobem como exceÃ§Ã£o, entÃ£o o registro da resposta nunca
   rodava e a chave ficava presa como "em processamento". Na prÃ¡tica: o analista
   corrigia o pedido e esbarrava na prÃ³pria reserva atÃ© ela expirar. Dois testes
   pegaram isso.
2. **O CORS nÃ£o anunciava `PATCH` nem `PUT`.** Um preflight do navegador
   bloquearia qualquer cliente que usasse esses mÃ©todos. Bug latente, que sÃ³
   apareceria quando alguÃ©m tentasse.

**O que aprendi.** A migraÃ§Ã£o do Alembic entrou **antes** desta issue, e por
isso a tabela nova nasceu com caminho de migraÃ§Ã£o. Na ordem inversa, haveria
dois jeitos de criar schema â€” e um deles sem volta.

---

## 4. Rate limit e seguranÃ§a â€” issue #33

**Problema.** Sem teto de requisiÃ§Ãµes, um cliente em laÃ§o â€” integraÃ§Ã£o mal
configurada, retry sem backoff â€” ocupa a API inteira. Numa central de resposta a
incidentes isso Ã© grave: o sistema fica indisponÃ­vel justamente durante a
ocorrÃªncia que ele existe para tratar.

**DecisÃ£o.** Janela **deslizante**, nÃ£o fixa. Com a fixa, o cliente gasta o teto
nos Ãºltimos segundos de um minuto e de novo nos primeiros do seguinte â€” o dobro
do limite em um instante curto. Com a deslizante, o teto vale a qualquer momento
e o `Retry-After` devolvido Ã© o tempo **exato** atÃ© a requisiÃ§Ã£o mais antiga sair
da janela.

| OperaÃ§Ã£o                            | PadrÃ£o                 |
| ----------------------------------- | ---------------------- |
| Leitura (`GET`, `HEAD`)             | 60 req/min por cliente |
| Escrita (`POST`, `PATCH`, `DELETE`) | 20 req/min por cliente |

**Duas isenÃ§Ãµes que sÃ£o detalhe operacional, nÃ£o conveniÃªncia:**

- **`/health/live` e `/health/ready` nÃ£o consomem cota.** Recusar o healthcheck
  faria a plataforma marcar o serviÃ§o como doente e **reiniciar o deploy** â€” o
  limitador derrubaria o prÃ³prio serviÃ§o que deveria proteger.
- Preflight de CORS tambÃ©m nÃ£o, porque nÃ£o Ã© trabalho da API.

**EvidÃªncia (ao vivo, teto de leitura baixado para 3):**

```
CabeÃ§alhos em 200: nosniff Â· no-referrer Â· DENY Â· Permissions-Policy
                   (HSTS ausente fora de produÃ§Ã£o, correto)
Health (cota de 3): 5 chamadas, todas 200   â† isento
Estourando a cota:  tentativa 1 â†’ 200
                    tentativa 2 â†’ 429  Retry-After=60
                    tentativa 3 â†’ 429  ...  e nosniff presente no 429
```

**Duas decisÃµes que valem registro:**

1. **O `429` Ã© montado no middleware, nÃ£o levantando exceÃ§Ã£o.** Middleware fica
   fora do `ExceptionMiddleware` do Starlette: uma exceÃ§Ã£o levantada ali viraria
   **`500`** em vez de passar pelos handlers globais.
2. **A ordem dos middlewares Ã© funcional, nÃ£o estÃ©tica.**
   `request_context â†’ security_headers â†’ rate_limit â†’ CORS`. O `request_id`
   precisa existir quando o rate limit recusar, para a resposta e o log terem
   correlaÃ§Ã£o; e os cabeÃ§alhos de seguranÃ§a precisam envolver o limitador para
   valerem no `429`. HÃ¡ teste para cada uma das duas garantias.

---

## 5. Retentativa com backoff e jitter â€” issue #27

**Problema.** Parte das falhas de banco nÃ£o Ã© defeito e nÃ£o se repete: a conexÃ£o
do pool morreu por ociosidade, o banco reiniciou para aplicar um patch, duas
transaÃ§Ãµes se encontraram e uma foi abortada por _deadlock_, o
`statement_timeout` cancelou uma consulta que voltaria na segunda tentativa.
Devolver erro ao analista nesses casos joga fora uma operaÃ§Ã£o que daria certo.

**DecisÃ£o â€” e a parte que importa.** A pergunta "posso repetir?" **nÃ£o Ã© sobre o
mÃ©todo HTTP, Ã© sobre a operaÃ§Ã£o**:

| SituaÃ§Ã£o                      | Repete?             | Por quÃª                                                                               |
| ----------------------------- | ------------------- | ------------------------------------------------------------------------------------- |
| Leitura (`GET`)               | âœ… atÃ© 3 tentativas | NÃ£o muda estado                                                                       |
| Escrita com `Idempotency-Key` | âœ… atÃ© 3 tentativas | Guardada por compare-and-swap: a 2Âª execuÃ§Ã£o nÃ£o acha a versÃ£o esperada               |
| Escrita sem `Idempotency-Key` | âŒ                  | Repetir poderia reaplicar uma decisÃ£o humana                                          |
| `POST /incidents` (`INSERT`)  | âŒ **sempre**       | Sem guarda natural: repetir apÃ³s um commit nÃ£o visto criaria um **segundo incidente** |

O `INSERT` Ã© o caso que justifica a terceira regra. Um `POST` que falhou depois
de um commit que o cliente nÃ£o viu Ã© indistinguÃ­vel de um que nÃ£o chegou;
repetir criaria uma ocorrÃªncia fantasma na fila. AÃ­ a API devolve `503` e quem
reenvia Ã© o cliente, com a mesma chave â€” que Ã© exatamente o papel da idempotÃªncia
no nÃ­vel HTTP, entregue na issue #22.

**Backoff.** Teto dobra a cada tentativa â€” 1 s, 2 s, 4 s, saturando em 8 s â€” e a
espera Ã© sorteada dentro do teto (jitter completo). O sorteio nÃ£o Ã© enfeite:
quando o banco volta, todos os clientes bloqueados tentam reconectar no mesmo
instante e derrubam o banco de novo.

**A classificaÃ§Ã£o Ã© por cÃ³digo, nÃ£o por texto.** SQLSTATE `40001`, `40P01`,
`55P03`, `57014` e a famÃ­lia `08`, mais `OperationalError`, `DisconnectionError`
e `TimeoutError`. ViolaÃ§Ã£o de constraint Ã© determinÃ­stica: repetir devolveria o
mesmo erro, com o custo somado.

**Duas decisÃµes de implementaÃ§Ã£o:**

1. **A retentativa envolve a unidade de trabalho inteira**, nÃ£o cada consulta.
   Repetir uma consulta isolada deixaria a operaÃ§Ã£o pela metade, com parte das
   escritas aplicada. Entre tentativas a sessÃ£o recebe `rollback()`.
2. **O marcador de "requisiÃ§Ã£o reenviÃ¡vel" Ã© um `ContextVar`.** Quem lÃª o
   cabeÃ§alho Ã© o middleware (contexto assÃ­ncrono); quem decide a retentativa Ã© o
   serviÃ§o, que roda em thread do pool. O `anyio` copia o contexto, entÃ£o o
   serviÃ§o decide sem conhecer HTTP.

---

## 6. Disjuntor de banco â€” issue #29

**Problema.** Quando o banco fica lento, cada requisiÃ§Ã£o espera o timeout
inteiro antes de falhar. Com o pool ocupado por requisiÃ§Ãµes condenadas, o serviÃ§o
inteiro trava. E a retentativa da issue anterior, **sem interruptor, trabalha
contra**: trÃªs tentativas por requisiÃ§Ã£o multiplicam a carga justamente quando o
banco estÃ¡ pior.

**DecisÃ£o.** `CLOSED â†’ OPEN â†’ HALF_OPEN`, com trÃªs escolhas que valem registro:

1. **Uma sondagem de cada vez.** Vencido o cooldown, o circuito autoriza **uma**
   requisiÃ§Ã£o. Liberar trÃ¡fego em massa para um banco que talvez nÃ£o tenha
   voltado o derrubaria de novo â€” seria o disjuntor causando a segunda queda.
2. **A sonda que falha reabre na hora**, sem esperar o limiar de novo: o banco jÃ¡
   provou que nÃ£o voltou.
3. **Falha Ã© a unidade de trabalho, nÃ£o a tentativa interna.** Cinco requisiÃ§Ãµes
   que falharam, e nÃ£o as quinze tentativas de cinco requisiÃ§Ãµes â€” assim o limiar
   nÃ£o muda de significado quando alguÃ©m ajusta a polÃ­tica de retentativa.

**Erro de negÃ³cio nÃ£o conta como falha.** Um `404` que chega rÃ¡pido prova que o
banco respondeu; contÃ¡-lo como doenÃ§a faria o circuito abrir por causa de trÃ¡fego
normal. E o `/health/live` continua respondendo com o circuito aberto: se ele
caÃ­sse junto, a plataforma reiniciaria o serviÃ§o, o que nÃ£o conserta o banco e
ainda derruba o processo que estava de pÃ©.

### O achado que mudou o escopo desta issue

Fui testar com o container do banco **realmente parado** â€” e a requisiÃ§Ã£o nÃ£o
devolveu `503`. **Ficou pendurada por mais de doze minutos.**

O engine nÃ£o configurava `connect_timeout`, e o padrÃ£o do driver Ã© **zero:
esperar para sempre**. Sem timeout de conexÃ£o, o disjuntor **nÃ£o tem o que
contar**: nenhuma falha chega ao contador, o circuito nunca abre, e o resultado Ã©
exatamente a fila de timeouts que ele deveria evitar. O cÃ³digo estava certo, os
testes passavam, e o critÃ©rio de aceite "falhar rÃ¡pido" era **inatingÃ­vel**.

| Momento                               | Antes                  | Depois                               |
| ------------------------------------- | ---------------------- | ------------------------------------ |
| 1Âª requisiÃ§Ã£o                         | pendurada **> 12 min** | `503` em 21,2 s                      |
| 2Âª requisiÃ§Ã£o                         | â€”                      | `503` em 20,8 s _(abre o circuito)_  |
| 3Âª requisiÃ§Ã£o                         | â€”                      | `503` em **10 ms**, `Retry-After: 5` |
| `/health/live` e `/meta/enums`        | â€”                      | `200` em 38 ms                       |
| ApÃ³s o cooldown, com o banco de volta | â€”                      | `200` em 157 ms                      |

**21.250 ms â†’ 10 ms.** O `connect_timeout` Ã© por **conexÃ£o** e entrou nesta
issue; o `statement_timeout`, por **consulta**, continua na #28. A distinÃ§Ã£o estÃ¡
registrada em `docs/04` para nÃ£o se perder.

**O que aprendi.** Se eu tivesse me contentado com os testes de integraÃ§Ã£o â€”
que passavam â€” teria entregue um disjuntor que nÃ£o protege nada. Foi o teste
manual com o cenÃ¡rio real que expÃ´s o problema. Teste que simula a falha no
lugar certo nem sempre simula a falha que importa.

---

## 7. Cache com _stale-while-revalidate_ â€” issue #30

**Problema.** Durante uma degradaÃ§Ã£o do banco, a tela de triagem esvazia: o
analista perde a lista justamente quando precisa dela. SÃ³ que, para triagem, um
dado de trinta segundos atrÃ¡s Ã© **utilizÃ¡vel** â€” o que nÃ£o Ã© utilizÃ¡vel Ã© a tela
de erro.

**DecisÃ£o.** A listagem fica em cache por um TTL curto, com o estado exposto no
cabeÃ§alho `X-Cache-Status`:

| Estado        | Quando                          | O que acontece                                  |
| ------------- | ------------------------------- | ----------------------------------------------- |
| `MISS`        | NÃ£o havia cÃ³pia                 | Vem do banco e passa a ser guardada             |
| `HIT`         | Dentro do TTL                   | Resposta imediata, sem tocar no banco           |
| `REVALIDATED` | TTL vencido, banco respondendo  | Busca, atualiza e responde com o dado novo      |
| `STALE`       | TTL vencido, banco indisponÃ­vel | Serve a cÃ³pia antiga, **marcada como defasada** |

**Quatro decisÃµes que valem registro:**

- **A chave Ã© o pedido inteiro** â€” filtros, ordenaÃ§Ã£o, limite e cursor. Servir a
  pÃ¡gina de um filtro para outro entregaria dado errado com aparÃªncia de certo,
  que Ã© o pior tipo de erro de cache, porque nÃ£o parece erro.
- **Toda mutaÃ§Ã£o bem-sucedida esvazia o cache.** Invalidar sÃ³ a chave afetada
  exigiria saber quais combinaÃ§Ãµes de filtro incluem o registro alterado; errar
  isso **esconderia a mudanÃ§a** de quem olha a lista. Um cache frio custa uma
  consulta a mais; um cache errado custa a confianÃ§a no painel.
- **O "em segundo plano" Ã© adiado, nÃ£o concorrente.** A revalidaÃ§Ã£o nÃ£o roda em
  thread prÃ³pria: quem revalida Ã© a prÃ³xima requisiÃ§Ã£o que encontrar o banco de
  volta. O efeito para quem usa Ã© o mesmo â€” a tela nÃ£o espera por uma
  revalidaÃ§Ã£o que provavelmente vai falhar â€”, sem gerenciar threads, filas e
  erros que ninguÃ©m observa.
- **Sem cÃ³pia guardada, o `503` sobe.** Devolver lista vazia seria mentir sobre o
  estado do sistema: "nÃ£o hÃ¡ incidentes" e "nÃ£o consigo ler os incidentes" sÃ£o
  coisas diferentes, e confundi-las numa central de incidentes Ã© perigoso.

### O defeito que o teste pegou

A primeira versÃ£o sÃ³ servia a cÃ³pia quando o disjuntor **jÃ¡ estava aberto**. Isso
deixava um furo: a requisiÃ§Ã£o que _acabava de_ derrubar o banco recebia o erro
cru (`503`) em vez da cÃ³pia, porque o circuito ainda estava fechado quando ela
comeÃ§ou. Ou seja: a **primeira** requisiÃ§Ã£o durante a queda mostraria tela de
erro tendo cache â€” exatamente o que a issue existe para evitar.

Corrigido reconhecendo a degradaÃ§Ã£o por **dois** caminhos: o circuito aberto e a
falha transitÃ³ria que acabou de abri-lo. Erro de cliente, como cursor invÃ¡lido,
nÃ£o conta como degradaÃ§Ã£o: servir dado antigo para um pedido malformado
esconderia o defeito.

---

## 8. Timeouts de pool e de consulta â€” issue #28

**Problema.** Uma consulta patolÃ³gica â€” plano ruim, lock esperando, tabela sem
Ã­ndice â€” consome um worker atÃ© o fim dos tempos. Num pool de tamanho fixo, trÃªs
consultas travadas derrubam a API inteira, e o sintoma aparece **longe da
causa**: "a API estÃ¡ lenta", quando o problema Ã© uma consulta.

**DecisÃ£o.** Dois limites no servidor, aplicados como **opÃ§Ã£o de sessÃ£o**:

| Limite                                | PadrÃ£o | O que resolve                                                              |
| ------------------------------------- | ------ | -------------------------------------------------------------------------- |
| `statement_timeout`                   | 5 s    | Mata a **consulta** que passa do teto. O erro chega como SQLSTATE `57014`. |
| `idle_in_transaction_session_timeout` | 10 s   | Mata a conexÃ£o parada **dentro** de uma transaÃ§Ã£o, liberando os locks.     |

**Por que opÃ§Ã£o de sessÃ£o, e nÃ£o um `SET` depois de conectar.** Um `SET` deixa uma
janela em que a conexÃ£o recÃ©m-aberta ainda nÃ£o tem limite â€” justamente a janela
em que uma consulta travada entra. Como opÃ§Ã£o do servidor, o limite vale desde a
primeira consulta.

**Por que o segundo limite tambÃ©m importa.** O `statement_timeout` cobre o caso
"consulta lenta". Ele **nÃ£o** cobre o caso "worker morreu no meio de uma
transaÃ§Ã£o": a conexÃ£o fica viva, ociosa e **segurando locks**, e os outros
processos esperam por um lock que ninguÃ©m vai soltar. O
`idle_in_transaction_session_timeout` fecha essa porta.

**A combinaÃ§Ã£o com as issues anteriores.** O `57014` jÃ¡ estava classificado como
transitÃ³rio pela retentativa (#27) â€” entÃ£o a consulta que **apenas demorou** ganha
uma segunda tentativa, e a que trava sempre acaba abrindo o disjuntor (#29). Os
trÃªs trabalham juntos: o timeout garante que a falha **acontece**, a retentativa
absorve o blip, e o disjuntor para de tentar quando a falha Ã© persistente.

**EvidÃªncia (contra PostgreSQL 16, com o banco de desenvolvimento):**

```
configurado no app  : statement=5000ms idle=10000ms
aplicado na sessao  : statement=5000ms idle=10000ms   <- chegou ao servidor

consulta que estoura o limite de 0,3s:
  cancelada em      : 0,31s
  SQLSTATE          : 57014
  is_transient      : True   (a retentativa cuida disso)

conexao reutilizada do pool: 5000ms   <- o limite local nao vazou
```

**O que ficou de fora, e por quÃª.** O `lock_timeout` (quanto esperar por um lock
antes de desistir) nÃ£o foi configurado: o `statement_timeout` jÃ¡ limita a espera
total, e um `lock_timeout` menor sÃ³ mudaria **qual** erro aparece â€” o `57014` que
jÃ¡ tratamos em vez do `55P03`, que tambÃ©m jÃ¡ classificamos como transitÃ³rio.
Configurar os dois seria knob a mais sem comportamento novo.

**No SQLite.** O equivalente nÃ£o existe: lÃ¡ o limite Ã© o `PRAGMA busy_timeout`,
que jÃ¡ estava aplicado desde o scaffold. Por isso os testes desta issue sÃ£o
**pulados** no job de SQLite do CI e rodam de verdade no job de PostgreSQL.

---

## 9. Timeline de auditoria â€” issue #24

**Problema.** Sem registro de quem mudou o que e quando, uma decisÃ£o operacional
vira memÃ³ria de quem a tomou. Numa central de incidentes isso importa: depois de
um fechamento questionado, alguÃ©m vai perguntar **quem fechou, quando e com qual
justificativa**.

**O que jÃ¡ existia.** A tabela `incident_events` estava no schema desde a
primeira versÃ£o â€” e **nada escrevia nela**, fora o `clear()` dos testes. Era um
modelo esperando o cÃ³digo: o tipo de coisa que parece pronta na documentaÃ§Ã£o e
nÃ£o estÃ¡.

**DecisÃ£o.** TrÃªs tipos de evento, estÃ¡veis como os cÃ³digos de erro da API:

| Evento           | Quando                   | `fromStatus` / `toStatus` |
| ---------------- | ------------------------ | ------------------------- |
| `CREATED`        | Na criaÃ§Ã£o do incidente  | `null` â†’ `ABERTO`         |
| `STATUS_CHANGED` | Em cada transiÃ§Ã£o aceita | origem â†’ destino          |
| `DELETED`        | No soft delete           | `null` / `null`           |

**O evento Ã© gravado na mesma transaÃ§Ã£o da mudanÃ§a.** NÃ£o hÃ¡ `commit` no registro
do evento, de propÃ³sito: os dois precisam entrar ou falhar juntos. Um evento
Ã³rfÃ£o descreveria uma mudanÃ§a que nÃ£o aconteceu; uma mudanÃ§a sem evento Ã© um
buraco no histÃ³rico â€” exatamente o buraco que a auditoria existe para nÃ£o ter.

**O status de origem Ã© lido antes do compare-and-swap**, na mesma transaÃ§Ã£o: a
instruÃ§Ã£o atÃ´mica nÃ£o tem como devolver o valor anterior. Se alguÃ©m alterar o
incidente entre a leitura e a escrita, o `version = :expected` da prÃ³pria UPDATE
recusa â€” entÃ£o o evento nunca descreve algo que nÃ£o aconteceu.

**A timeline sobrevive ao soft delete.** O detalhe do incidente passa a devolver
`404` depois da remoÃ§Ã£o, mas `GET /incidents/{id}/events` continua respondendo.
Se a timeline sumisse junto, "remover sem apagar o histÃ³rico" seria **falso**.

**Id inexistente devolve `404`, nÃ£o lista vazia.** "NÃ£o existe" e "nÃ£o tem
histÃ³rico" sÃ£o respostas diferentes para quem estÃ¡ investigando.

**EvidÃªncia (ao vivo, contra a API):**

```
criado: INC-2026-000122  versao=1  status=ABERTO
transicao para EM_INVESTIGACAO -> HTTP 200  nova versao=2
transicao para FECHADO         -> HTTP 200  nova versao=3

GET /incidents/{id}/events
  CREATED         -                 -> ABERTO            ator=Roteiro de teste
  STATUS_CHANGED  ABERTO            -> EM_INVESTIGACAO   ator=
  STATUS_CHANGED  EM_INVESTIGACAO   -> FECHADO           ator=

apos o soft delete:
  GET detalhe  -> HTTP 404  (saiu da listagem)
  GET events   -> HTTP 200 com 2 eventos: CREATED, DELETED
```

**Um contrato que a documentaÃ§Ã£o jÃ¡ tinha.** `docs/03` descrevia este endpoint
desde o planejamento, com o corpo `{"items": [...]}`. A primeira versÃ£o do cÃ³digo
devolvia `{"events": [...], "incidentId": ...}` â€” divergÃªncia que sÃ³ apareceu
porque fui conferir a documentaÃ§Ã£o **antes** de commitar. Adotei `items`: Ã©
consistente com a listagem, e `incidentId` era redundante, jÃ¡ que o cliente sabe
de qual incidente pediu a timeline.

**O que ficou de fora.** NÃ£o hÃ¡ paginaÃ§Ã£o na timeline. Um incidente tem poucos
eventos (criaÃ§Ã£o, algumas transiÃ§Ãµes, remoÃ§Ã£o), entÃ£o paginar seria complexidade
sem demanda â€” e a tabela Ã© _append-only_, o que mantÃ©m o conjunto pequeno.

---

## 10. Achados que atravessam as issues

| Achado                                               | Impacto                                                       | Onde ficou registrado          |
| ---------------------------------------------------- | ------------------------------------------------------------- | ------------------------------ |
| `create_all` criava schema fora do Alembic           | DivergÃªncia entre ambientes sem volta                         | `app/core/database.py`, PR #90 |
| `conftest` forÃ§ava SQLite                            | O job de PostgreSQL do CI testava SQLite â€” **falso positivo** | `tests/conftest.py`            |
| Sem `connect_timeout`                                | RequisiÃ§Ã£o pendurava > 12 min; disjuntor inoperante           | `app/core/database.py`, PR #94 |
| DocumentaÃ§Ã£o descrevia rate limit por _token bucket_ | Descrevia algo que o cÃ³digo nÃ£o fazia                         | `docs/04`, PR #92              |
| DocumentaÃ§Ã£o citava `test_backoff.py`                | Arquivo inexistente                                           | `docs/07`, PR #93              |
| `#<nÃºmero>` no corpo do commit                       | Quebrava o `commitlint` (`footer-leading-blank`)              | `CONTRIBUTING.md` Â§4.5         |
| DocumentaÃ§Ã£o citava `RATE_LIMIT_PER_MINUTE`          | VariÃ¡vel que nunca existiu                                    | `README.md`, `docs/03`         |

O denominador comum Ã© **documentaÃ§Ã£o escrita antes do cÃ³digo**. Ela Ã© Ãºtil como
plano â€” foi ela que definiu os critÃ©rios de aceite â€”, mas vira mentira se nÃ£o for
reconciliada a cada issue. Por isso cada PR desta sÃ©rie termina atualizando a
documentaÃ§Ã£o, e nÃ£o apenas o cÃ³digo.

---

## 11. Erros de processo (meus)

Registrados porque sÃ£o o tipo de coisa que se repete se nÃ£o for anotada.

1. **Commitei na `main` em vez de numa branch (issue #33).** Percebi no momento do
   push. Corrigido criando a branch no commit atual e devolvendo a `main` ao
   estado do remoto â€” nada se perdeu, mas foi falha de processo. A proteÃ§Ã£o da
   `main` no GitHub bloquearia o push; o que faltou foi o bloqueio local.
2. **Repeti o risco na issue #27**, e desta vez peguei **antes** de commitar: o
   `git status` mostrou a branch `main` com todo o trabalho pronto. A branch foi
   criada antes de qualquer commit.
3. **`connect_timeout` sÃ³ apareceu no teste manual.** Os 203 testes passavam. Um
   disjuntor que passa em tudo e nÃ£o protege nada Ã© o pior resultado possÃ­vel â€”
   pior que um erro, porque parece pronto.

A partir da #30 o primeiro passo de toda issue Ã© criar a branch, antes de abrir o
editor.

---

## 12. Como verificar o que estÃ¡ aqui

```bash
# Banco e dependÃªncias
pnpm db:up                 # PostgreSQL em container na porta 5433

# Qualidade
cd backend
ruff check . && ruff format --check .
mypy app
pytest                     # 218 testes, cobertura ~93%

# Contra PostgreSQL de verdade, e nÃ£o sÃ³ SQLite
TEST_DATABASE_URL="postgresql+psycopg://logos:logos@localhost:5433/logos_test" pytest
```

Cada afirmaÃ§Ã£o numÃ©rica deste documento sai de um destes comandos, ou de um
teste ao vivo registrado na seÃ§Ã£o correspondente.

---

## 13. Mapa do projeto â€” o que cada parte faz

Para nÃ£o se perder: a funÃ§Ã£o de cada arquivo, em uma linha. A ordem segue o
caminho de uma requisiÃ§Ã£o.

### Backend â€” o caminho de uma requisiÃ§Ã£o

| Arquivo                                   | O que faz                                                                                                                   |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `app/main.py`                             | Monta a aplicaÃ§Ã£o: middlewares **na ordem que importa**, handlers de erro, CORS e lifespan.                                 |
| `app/api/v1/incidents.py`                 | As rotas. Ã‰ onde mora a decisÃ£o do cache (`X-Cache-Status`) e a invalidaÃ§Ã£o por mutaÃ§Ã£o.                                    |
| `app/api/deps.py`                         | Monta o serviÃ§o por requisiÃ§Ã£o, lendo a configuraÃ§Ã£o e o marcador de "requisiÃ§Ã£o reenviÃ¡vel".                               |
| `app/services/incident_service.py`        | Regras de aplicaÃ§Ã£o. Ã‰ onde o **disjuntor** e a **retentativa** envolvem a unidade de trabalho.                             |
| `app/repositories/incident_repository.py` | SQL. O compare-and-swap do lock otimista e a geraÃ§Ã£o do cÃ³digo do incidente.                                                |
| `app/models/`                             | Tabelas do SQLAlchemy (`incidents`, `incident_events`, `idempotency_keys`).                                                 |
| `app/schemas/`                            | Contrato da API em Pydantic v2, com alias camelCase.                                                                        |
| `app/domain/`                             | Regras puras: mÃ¡quina de estados, SLA e priority score. **Sem HTTP e sem banco** â€” Ã© o que dÃ¡ para testar em milissegundos. |

### Backend â€” a camada de resiliÃªncia (onde estÃ¡ o interesse do case)

| Arquivo                       | O que faz                                                                                       |
| ----------------------------- | ----------------------------------------------------------------------------------------------- |
| `app/core/database.py`        | Engine, pool, `connect_timeout` e os timeouts de sessÃ£o. Ã‰ onde o disjuntor "tem o que contar". |
| `app/infra/retry.py`          | A classificaÃ§Ã£o do que vale repetir (`is_transient`) e a polÃ­tica de backoff com jitter.        |
| `app/core/circuit_breaker.py` | MÃ¡quina de estados `CLOSED`/`OPEN`/`HALF_OPEN`, com uma sondagem por vez.                       |
| `app/core/cache.py`           | Cache da listagem com TTL e os quatro estados de `X-Cache-Status`.                              |
| `app/core/rate_limit.py`      | Janela deslizante por cliente, com cotas separadas de leitura e escrita.                        |
| `app/core/security.py`        | CabeÃ§alhos de seguranÃ§a e identificaÃ§Ã£o do cliente atrÃ¡s de proxy.                              |
| `app/core/idempotency.py`     | Leitura da `Idempotency-Key`, replay da resposta e o marcador em `ContextVar`.                  |
| `app/core/errors.py`          | Envelope de erro Ãºnico e a traduÃ§Ã£o de falha de banco em `503` ou `500`.                        |

### Frontend

| Arquivo                   | O que faz                                                                                 |
| ------------------------- | ----------------------------------------------------------------------------------------- |
| `src/lib/http.ts`         | Cliente HTTP e tratamento por status, incluindo `409` e `429`.                            |
| `src/lib/queryClient.ts`  | PolÃ­tica global do TanStack Query: `staleTime`, retry sÃ³ em `GET`, zero retry em mutaÃ§Ã£o. |
| `src/features/incidents/` | Listagem, filtros, detalhe e a mutaÃ§Ã£o otimista com rollback.                             |

### Infraestrutura e documentaÃ§Ã£o

| Arquivo                           | O que faz                                                                              |
| --------------------------------- | -------------------------------------------------------------------------------------- |
| `compose.yaml`                    | O PostgreSQL de desenvolvimento. Fonte Ãºnica â€” `pnpm db:up` usa isto.                  |
| `.github/workflows/ci.yml`        | Os quatro checks obrigatÃ³rios de todo PR.                                              |
| `scripts/github-bootstrap.ps1`    | Cria labels, milestones e as 72 issues do planejamento.                                |
| `docs/02` a `docs/09`             | Arquitetura, API, resiliÃªncia, design system, Git, testes, deploy e escolhas tÃ©cnicas. |
| `docs/10-registro-de-execucao.md` | Este documento: o porquÃª de cada decisÃ£o e a evidÃªncia.                                |
| `PLANO-LOGOS.md`                  | Planejamento mestre, com o cronograma de 5 dias. Fica **fora** do repositÃ³rio.         |

---

## 14. Como explicar na entrevista

### O resumo de 30 segundos

> Ã‰ uma central de resposta a incidentes logÃ­sticos: o analista vÃª uma fila
> priorizada, abre o incidente e muda o status. O interesse do case nÃ£o Ã© a tela,
> Ã© **o que acontece quando a rede oscila ou o banco cai**. EntÃ£o o backend trata
> trÃªs coisas que aparecem juntas: reenvio que nÃ£o pode duplicar, falha
> transitÃ³ria que nÃ£o deveria virar erro, e degradaÃ§Ã£o que nÃ£o pode virar tela
> em branco.

### Os trÃªs pilares, em duas frases cada

| Pilar            | A explicaÃ§Ã£o                                                                                                                                                                                                                                                        |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **ConcorrÃªncia** | Duas analistas abrem o mesmo incidente; quem salva primeiro ganha, o segundo recebe `409` com a versÃ£o atual e a interface mostra o conflito. A decisÃ£o acontece **numa instruÃ§Ã£o SQL** (compare-and-swap), nÃ£o em cÃ³digo Python, entÃ£o vale com mÃºltiplos workers. |
| **IdempotÃªncia** | A rede cai no meio do `POST` e o cliente nÃ£o sabe se criou. Ele reenvia com a mesma `Idempotency-Key` e recebe a resposta original, sem um segundo incidente. A garantia Ã© a **chave primÃ¡ria** da tabela: quem impede a dupla execuÃ§Ã£o Ã© o banco, nÃ£o um `if`.     |
| **ResiliÃªncia**  | Timeout para a falha **acontecer**, retry com jitter para absorver o blip, disjuntor para parar de tentar quando a falha Ã© persistente, e cache para a tela continuar mostrando dado de 30 segundos atrÃ¡s. Cada camada existe porque a anterior tem um limite.      |

### Perguntas provÃ¡veis, e a resposta curta

**"Por que nÃ£o `SELECT â€¦ FOR UPDATE`?"**
Seguraria a linha durante a requisiÃ§Ã£o inteira, incluindo o tempo em que a
analista estÃ¡ pensando. O lock otimista sÃ³ falha na escrita, e o conflito Ã©
tratado como dado â€” nÃ£o como erro.

**"Por que a chave de idempotÃªncia Ã© a chave primÃ¡ria?"**
Porque `SELECT` seguido de `INSERT` tem uma janela entre a leitura e a escrita. A
restriÃ§Ã£o de unicidade nÃ£o tem: ou a linha entra, ou o banco recusa. Ã‰ a Ãºnica
forma que continua correta com mÃºltiplos workers.

**"Por que repetir sÃ³ leitura, e nÃ£o toda escrita?"**
Porque repetir uma escrita pode duplicar efeito. A exceÃ§Ã£o Ã© a escrita guardada
por compare-and-swap: a segunda execuÃ§Ã£o nÃ£o acha a versÃ£o esperada, entÃ£o nÃ£o
produz efeito novo. E o `INSERT` **nunca** Ã© repetido â€” Ã© essa regra que
justifica a `Idempotency-Key`.

**"O disjuntor nÃ£o Ã© exagero para um MVP?"**
Sem ele, o retry trabalha contra: trÃªs tentativas por requisiÃ§Ã£o multiplicam a
carga justamente quando o banco estÃ¡ pior. E foi medido â€” com o banco fora, a
resposta caiu de **21 s para 10 ms**.

**"Por que o cache nÃ£o Ã© a fonte de verdade?"**
Porque toda mutaÃ§Ã£o vai ao banco e **esvazia** o cache. Ele serve sÃ³ a listagem, e
Ã© marcado como `STALE` quando Ã© cÃ³pia. Sem cÃ³pia, a API devolve `503` em vez de
lista vazia: "nÃ£o hÃ¡ incidentes" e "nÃ£o consigo ler os incidentes" sÃ£o coisas
diferentes.

**"Como vocÃª sabe que funciona?"**
Cada afirmaÃ§Ã£o tem uma mediÃ§Ã£o atrÃ¡s. O disjuntor foi testado com o container do
banco **realmente parado** â€” e foi assim que descobri que faltava
`connect_timeout`: a requisiÃ§Ã£o pendurava 12 minutos e o disjuntor nÃ£o tinha o que
contar, embora os 203 testes passassem.

**"O que vocÃª faria diferente?"**
Duas coisas. A documentaÃ§Ã£o foi escrita **antes** do cÃ³digo e vÃ¡rias vezes
descrevia algo que o cÃ³digo nÃ£o fazia â€” reconciliei a cada issue, mas o certo era
documentar junto. E teria feito o `connect_timeout` **antes** do disjuntor: o
disjuntor estava "pronto" e nÃ£o funcionava no cenÃ¡rio real.

### Se pedirem para rodar

```bash
pnpm db:up     # PostgreSQL em container, porta 5433
pnpm dev       # API em :8000 e frontend em :5173
pnpm verify    # o mesmo conjunto de verificaÃ§Ãµes do CI
```
