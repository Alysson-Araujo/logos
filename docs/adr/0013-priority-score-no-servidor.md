# ADR 0013 — Priority score calculado e persistido no servidor

- **Status:** Aceito
- **Data:** 2026-02-11
- **Contexto relacionado:** E3 — Resiliência & Performance da API (issue #32, `feat/32-priority-score`)

## Contexto

A ordenação padrão da tela não é data, é prioridade. O score combina quatro fatores e precisa produzir a mesma ordem para todos os analistas conectados, ser utilizável em filtro e ordenação no banco e ser explicável — a analista confia na fila quando entende por que um caso está acima de outro. Ele depende de `created_at` e `sla_due_at`, ou seja, **muda com o passar do tempo** sem que ninguém altere o incidente: o _aging_ faz um caso esquecido subir sozinho.

## Decisão

O score é calculado em `domain/priority.py` e **persistido** na coluna `priority_score`, com índice `(status, criticality, priority_score DESC)`. É recalculado na criação, em toda atualização que altere categoria, criticidade ou `sla_due_at`, e na leitura quando o valor persistido está defasado:

```
score = impacto(categoria) + urgência(criticidade) + aging(horas em aberto) + pressão de SLA

aging(h)    = min(h * 12, 400)
sla_pressão = 200 se faltam menos de 60 min para o SLA, senão 0
```

A função é pura e determinística, o que a torna testável por faixa, sem banco. A interface exibe o motivo: o _tooltip_ do `PriorityPill` mostra a decomposição termo a termo.

## Alternativas consideradas

- **Ordenar no cliente.** Descartado pelo produto, não pela performance: duas analistas com a lista carregada em momentos diferentes calcularam o _aging_ contra "agoras" distintos e passariam a ver **ordens diferentes para a mesma fila** — o que a A resolve primeiro não seria o que a B resolve primeiro, e a fila deixaria de ser um acordo coletivo. Ordenação client-side também impede paginação por cursor coerente.
- **Calcular na consulta SQL, sem persistir.** Descartado: a expressão apareceria em toda consulta (filtro, ordenação, paginação, contagem) e qualquer ajuste na fórmula exigiria alterar todos esses lugares. Uma expressão sobre `now()` também impede o índice de cobrir a ordenação.
- **Coluna computada no banco.** Descartado: depende de `now()` no momento da escrita, o que não se expressa como coluna gerada determinística, e moveria regra de negócio para dentro do schema.
- **Ordenar por criticidade e depois por data.** Descartado: é o comportamento do processo manual atual, e é o que faz um bloqueio de pista de 6 horas ficar abaixo de um problema mecânico criado há 5 minutos.
- **Modelo de aprendizado de máquina sobre o histórico.** Descartado: o score precisa ser **explicável** para a analista auditar uma decisão de prioridade, e uma ordem que ela não consegue justificar perde a confiança de quem opera.

## Consequências

### Positivas

- **Ordem idêntica para todos**, sem depender de quando cada um carregou a página.
- **Auditável e reproduzível**: com as mesmas quatro entradas, o resultado é sempre o mesmo número.
- **Testável por faixa** — `test_priority_score_orders_victims_accident_first` verifica a propriedade que dá sentido ao produto, sem subir banco.
- **Indexável**: o índice composto cobre filtro por status e criticidade mais ordenação por score, que é a consulta principal da triagem.

### Negativas / trade-offs

- **Custo de recálculo**: o score precisa ser regravado quando envelhece. A mitigação é recalcular dentro de uma janela de tolerância, já que um minuto de diferença no _aging_ não altera a posição prática na fila.
- **O teto de 400 é escolha de produto.** Sem ele, um incidente antigo ultrapassaria qualquer caso novo de alta criticidade e a fila perderia valor como sinal; com ele, um caso esquecido sobe acima de um `BAIXA` recém-criado, mas nunca acima de impacto e urgência combinados.
- **Fórmula fixa é fórmula.** Os pesos são heurística derivada de ITSM, não calibração com dados reais. Com histórico de resolução por categoria, seriam ajustados — e é por isso que vivem em tabela única e explícita, não espalhados no código.
- `priority_score` passa a fazer parte do contrato público, então alterá-lo é mudança de contrato.
