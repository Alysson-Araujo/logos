"""Modelos ORM da aplicação — a importação do pacote registra o metadata completo."""

from __future__ import annotations

from app.models.base import Base, TimestampMixin, utcnow
from app.models.incident import Incident
from app.models.incident_event import IncidentEvent

__all__ = ["Base", "Incident", "IncidentEvent", "TimestampMixin", "utcnow"]
