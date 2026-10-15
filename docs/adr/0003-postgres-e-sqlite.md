# ADR 0003 — SQLAlchemy 2.0 com Alembic, SQLite local e PostgreSQL em produção

- **Status:** Aceito
- **Data:** 2026-02-11
- **Contexto relacionado:** E1 — Backend Core (issues #10 e #11) e E2 (issue #20)

## Contexto

O briefing permite armazenar incidentes em JSON estruturado, mas o Pilar 1 exige uma garantia que JSON não oferece: impedir que dois analistas sobrescrevam a mesma decisão sem que nenhum dos dois saiba. A implementação escolhida depende de uma transação que avalie predicado e escrita atomicamente. Há ainda uma restrição de ambiente: a máquina de desenvolvimento não tem Docker instalado, então o setup local precisa funcionar sem serviço externo — enquanto o comportamento testado precisa ser o de produção.

## Decisão

**SQLAlchemy 2.0** como camada de dados e **Alembic** para versionamento de schema, com dois bancos e papéis distintos: SQLite em arquivo (com `WAL` e `busy_timeout`) para desenvolvimento e unidade, e **PostgreSQL** (Neon) para produção e para a suíte de concorrência quando disponível. Toda atualização condicional é expressa como instrução única em `repositories/incident_repository.py`:

```sql
UPDATE incidents
   SET status = :new_status, version = version + 1, updated_at = :now
 WHERE id = :id AND version = :expected_version AND deleted_at IS NULL;
```

Objeto ORM carregado em memória **nunca** é mutado e salvo para alterar status. Essa é a regra que sustenta o Pilar 1.

## Alternativas consideradas

- **JSON estruturado (arquivo ou `JSONB` sem transação).** Descartado por inviabilidade técnica: sem predicado atômico, o CAS teria de ser feito em Python (`ler` → `comparar` → `escrever`), reintroduzindo a janela TOCTOU que o projeto existe para eliminar.
- **Somente SQLite em todos os ambientes.** Descartado: SQLite serializa escritas e produz `database is locked` sob concorrência — sintoma que a analista vê como "o sistema travou". Também não tem os índices `GIN` da busca textual.
- **Somente PostgreSQL, inclusive em desenvolvimento.** Descartado: exigiria container já no primeiro passo do setup, contrariando a restrição de ambiente e o critério de setup simples.
- **ORM com salvamento implícito (estilo Active Record).** Descartado: é o mecanismo que torna o antipadrão `SELECT` + `if` + `UPDATE` a coisa natural de se escrever.

## Consequências

### Positivas

- A garantia é verificável por teste: dez threads simultâneas produzem exatamente um `200` e nove `409`.
- SQLite local permite clonar, instalar e rodar sem Docker.
- Alembic torna o schema do ambiente publicado reproduzível e auditável.
- Trocar de banco é alterar `DATABASE_URL`, porque o CAS está escrito em SQL padrão.

### Negativas / trade-offs

- **SQLite não é PostgreSQL.** Sem MVCC real, sem `GIN`, sem isolamento configurável; os testes de concorrência usam SQLite com `WAL` como substituto declarado, conforme `docs/07-testes.md`.
- Toda escrita de `status` precisa passar pelo repositório — um `session.commit()` genérico burlaria a garantia. A proteção é disciplina de camada e o teste de concorrência.
- A integridade fica dividida entre Python (transição permitida) e SQL (versão conferida): são responsabilidades diferentes, mas exigem que quem lê saiba por que existem duas verificações.
