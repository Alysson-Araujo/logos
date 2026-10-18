"""adiciona a frota de veiculos

Revision ID: 0005
Revises: 0004
Create Date: 2026-10-18 21:05:00.000000

Cria `vehicles`: os 5.000 caminhoes que a central acompanha, usados para
**sugerir a placa** no formulario de incidente.

Tres colunas de negocio:

- `plate`   — unica E indexada. O indice sustenta a busca por prefixo (`ABC%`),
  que e como se digita uma placa. Sem ele, cada tecla digitada varreria as
  5.000 linhas.
- `model`   — modelo comercial ("Volvo FH 460").
- `carrier` — transportadora. Existe para CONFIRMAR a escolha: quem esta no
  radio reconhece "Volvo FH 460 da Transbrasil" mais rapido do que um codigo
  de sete caracteres.

**Nao ha chave estrangeira de `incidents` para ca, e isso e deliberado.** Um
incidente pode envolver caminhao de terceiro, que nunca estara nesta tabela; e
um veiculo vendido sai do cadastro enquanto o incidente que ele teve continua
sendo um fato. A placa do incidente e um registro do momento; a daqui e um
cadastro que se mantem.

A migracao e PURAMENTE ADITIVA: uma tabela nova. Nenhuma coluna existente muda
e nenhum dado e reescrito — as bases que ja existem ganham a tabela vazia, e o
`seed` a popula.

Gerado por `alembic revision --autogenerate` e revisado a mao para ficar dentro
do `ruff format` e do limite de 100 colunas.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0005"
down_revision: str | None = "0004"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Cria a tabela da frota e o índice de busca por placa."""
    op.create_table(
        "vehicles",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("plate", sa.String(length=8), nullable=False),
        sa.Column("model", sa.String(length=80), nullable=False),
        sa.Column("carrier", sa.String(length=120), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_vehicles")),
    )
    # `unique=True` no índice, e não uma constraint separada: a unicidade da
    # placa e o que torna a busca por prefixo confiável, e um único objeto no
    # banco serve aos dois propósitos.
    op.create_index(op.f("ix_vehicles_plate"), "vehicles", ["plate"], unique=True)


def downgrade() -> None:
    """Remove a frota."""
    op.drop_index(op.f("ix_vehicles_plate"), table_name="vehicles")
    op.drop_table("vehicles")
