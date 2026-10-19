"""Modelo ORM do evento de auditoria de um incidente.

A tabela existe desde a primeira versão do schema, seguindo o modelo de dados do plano.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import UUID, uuid4

from sqlalchemy import JSON, DateTime, ForeignKey, Integer, String, UniqueConstraint, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, utcnow


class IncidentEvent(Base):
    """Registro imutável de uma mudança de estado do incidente."""

    __tablename__ = "incident_events"
    __table_args__ = (
        # A ordem da timeline tem que ser determinística. Sem esta restrição, um
        # erro de concorrência produziria dois eventos com a mesma posição e a
        # narrativa sairia embaralhada sem ninguém perceber — o banco recusar é
        # melhor do que a tela mentir.
        UniqueConstraint("incident_id", "sequence", name="uq_incident_events_sequence"),
    )

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    incident_id: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("incidents.id", ondelete="CASCADE"), nullable=False, index=True
    )
    #: Posição do evento na timeline do incidente, começando em 1.
    #:
    #: **Por que não basta o `created_at`.** O relógio do Windows tem resolução de
    #: ~1 ms, então dois eventos gravados no mesmo milissegundo recebem instantes
    #: idênticos — e o desempate pelo `id` é sorteado, porque o id é UUID
    #: aleatório. A timeline saía em ordem aleatória nesse empate. No Linux a
    #: resolução é de microssegundos e o empate quase não ocorre, o que fazia o
    #: defeito ser **invisível na CI e visível no desenvolvimento**.
    sequence: Mapped[int] = mapped_column(Integer, nullable=False)
    event_type: Mapped[str] = mapped_column(String(40), nullable=False)
    from_status: Mapped[str | None] = mapped_column(String(20), nullable=True)
    to_status: Mapped[str | None] = mapped_column(String(20), nullable=True)
    actor: Mapped[str | None] = mapped_column(String(80), nullable=True)
    payload: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)
