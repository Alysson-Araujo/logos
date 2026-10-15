"""Modelo ORM do evento de auditoria de um incidente.

A tabela existe desde a primeira versão do schema, seguindo o modelo de dados do plano.
Os endpoints que a expõem (`GET /incidents/{id}/events` e a timeline do drawer) são
escopo declarado de uma issue futura, por isso nada além do modelo vive aqui.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import UUID, uuid4

from sqlalchemy import JSON, DateTime, ForeignKey, String, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, utcnow


class IncidentEvent(Base):
    """Registro imutável de uma mudança de estado do incidente."""

    __tablename__ = "incident_events"

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    incident_id: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("incidents.id", ondelete="CASCADE"), nullable=False, index=True
    )
    event_type: Mapped[str] = mapped_column(String(40), nullable=False)
    from_status: Mapped[str | None] = mapped_column(String(20), nullable=True)
    to_status: Mapped[str | None] = mapped_column(String(20), nullable=True)
    actor: Mapped[str | None] = mapped_column(String(80), nullable=True)
    payload: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)
