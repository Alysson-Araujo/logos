"""esquema inicial

Revision ID: 0001
Revises:
Create Date: 2026-10-15 11:42:21.764041

Cria as duas tabelas do dominio e os indices que sustentam a consulta principal
da tela de triagem (status + criticidade + priority score).

Gerado por `alembic revision --autogenerate` e revisado a mao: o arquivo bruto
nao passava no `ruff format --check` nem no limite de 100 colunas do projeto.
Nenhuma operacao foi alterada na revisao, apenas a formatacao.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0001"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Os enums sao armazenados como VARCHAR (native_enum=False), e nao como tipo
# nativo do banco. A validacao dos valores acontece no Pydantic, na borda da
# API; o banco guarda o texto. Isso mantem a migracao portavel entre SQLite e
# PostgreSQL, que e o que permite a suite rodar nos dois.
CATEGORIAS = (
    "ACIDENTE_COM_VEICULO",
    "ACIDENTE_COM_VITIMAS",
    "CONDICAO_CLIMATICA_ATIPICA",
    "PROBLEMA_MECANICO",
    "BLOQUEIO_DE_PISTA",
)
CRITICIDADES = ("ALTA", "MEDIA", "BAIXA")
SITUACOES = ("ABERTO", "EM_INVESTIGACAO", "FECHADO", "INCONCLUSIVO")


def upgrade() -> None:
    """Cria as tabelas de incidente e de evento de auditoria."""
    op.create_table(
        "incidents",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("code", sa.String(length=20), nullable=False),
        sa.Column("title", sa.String(length=120), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column(
            "category",
            sa.Enum(*CATEGORIAS, name="incidentcategory", native_enum=False, length=40),
            nullable=False,
        ),
        sa.Column(
            "criticality",
            sa.Enum(*CRITICIDADES, name="incidentcriticality", native_enum=False, length=10),
            nullable=False,
        ),
        sa.Column(
            "status",
            sa.Enum(*SITUACOES, name="incidentstatus", native_enum=False, length=20),
            nullable=False,
        ),
        sa.Column("latitude", sa.Float(), nullable=True),
        sa.Column("longitude", sa.Float(), nullable=True),
        sa.Column("location_label", sa.String(length=160), nullable=True),
        sa.Column("truck_plate", sa.String(length=8), nullable=True),
        sa.Column("driver_name", sa.String(length=120), nullable=True),
        sa.Column("reported_by", sa.String(length=80), nullable=False),
        sa.Column("assigned_analyst", sa.String(length=80), nullable=True),
        sa.Column("resolution_notes", sa.String(length=1000), nullable=True),
        sa.Column("priority_score", sa.Integer(), nullable=False),
        sa.Column("sla_due_at", sa.DateTime(), nullable=False),
        # Coluna do lock otimista: o compare-and-swap compara exatamente este
        # valor no WHERE, entao ela existe desde a primeira versao do schema.
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("closed_at", sa.DateTime(), nullable=True),
        # Soft delete: toda leitura filtra deleted_at IS NULL.
        sa.Column("deleted_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_incidents")),
    )
    op.create_index(
        op.f("ix_incidents_assigned_analyst"), "incidents", ["assigned_analyst"], unique=False
    )
    op.create_index(
        "ix_incidents_category_created_at", "incidents", ["category", "created_at"], unique=False
    )
    # Unico: o code e o identificador que a operacao fala no radio.
    op.create_index(op.f("ix_incidents_code"), "incidents", ["code"], unique=True)
    op.create_index(op.f("ix_incidents_deleted_at"), "incidents", ["deleted_at"], unique=False)
    op.create_index(op.f("ix_incidents_sla_due_at"), "incidents", ["sla_due_at"], unique=False)
    # Indice da consulta principal da tela de triagem.
    op.create_index(
        "ix_incidents_status_criticality_priority",
        "incidents",
        ["status", "criticality", "priority_score"],
        unique=False,
    )

    op.create_table(
        "incident_events",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("incident_id", sa.Uuid(), nullable=False),
        sa.Column("event_type", sa.String(length=40), nullable=False),
        sa.Column("from_status", sa.String(length=20), nullable=True),
        sa.Column("to_status", sa.String(length=20), nullable=True),
        sa.Column("actor", sa.String(length=80), nullable=True),
        sa.Column("payload", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(
            ["incident_id"],
            ["incidents.id"],
            name=op.f("fk_incident_events_incident_id_incidents"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_incident_events")),
    )
    op.create_index(
        op.f("ix_incident_events_incident_id"), "incident_events", ["incident_id"], unique=False
    )


def downgrade() -> None:
    """Remove as tabelas criadas, na ordem inversa da criacao."""
    op.drop_index(op.f("ix_incident_events_incident_id"), table_name="incident_events")
    op.drop_table("incident_events")

    op.drop_index("ix_incidents_status_criticality_priority", table_name="incidents")
    op.drop_index(op.f("ix_incidents_sla_due_at"), table_name="incidents")
    op.drop_index(op.f("ix_incidents_deleted_at"), table_name="incidents")
    op.drop_index(op.f("ix_incidents_code"), table_name="incidents")
    op.drop_index("ix_incidents_category_created_at", table_name="incidents")
    op.drop_index(op.f("ix_incidents_assigned_analyst"), table_name="incidents")
    op.drop_table("incidents")
