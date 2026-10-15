# ADR 0008 — Optimistic locking com `version` e `If-Match`

- **Status:** Aceito
- **Data:** 2026-02-11
- **Contexto relacionado:** E2 — Ciclo de vida & Concorrência (issues #20, #21 e #26)

## Contexto

Dois analistas abrem o mesmo incidente (`version = 3`). O analista A fecha o caso com a nota de resolução; oito segundos depois, o analista B — que ainda vê a tela antiga — marca `EM_INVESTIGACAO` e sobrescreve o registro do colega, sem que nenhum dos dois saiba. É o *lost update*: em logística, um caminhão parado por horas e uma decisão de dezenas de milhares de reais impossível de justificar. A API roda com múltiplos *workers* do uvicorn e pode rodar em múltiplas réplicas, então nenhuma solução baseada em memória do processo sobrevive.

## Decisão

**Optimistic locking** com coluna `version` monotônica (inicia em `1`) e compare-and-swap em uma única instrução SQL:

```sql
UPDATE incidents
   SET status = :new_status, version = version + 1, updated_at = :now
 WHERE id = :id
   AND version = :expected_version   -- a linha inteira depende disto
   AND deleted_at IS NULL;
```

`rowcount = 1` produz `200 OK` com a nova representação e `ETag: "4"`; `rowcount = 0` produz **`409 VERSION_CONFLICT`** com o estado atual em `details.serverState`. A versão esperada vem do cabeçalho `If-Match: "3"`, com alternativa `expectedVersion` no corpo para teste manual no Swagger. O `ETag` devolvido é o valor de `version` entre aspas, ligando a semântica HTTP ao mecanismo de banco. No frontend, `onMutate` guarda o snapshot; `onError` com `409` faz rollback e abre o `ConflictDialog` com o diff campo a campo.

## Alternativas consideradas

- **Pessimistic lock (`SELECT ... FOR UPDATE`).** Descartado: o lock fica preso enquanto a analista pensa — ela abre o caso, lê o histórico, liga para o motorista e só então salva, ocupando uma conexão do pool por minutos. Com `pool_size=5` e `max_overflow=10`, a 16ª analista simultânea espera por conexão, e a central serializa por falta de conexão, não de banco. Em rede instável, uma conexão perdida no meio da transação deixa o lock pendurado, e o sintoma é "o sistema travou".
- **Lock distribuído (Redis, `pg_advisory_lock`).** Descartado: adiciona dependência de infraestrutura para um problema que o banco resolve com uma cláusula `WHERE`, e introduz o modo de falha do lock órfão.
- **Last-write-wins com auditoria posterior.** Descartado: registrar o que aconteceu não impede que a decisão humana seja apagada. Auditoria é diagnóstico, não prevenção.
- **Merge automático por campo.** Descartado: não existe regra correta para mesclar "fechado com laudo" e "devolvido para a fila" — a escolha é humana, e o sistema deve apresentá-la.

## Consequências

### Positivas

- **Nunca bloqueia**, e a garantia é do banco: com predicado e escrita na mesma instrução, não há janela TOCTOU, mesmo com múltiplos *workers* e réplicas.
- O conflito vira informação útil: o `409` carrega o estado atual, o que permite mostrar o diff em vez de mensagem genérica.
- **Verificável por teste**: dez requisições simultâneas produzem `1 × 200` e `9 × 409`.
- Exige apenas uma coluna e um `WHERE`, sem infraestrutura adicional.

### Negativas / trade-offs

- **Conflitos custam uma requisição**: o cliente só descobre a divergência depois de tentar. Em cenário de conflito frequente seria desperdício; na central, conflito é exceção.
- **O cliente precisa tratar `409`.** Um consumidor que ignore o código perde a atualização em silêncio, e é por isso que o modal de conflito é item obrigatório de escopo, não polimento.
- Toda escrita de `status` deve passar pelo repositório; um `session.commit()` genérico burlaria a garantia.
- `version` avança em qualquer atualização, inclusive de criticidade. É intencional — qualquer alteração invalida a leitura anterior — mas significa que editar um campo irrelevante também gera conflito para quem estava com a tela aberta.
