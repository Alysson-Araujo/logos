"""adiciona usuarios e tokens revogados

Revision ID: 0003
Revises: 0002
Create Date: 2026-10-17 01:18:51.554351

Introduz a identidade no sistema: a tabela `users`, que sustenta o login, e
`revoked_tokens`, que faz o logout valer de verdade — sem ela, sair da aplicação
seria apenas o cliente esquecendo o token, e um token capturado continuaria
valido ate expirar.

Aproveita para ligar o incidente ao seu autor (`incidents.created_by_id`), o que
permite ao perfil REPORTER enxergar apenas o que ele mesmo registrou.

A migracao e PURAMENTE ADITIVA: cria duas tabelas e uma coluna ANULAVEL. Nenhum
UPDATE em massa, nenhum risco para os incidentes existentes — que ficam com
`created_by_id` nulo, exatamente como devem, porque sao anteriores ao login.

Gerado por `alembic revision --autogenerate` e revisado a mao para ficar dentro
do `ruff format` e do limite de 100 colunas. Nenhuma operacao foi alterada.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0003"
down_revision: str | None = "0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Cria `users`, `revoked_tokens` e o vínculo de autoria do incidente."""
    op.create_table(
        "users",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("email", sa.String(length=160), nullable=False),
        sa.Column("password_hash", sa.String(length=255), nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column(
            "role",
            sa.Enum(
                "REPORTER",
                "ANALYST",
                "ADMIN",
                name="userrole",
                native_enum=False,
                length=20,
            ),
            nullable=False,
        ),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        sa.Column("last_login_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_users")),
    )
    # Unico e indexado: e por ele que o login procura, e a unicidade impede que
    # o mesmo e-mail entre duas vezes com grafias diferentes.
    op.create_index(op.f("ix_users_email"), "users", ["email"], unique=True)

    op.create_table(
        "revoked_tokens",
        sa.Column("jti", sa.String(length=32), nullable=False),
        sa.Column("expires_at", sa.DateTime(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("jti", name=op.f("pk_revoked_tokens")),
    )
    # A limpeza dos tokens ja vencidos varre por esta coluna; sem o indice ela
    # seria uma varredura completa da tabela.
    op.create_index(
        op.f("ix_revoked_tokens_expires_at"), "revoked_tokens", ["expires_at"], unique=False
    )

    # Anulavel de proposito: os incidentes ja registrados nao tem autor e
    # continuam validos. `SET NULL` garante que apagar um usuario nunca apague
    # o incidente junto.
    #
    # `batch_alter_table` e obrigatorio aqui: o SQLite nao suporta
    # `ALTER TABLE ... ADD CONSTRAINT`, e sem o modo batch a migracao quebraria
    # na suite de testes (que roda em SQLite) enquanto passaria no PostgreSQL.
    # O batch recria a tabela por copia nos dois casos e o resultado final e o
    # mesmo schema.
    with op.batch_alter_table("incidents") as batch_op:
        batch_op.add_column(sa.Column("created_by_id", sa.Uuid(), nullable=True))
        batch_op.create_index("ix_incidents_created_by_id", ["created_by_id"], unique=False)
        batch_op.create_foreign_key(
            "fk_incidents_created_by_id_users",
            "users",
            ["created_by_id"],
            ["id"],
            ondelete="SET NULL",
        )


def downgrade() -> None:
    """Remove o vínculo de autoria e as tabelas de identidade."""
    with op.batch_alter_table("incidents") as batch_op:
        batch_op.drop_constraint("fk_incidents_created_by_id_users", type_="foreignkey")
        batch_op.drop_index("ix_incidents_created_by_id")
        batch_op.drop_column("created_by_id")

    op.drop_index("ix_revoked_tokens_expires_at", table_name="revoked_tokens")
    op.drop_table("revoked_tokens")
    op.drop_index("ix_users_email", table_name="users")
    op.drop_table("users")
