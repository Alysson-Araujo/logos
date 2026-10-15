# ADR 0010 — Paginação por cursor

- **Status:** Aceito
- **Data:** 2026-02-11
- **Contexto relacionado:** E3 — Resiliência & Performance da API (issue #31, `feat/31-cursor-pagination`)

## Contexto

A tela de triagem tem duas propriedades que quebram a paginação tradicional. A ordenação padrão é por prioridade, e a prioridade **muda com o tempo**: o `aging` faz um incidente que era o 40º da fila virar o 12º minutos depois, sem que ninguém o tenha tocado. E a lista **cresce enquanto a analista rola**, porque novos incidentes entram continuamente pelo SSE. Rolar até a página três e voltar não pode exibir o mesmo incidente duas vezes nem esconder um caso que ela nunca viu.

## Decisão

**Paginação por cursor opaco** (_keyset pagination_), com ordenação no servidor e o cursor codificando a posição do último item da página anterior, no formato `{"p": 1048, "id": "0f2c9b1e-…"}` — o score do último item mais o seu `id`. O predicado acompanha a ordenação. Para `sort=priority_desc`:

```sql
SELECT * FROM incidents
 WHERE deleted_at IS NULL
   AND (priority_score, id) < (:cursor_score, :cursor_id)
 ORDER BY priority_score DESC, id DESC
 LIMIT :limit;
```

O `id` entra como critério de desempate porque `priority_score` não é único: sem desempate determinístico, o banco poderia ordenar dois empatados de forma diferente entre consultas, fazendo o cursor repetir ou pular registros. O cursor é opaco para o cliente — ele devolve `pageInfo.nextCursor` sem montar o valor. Cursor malformado devolve `400 INVALID_CURSOR`.

## Alternativas consideradas

- **Offset/limit (`?page=3&limit=50`).** Descartado, e o motivo é específico deste produto: com `OFFSET 100` o banco varre e descarta 100 linhas, degradando com a profundidade. Pior, como a ordenação é por um score que muda enquanto a analista navega, o deslocamento deixa de corresponder à posição lógica — um incidente aparece duas vezes e outro desaparece, e ela não tem como perceber.
- **Carregar tudo e paginar no cliente.** Descartado: transferiria o acervo inteiro na primeira carga e transformaria o filtro em client-side, que é um dos antipadrões eliminatórios listados no briefing.
- **Chave primária como cursor (`?after=<uuid>`).** Descartado: só funciona se a ordenação for pela própria chave. Com ordenação por prioridade, não há relação de ordem entre `id` e `priority_score`, e o predicado não teria significado.
- **Cursor assinado com expiração.** Descartado: adicionaria gerenciamento de chave e uma nova classe de erro para um problema que não existe neste escopo. A estrutura já é opaca e versionável, deixando o caminho aberto.

## Consequências

### Positivas

- **Nenhum registro repetido, nenhum pulado**, mesmo com a lista crescendo e a ordem mudando durante a navegação — a razão principal da escolha.
- O predicado usa o índice `(status, criticality, priority_score DESC)`, com custo constante em relação à profundidade da página.
- O scroll infinito fica trivial: o próximo pedido é "depois deste ponto", sem estado de página.
- O cursor ser opaco permite mudar a estrutura interna sem quebrar nenhum cliente.

### Negativas / trade-offs

- **Não há "ir para a página 7"**: não existe salto arbitrário. Para uma tela com scroll infinito, a busca textual cobre o caso de localizar um incidente específico.
- **O cursor depende da ordenação**: trocar de `sort` invalida o cursor em uso e a API responde `400 INVALID_CURSOR` em vez de devolver resultados incoerentes.
- **Não há contagem exata por página.** `meta.total` é informativo e pode ficar levemente defasado; a interface não o usa para paginar.
- **Complexidade no SQL.** O predicado de desempate precisa acompanhar cada valor de `sort`; esse custo está concentrado em um único ponto do repositório.
