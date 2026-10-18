"""adiciona convite e senha temporaria

Revision ID: 0004
Revises: 0003
Create Date: 2026-10-17 22:20:12.236458

Sustenta a administracao de contas por convite: a conta nasce **inativa** e sem
senha definitiva, e o primeiro acesso usa uma senha temporaria que o servidor
gera e envia por e-mail.

Tres colunas em `users`:

- `temp_password_hash` — o hash da senha temporaria. Nulo quando nao ha convite
  pendente. Guardada so como hash, como qualquer senha: nem o administrador que
  convidou consegue le-la depois.
- `invite_expires_at` — o prazo do convite. Vencido, a senha temporaria deixa de
  valer e o administrador precisa reenviar.
- `invited_by_id` — quem convidou. A administracao de contas tambem precisa de
  autoria, e `SET NULL` garante que apagar um administrador nao apague o
  historico do convite.

A migracao e PURAMENTE ADITIVA: tres colunas ANULAVEIS, nenhum UPDATE em massa.
As contas que ja existem ficam com convite nulo, exatamente como devem — elas
nasceram com senha definitiva.

Gerado por `alembic revision --autogenerate` e revisado a mao para ficar dentro
do `ruff format` e do limite de 100 colunas. Nenhuma operacao foi alterada.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0004"
down_revision: str | None = "0003"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Acrescenta as colunas de convite e senha temporária."""
    # `batch_alter_table` é obrigatório aqui: o SQLite não suporta
    # `ALTER TABLE ... ADD CONSTRAINT`, e sem o modo batch a suíte quebraria no
    # SQLite enquanto a migração passaria no PostgreSQL — um falso negativo que
    # só apareceria no CI.
    with op.batch_alter_table("users") as batch_op:
        batch_op.add_column(sa.Column("temp_password_hash", sa.String(length=255), nullable=True))
        batch_op.add_column(sa.Column("invite_expires_at", sa.DateTime(), nullable=True))
        batch_op.add_column(sa.Column("invited_by_id", sa.Uuid(), nullable=True))
        batch_op.add_column(sa.Column("sessions_valid_from", sa.DateTime(), nullable=True))
        # A limpeza dos convites vencidos varre por esta coluna; sem o índice
        # ela seria uma varredura completa da tabela.
        batch_op.create_index("ix_users_invite_expires_at", ["invite_expires_at"], unique=False)
        batch_op.create_foreign_key(
            "fk_users_invited_by_id_users",
            "users",
            ["invited_by_id"],
            ["id"],
            ondelete="SET NULL",
        )


def downgrade() -> None:
    """Remove as colunas de convite."""
    with op.batch_alter_table("users") as batch_op:
        batch_op.drop_constraint("fk_users_invited_by_id_users", type_="foreignkey")
        batch_op.drop_index("ix_users_invite_expires_at")
        batch_op.drop_column("sessions_valid_from")
        batch_op.drop_column("invited_by_id")
        batch_op.drop_column("invite_expires_at")
        batch_op.drop_column("temp_password_hash")
