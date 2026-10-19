"""adiciona a sequencia aos eventos do incidente

Revision ID: 0006
Revises: 0005
Create Date: 2026-10-19 01:20:00.000000

Da uma posicao deterministica a cada evento na timeline do incidente.

**O defeito que isto resolve.** A timeline era ordenada por `created_at` com
desempate pelo `id`. O relogio do Windows tem resolucao de ~1 ms, entao dois
eventos gravados no mesmo milissegundo recebiam instantes identicos - e o
desempate caia num UUID **aleatorio**, ou seja, a ordem era sorteada. No Linux a
resolucao e de microssegundos e o empate quase nao ocorre, o que fazia o defeito
ser invisivel na CI e visivel no desenvolvimento. Era o pior tipo de combinacao:
o teste passava e a tela mentia.

**A correcao nao e um relogio melhor.** Poderia ser um contador de alta
resolucao, mas isso trocaria um defeito por outro: a ordem passaria a depender de
qual processo leu o relogio primeiro. A `sequence` e atribuida dentro da
transacao, por incidente, e nao depende de relogio nenhum.

**Backfill.** As bases que ja existem tem eventos sem posicao. Eles sao numerados
na ordem que a timeline **ja mostrava** (`created_at`, depois `id`), para que a
migracao nao mude o que o usuario ve - ela so torna essa ordem estavel.

A restricao de unicidade em `(incident_id, sequence)` entra DEPOIS do backfill,
e e proposital: se a numeracao produzisse repeticao, a migracao falharia em vez
de gravar uma timeline ambigua.

Gerado por `alembic revision` e escrito a mao para caber no `ruff format` e no
limite de 100 colunas.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0006"
down_revision: str | None = "0005"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

#: Numera cada evento pela quantidade de eventos anteriores do mesmo incidente.
#:
#: Escrito como subconsulta correlacionada, e nao com `ROW_NUMBER()`, porque
#: assim funciona igual no SQLite (onde a suite roda) e no PostgreSQL (onde a
#: aplicacao roda). O custo quadratico e irrelevante: sao poucos eventos por
#: incidente.
_BACKFILL = """
UPDATE incident_events
SET sequence = (
    SELECT COUNT(*)
    FROM incident_events AS anteriores
    WHERE anteriores.incident_id = incident_events.incident_id
      AND (
          anteriores.created_at < incident_events.created_at
          OR (
              anteriores.created_at = incident_events.created_at
              AND anteriores.id <= incident_events.id
          )
      )
)
"""


def upgrade() -> None:
    """Cria a coluna, numera o que ja existe e proibe posicao repetida."""
    # `server_default="0"` e temporario: a coluna e NOT NULL e as linhas
    # existentes precisam de um valor antes do backfill. O default sai logo
    # depois, para que um INSERT que esqueca a sequencia falhe alto em vez de
    # gravar zero silenciosamente.
    with op.batch_alter_table("incident_events") as batch:
        batch.add_column(sa.Column("sequence", sa.Integer(), nullable=False, server_default="0"))

    op.execute(sa.text(_BACKFILL))

    with op.batch_alter_table("incident_events") as batch:
        batch.alter_column("sequence", server_default=None)
        batch.create_unique_constraint("uq_incident_events_sequence", ["incident_id", "sequence"])


def downgrade() -> None:
    """Remove a sequencia; a timeline volta a ser ordenada pelo relogio."""
    with op.batch_alter_table("incident_events") as batch:
        batch.drop_constraint("uq_incident_events_sequence", type_="unique")
        batch.drop_column("sequence")
