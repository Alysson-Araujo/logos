"""Modelo ORM do incidente."""

from __future__ import annotations

from datetime import datetime
from uuid import UUID, uuid4

from sqlalchemy import DateTime, Enum, Float, ForeignKey, Index, Integer, String, Text, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from app.domain.enums import IncidentCategory, IncidentCriticality, IncidentStatus
from app.models.base import Base, TimestampMixin

INITIAL_VERSION = 1


class Incident(Base, TimestampMixin):
    """Incidente reportado à central de resposta."""

    __tablename__ = "incidents"
    __table_args__ = (
        Index(
            "ix_incidents_status_criticality_priority",
            "status",
            "criticality",
            "priority_score",
        ),
        Index("ix_incidents_category_created_at", "category", "created_at"),
    )

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    code: Mapped[str] = mapped_column(String(20), nullable=False, unique=True, index=True)
    title: Mapped[str] = mapped_column(String(120), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    category: Mapped[IncidentCategory] = mapped_column(
        Enum(IncidentCategory, native_enum=False, length=40), nullable=False
    )
    criticality: Mapped[IncidentCriticality] = mapped_column(
        Enum(IncidentCriticality, native_enum=False, length=10), nullable=False
    )
    status: Mapped[IncidentStatus] = mapped_column(
        Enum(IncidentStatus, native_enum=False, length=20),
        nullable=False,
        default=IncidentStatus.ABERTO,
    )
    latitude: Mapped[float | None] = mapped_column(Float, nullable=True)
    longitude: Mapped[float | None] = mapped_column(Float, nullable=True)
    location_label: Mapped[str | None] = mapped_column(String(160), nullable=True)
    truck_plate: Mapped[str | None] = mapped_column(String(8), nullable=True)
    driver_name: Mapped[str | None] = mapped_column(String(120), nullable=True)
    reported_by: Mapped[str] = mapped_column(String(80), nullable=False)
    #: Quem criou o registro. Distinto de `reported_by`, que é o CANAL de origem
    #: ("Rádio Frota 12", "Central 0800"): o rádio reporta, a analista registra.
    #: Anulável porque os incidentes anteriores à autenticação não têm autor.
    created_by_id: Mapped[UUID | None] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    assigned_analyst: Mapped[str | None] = mapped_column(String(80), nullable=True, index=True)
    resolution_notes: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    priority_score: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    sla_due_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, index=True)
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=INITIAL_VERSION)
    closed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, index=True)
