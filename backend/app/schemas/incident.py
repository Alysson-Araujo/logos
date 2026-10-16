"""Schemas de entrada e saída de incidentes."""

from __future__ import annotations

import re
from typing import Annotated, Any
from uuid import UUID

from pydantic import Field, StringConstraints, field_validator

from app.domain.enums import (
    IncidentCategory,
    IncidentCriticality,
    IncidentStatus,
    SortOption,
)
from app.schemas.common import CamelModel, PageInfo, UtcDateTime

#: Placas Mercosul (AAA1A23) e antigas (AAA1234).
PLATE_PATTERN = re.compile(r"^(?:[A-Z]{3}\d{4}|[A-Z]{3}\d[A-Z]\d{2})$")
PLATE_SEPARATORS = re.compile(r"[\s-]+")
HTML_MARKERS = re.compile(r"[<>]")

TitleStr = Annotated[str, StringConstraints(strip_whitespace=True, min_length=3, max_length=120)]
DescriptionStr = Annotated[str, StringConstraints(strip_whitespace=True, max_length=2000)]
LocationStr = Annotated[str, StringConstraints(strip_whitespace=True, max_length=160)]
DriverNameStr = Annotated[str, StringConstraints(strip_whitespace=True, max_length=120)]
ReportedByStr = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=2, max_length=80)
]
AnalystStr = Annotated[str, StringConstraints(strip_whitespace=True, min_length=2, max_length=80)]
ResolutionNotesStr = Annotated[str, StringConstraints(strip_whitespace=True, max_length=1000)]
SearchStr = Annotated[str, StringConstraints(strip_whitespace=True, max_length=200)]


class IncidentCreate(CamelModel):
    """Payload de criação de incidente."""

    title: TitleStr
    description: DescriptionStr | None = None
    category: IncidentCategory
    criticality: IncidentCriticality
    latitude: Annotated[float, Field(ge=-90, le=90)] | None = None
    longitude: Annotated[float, Field(ge=-180, le=180)] | None = None
    location_label: LocationStr | None = None
    truck_plate: str | None = None
    driver_name: DriverNameStr | None = None
    reported_by: ReportedByStr

    @field_validator("title")
    @classmethod
    def _reject_html_in_title(cls, value: str) -> str:
        """Rejeita títulos com marcação HTML."""
        if HTML_MARKERS.search(value):
            raise ValueError("title não pode conter marcação HTML.")
        return value

    @field_validator("truck_plate")
    @classmethod
    def _normalize_truck_plate(cls, value: str | None) -> str | None:
        """Normaliza a placa para maiúsculas, sem espaços ou hífens."""
        if value is None:
            return None
        cleaned = PLATE_SEPARATORS.sub("", value).upper()
        if not cleaned:
            return None
        if not PLATE_PATTERN.fullmatch(cleaned):
            raise ValueError(
                "truckPlate inválida: use o padrão Mercosul (AAA1A23) ou antigo (AAA1234)."
            )
        return cleaned


class IncidentStatusChange(CamelModel):
    """Payload de transição de status."""

    status: IncidentStatus
    resolution_notes: ResolutionNotesStr | None = None
    assigned_analyst: AnalystStr | None = None
    expected_version: Annotated[int, Field(ge=1)] | None = None


class IncidentRead(CamelModel):
    """Representação completa do incidente exposta pela API."""

    id: UUID
    code: str
    title: str
    description: str | None
    category: IncidentCategory
    criticality: IncidentCriticality
    status: IncidentStatus
    latitude: float | None
    longitude: float | None
    location_label: str | None
    truck_plate: str | None
    driver_name: str | None
    reported_by: str
    assigned_analyst: str | None
    resolution_notes: str | None
    priority_score: int
    sla_due_at: UtcDateTime
    version: int
    created_at: UtcDateTime
    updated_at: UtcDateTime
    closed_at: UtcDateTime | None


class AppliedFilters(CamelModel):
    """Eco dos filtros efetivamente aplicados na listagem."""

    status: list[IncidentStatus] = Field(default_factory=list)
    criticality: list[IncidentCriticality] = Field(default_factory=list)
    category: list[IncidentCategory] = Field(default_factory=list)
    search: str | None = None
    sort: SortOption


class IncidentListMeta(CamelModel):
    """Metadados da listagem."""

    total: int
    applied_filters: AppliedFilters


class IncidentListResponse(CamelModel):
    """Resposta paginada de incidentes."""

    items: list[IncidentRead]
    page_info: PageInfo
    meta: IncidentListMeta


class CursorPayload(CamelModel):
    """Conteúdo codificado em base64url dentro do cursor."""

    p: int
    id: UUID


class IncidentEventRead(CamelModel):
    """Um evento da timeline de auditoria do incidente."""

    id: UUID
    #: `CREATED`, `STATUS_CHANGED` ou `DELETED`. São estáveis, como os códigos de
    #: erro da API: renomear quebraria a leitura do histórico já gravado.
    event_type: str
    from_status: IncidentStatus | None = None
    to_status: IncidentStatus | None = None
    #: Quem provocou o evento, quando a informação existe. Hoje vem do payload da
    #: requisição; com autenticação real, virá do token.
    actor: str | None = None
    #: Contexto do evento — na transição, a versão que o cliente declarou esperar.
    payload: dict[str, Any] | None = None
    created_at: UtcDateTime


class IncidentTimelineResponse(CamelModel):
    """Timeline de auditoria de um incidente, em ordem cronológica.

    Usa `items`, como a listagem: o cliente já sabe de qual incidente pediu a
    timeline, então repetir o id na resposta só daria duas fontes para o mesmo
    dado.
    """

    items: list[IncidentEventRead]
