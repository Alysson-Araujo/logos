"""Regras de aplicação do ciclo de vida dos incidentes."""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime
from typing import Any
from uuid import UUID, uuid4

from app.core.errors import (
    IncidentNotFoundError,
    InvalidStatusTransitionError,
    VersionConflictError,
)
from app.domain.enums import IncidentStatus
from app.domain.priority import compute_priority_score, compute_sla_due_at
from app.domain.rules import (
    allowed_transitions,
    assert_transition_allowed,
    predecessors_of,
    validate_resolution_notes,
)
from app.models.base import utcnow
from app.models.incident import INITIAL_VERSION, Incident
from app.repositories.incident_repository import (
    IncidentFilter,
    IncidentRepository,
    encode_cursor,
)
from app.schemas.common import PageInfo
from app.schemas.incident import AppliedFilters, IncidentCreate, IncidentRead, IncidentStatusChange


def serialize_incident(incident: Incident) -> dict[str, Any]:
    """Serializa o incidente no mesmo contrato camelCase da API."""
    return IncidentRead.model_validate(incident).model_dump(mode="json", by_alias=True)


@dataclass(frozen=True, slots=True)
class IncidentPage:
    """Página de incidentes pronta para virar resposta HTTP."""

    items: list[Incident]
    page_info: PageInfo
    total: int
    applied_filters: AppliedFilters


class IncidentService:
    """Orquestra regras de domínio, repositório e contrato de saída."""

    def __init__(
        self,
        repository: IncidentRepository,
        *,
        now_provider: Callable[[], datetime] = utcnow,
    ) -> None:
        """Recebe o repositório e a fonte de tempo (injetável nos testes)."""
        self._repository = repository
        self._now_provider = now_provider

    def get(self, incident_id: UUID) -> Incident:
        """Devolve o incidente ou levanta 404."""
        incident = self._repository.get_by_id(incident_id)
        if incident is None:
            raise IncidentNotFoundError(details={"id": str(incident_id)})
        return incident

    def create(self, payload: IncidentCreate) -> Incident:
        """Cria o incidente com status ABERTO, SLA e score calculados no servidor."""
        now = self._now_provider()
        sla_due_at = compute_sla_due_at(payload.criticality, now)
        incident = Incident(
            id=uuid4(),
            code="",
            title=payload.title,
            description=payload.description,
            category=payload.category,
            criticality=payload.criticality,
            status=IncidentStatus.ABERTO,
            latitude=payload.latitude,
            longitude=payload.longitude,
            location_label=payload.location_label,
            truck_plate=payload.truck_plate,
            driver_name=payload.driver_name,
            reported_by=payload.reported_by,
            assigned_analyst=None,
            resolution_notes=None,
            priority_score=compute_priority_score(
                category=payload.category,
                criticality=payload.criticality,
                created_at=now,
                sla_due_at=sla_due_at,
                now=now,
            ),
            sla_due_at=sla_due_at,
            version=INITIAL_VERSION,
            created_at=now,
            updated_at=now,
            closed_at=None,
            deleted_at=None,
        )
        return self._repository.create(incident)

    def list(self, filters: IncidentFilter) -> IncidentPage:
        """Lista incidentes com filtros, ordenação e paginação por cursor."""
        now = self._now_provider()
        self._repository.refresh_priority_scores(now=now)
        items, total, has_next_page = self._repository.list_incidents(filters)

        next_cursor = encode_cursor(items[-1], filters.sort) if has_next_page and items else None
        page_info = PageInfo(
            next_cursor=next_cursor,
            has_next_page=has_next_page,
            limit=filters.limit,
        )
        applied = AppliedFilters(
            status=list(filters.statuses),
            criticality=list(filters.criticalities),
            category=list(filters.categories),
            search=filters.search,
            sort=filters.sort,
        )
        return IncidentPage(
            items=items,
            page_info=page_info,
            total=total,
            applied_filters=applied,
        )

    def change_status(
        self,
        incident_id: UUID,
        payload: IncidentStatusChange,
        *,
        expected_version: int,
    ) -> Incident:
        """Aplica a transição de status usando compare-and-swap no banco."""
        validate_resolution_notes(payload.status, payload.resolution_notes)

        now = self._now_provider()
        rowcount = self._repository.apply_status_transition(
            incident_id=incident_id,
            expected_version=expected_version,
            new_status=payload.status,
            allowed_sources=predecessors_of(payload.status),
            now=now,
            assigned_analyst=payload.assigned_analyst,
            resolution_notes=payload.resolution_notes,
            closed_at=now if payload.status is IncidentStatus.FECHADO else None,
        )

        if rowcount != 1:
            self._raise_transition_failure(incident_id, payload.status, expected_version)

        return self._reload_with_fresh_score(incident_id)

    def soft_delete(self, incident_id: UUID, *, expected_version: int | None) -> None:
        """Remove logicamente o incidente, opcionalmente sob lock otimista."""
        rowcount = self._repository.soft_delete(
            incident_id,
            expected_version=expected_version,
            now=self._now_provider(),
        )
        if rowcount == 1:
            return

        current = self._repository.get_by_id(incident_id)
        if current is None:
            raise IncidentNotFoundError(details={"id": str(incident_id)})
        if expected_version is not None and current.version != expected_version:
            raise VersionConflictError(
                details={
                    "expectedVersion": expected_version,
                    "current": serialize_incident(current),
                }
            )
        raise IncidentNotFoundError(details={"id": str(incident_id)})

    def _raise_transition_failure(
        self, incident_id: UUID, target: IncidentStatus, expected_version: int
    ) -> None:
        """Classifica a falha do CAS em 404, 409 ou 422 com o estado atual."""
        current = self._repository.get_by_id(incident_id)
        if current is None:
            raise IncidentNotFoundError(details={"id": str(incident_id)})

        if current.version != expected_version:
            raise VersionConflictError(
                details={
                    "expectedVersion": expected_version,
                    "current": serialize_incident(current),
                }
            )

        assert_transition_allowed(current.status, target)
        raise InvalidStatusTransitionError(
            f"Não é possível ir de {current.status.value} para {target.value}.",
            details={
                "from": current.status.value,
                "to": target.value,
                "allowed": [status.value for status in allowed_transitions(current.status)],
            },
        )

    def _reload_with_fresh_score(self, incident_id: UUID) -> Incident:
        """Recarrega o incidente e persiste o score recalculado."""
        incident = self._repository.get_by_id(incident_id)
        if incident is None:
            raise IncidentNotFoundError(details={"id": str(incident_id)})

        now = self._now_provider()
        score = compute_priority_score(
            category=incident.category,
            criticality=incident.criticality,
            created_at=incident.created_at,
            sla_due_at=incident.sla_due_at,
            now=now,
        )
        if score != incident.priority_score:
            self._repository.update_priority_score(incident.id, score)
            incident.priority_score = score
        return incident
