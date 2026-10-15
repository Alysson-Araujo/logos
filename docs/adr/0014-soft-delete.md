# ADR 0014 — Soft delete em vez de exclusão física

- **Status:** Aceito
- **Data:** 2026-02-11
- **Contexto relacionado:** E1 — Backend Core (`DELETE /incidents/{id}`) e E2 — auditoria

## Contexto

Um incidente registrado é uma **decisão operacional documentada**: alguém reportou, alguém assumiu, alguém encerrou com justificativa. Esse registro costuma ser consultado depois, para comprovar cumprimento de SLA, apurar a causa de um atraso ou responder a uma cobrança do cliente. Ao mesmo tempo, a tela precisa de uma operação de remoção: um incidente criado por engano, duplicado ou de teste não pode poluir a fila de quem opera. Excluir fisicamente satisfaz a segunda necessidade e destrói a primeira — restaurar uma linha exigiria restaurar o banco inteiro até um ponto no tempo, o que não é uma operação disponível para responder a uma pergunta pontual.

## Decisão

**Soft delete** com a coluna `deleted_at`, nula enquanto o incidente está ativo. `DELETE /api/v1/incidents/{id}` não remove a linha: preenche `deleted_at`, avança `version` e registra um evento `DELETED` na timeline.

| Aspecto | Comportamento |
| --- | --- |
| Resposta | `204 No Content`, mesma semântica externa de uma exclusão real |
| Leitura posterior | `410 Gone`, distinguindo "existiu e foi removido" de "nunca existiu" (`404`) |
| Listagem | Toda consulta filtra `deleted_at IS NULL`, com índice dedicado |
| Comparação e escrita | O CAS inclui `AND deleted_at IS NULL` no predicado |
| Timeline | Continua acessível: o registro de auditoria não é removido |
| Idempotência | Repetir o `DELETE` com a mesma chave devolve o `204` original |

A coluna `version` avança junto, o que é intencional: quem tem a tela aberta passa a ter versão defasada e recebe `409` ao tentar alterar um incidente removido por outra pessoa.

## Alternativas consideradas

- **Hard delete.** Descartado: destrói o registro de auditoria de uma decisão operacional em um domínio onde a pergunta "por que este caso foi encerrado assim?" é feita semanas depois e tem valor contratual.
- **Reaproveitar o status, adicionando `CANCELADO`.** Descartado por contaminação de domínio: misturaria dois conceitos independentes. "Cancelado" é um estado do ciclo de vida — algo que aconteceu na operação e que a analista deve enxergar; "removido" é um ato administrativo sobre o registro. Unificá-los faria um filtro por status trazer linhas de teste junto com incidentes reais.
- **Mover para tabela de arquivo (`incidents_archive`).** Descartado: resolve o crescimento da tabela principal e cria um problema pior — toda consulta histórica (timeline, relatório de SLA, vínculo com novo incidente) passaria a exigir `UNION` entre duas tabelas.
- **Excluir de verdade e manter o histórico apenas em log.** Descartado: log não é fonte de verdade consultável, não tem esquema garantido e não participa da transação.

## Consequências

### Positivas

- **Auditoria preservada**: incidente removido, timeline e nota de resolução continuam disponíveis para apuração.
- **Reversível**: desfazer uma remoção indevida é um `UPDATE` que anula `deleted_at`, sem restauração de backup.
- **`410 Gone` é informativo**, o que muda a mensagem mostrada em relação a um link apenas errado.
- A remoção é um evento auditável, registrado como qualquer outra mudança de estado.

### Negativas / trade-offs

- **Toda consulta precisa filtrar `deleted_at IS NULL`.** Esquecer o filtro é o defeito mais provável e o mais difícil de perceber — a lista apenas mostra um item que deveria estar removido. A mitigação é o índice dedicado e o fato de as consultas existirem em um único ponto do repositório.
- **A tabela cresce sem expurgo.** Irrelevante neste escopo; em produção de longo prazo, a evolução é uma rotina de arquivamento, que passa a ser o novo lugar onde a auditoria pode se perder.
- **`DELETE` deixa de ser idempotente por natureza**: repetir um `DELETE` real devolve `404`, e no soft delete o comportamento fica definido pela `Idempotency-Key`. Isso exige documentar a regra no contrato, como está em `docs/03-api.md`.
- **Referências externas ficam penduradas**: um link compartilhado responde `410` em vez de `404`, e integrações futuras precisam saber interpretar esse código.
