"""adiciona idempotency_keys

Revision ID: 0002
Revises: 0001
Create Date: 2026-10-15 12:12:56.066034

Cria a tabela que sustenta a idempotência das mutações. A chave é a chave
primária de propósito: é a restrição de unicidade do banco — e não um `if` em
Python — que garante que duas requisições simultâneas com a mesma
`Idempotency-Key` não executem as duas.

Gerado por `alembic revision --autogenerate` e revisado a mao para ficar dentro
do `ruff format` e do limite de 100 colunas. Nenhuma operacao foi alterada.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0002"
down_revision: str | None = "0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Cria a tabela de chaves de idempotência."""
    op.create_table(
        "idempotency_keys",
        sa.Column("key", sa.String(length=120), nullable=False),
        sa.Column("request_hash", sa.String(length=64), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("response_status", sa.Integer(), nullable=True),
        sa.Column("response_body", sa.Text(), nullable=True),
        sa.Column("response_headers", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("expires_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("key", name=op.f("pk_idempotency_keys")),
    )
    # A limpeza das chaves expiradas roda em toda reserva, então este índice
    # evita que ela vire varredura completa da tabela.
    op.create_index(
        "ix_idempotency_keys_expires_at", "idempotency_keys", ["expires_at"], unique=False
    )


def downgrade() -> None:
    """Remove a tabela de chaves de idempotência."""
    op.drop_index("ix_idempotency_keys_expires_at", table_name="idempotency_keys")
    op.drop_table("idempotency_keys")
