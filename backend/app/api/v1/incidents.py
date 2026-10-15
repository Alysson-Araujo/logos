"""Endpoints de incidentes: listagem, detalhe, criação, transição e soft delete."""

from __future__ import annotations

from typing import Annotated, Any, Final
from uuid import UUID

from fastapi import APIRouter, Header, Query, Response

from app.api.deps import (
    ServiceDep,
    parse_enum_query,
    parse_if_match,
    resolve_expected_version,
)
from app.domain.enums import (
    IncidentCategory,
    IncidentCriticality,
    IncidentStatus,
    SortOption,
)
from app.repositories.incident_repository import IncidentFilter, decode_cursor
from app.schemas.common import ErrorResponse
from app.schemas.incident import (
    IncidentCreate,
    IncidentListMeta,
    IncidentListResponse,
    IncidentRead,
    IncidentStatusChange,
)

ERROR_RESPONSES: Final[dict[int | str, dict[str, Any]]] = {
    400: {"model": ErrorResponse, "description": "Cursor de paginação inválido"},
    404: {"model": ErrorResponse, "description": "Incidente não encontrado"},
    409: {"model": ErrorResponse, "description": "Conflito de versão (lock otimista)"},
    412: {"model": ErrorResponse, "description": "If-Match malformado"},
    422: {"model": ErrorResponse, "description": "Validação ou transição de status inválida"},
}

router = APIRouter(prefix="/incidents", tags=["incidents"])


@router.get(
    "",
    response_model=IncidentListResponse,
    summary="Lista incidentes",
    description=(
        "Lista paginada por cursor (keyset, sem OFFSET) com filtros combináveis de "
        "status, criticidade, categoria e busca textual."
    ),
    responses=ERROR_RESPONSES,
)
def list_incidents(
    service: ServiceDep,
    status_filter: Annotated[
        list[str] | None,
        Query(alias="status", description="Status (repetido ou separado por vírgula)."),
    ] = None,
    criticality_filter: Annotated[
        list[str] | None,
        Query(alias="criticality", description="Criticidade (repetida ou separada por vírgula)."),
    ] = None,
    category_filter: Annotated[
        list[str] | None,
        Query(alias="category", description="Categoria (repetida ou separada por vírgula)."),
    ] = None,
    search: Annotated[
        str | None,
        Query(max_length=200, description="Busca em título, descrição, código, placa e local."),
    ] = None,
    sort: Annotated[
        SortOption, Query(description="Ordenação: prioridade, criação ou criticidade.")
    ] = SortOption.PRIORITY_DESC,
    limit: Annotated[int, Query(ge=1, le=100, description="Itens por página.")] = 50,
    cursor: Annotated[str | None, Query(description="Cursor devolvido em nextCursor.")] = None,
) -> IncidentListResponse:
    """Devolve a página de incidentes já filtrada, ordenada e priorizada."""
    filters = IncidentFilter(
        statuses=parse_enum_query(status_filter, IncidentStatus, "status"),
        criticalities=parse_enum_query(criticality_filter, IncidentCriticality, "criticality"),
        categories=parse_enum_query(category_filter, IncidentCategory, "category"),
        search=search or None,
        sort=sort,
        limit=limit,
        cursor=decode_cursor(cursor) if cursor else None,
    )
    page = service.list(filters)
    return IncidentListResponse(
        items=[IncidentRead.model_validate(item) for item in page.items],
        page_info=page.page_info,
        meta=IncidentListMeta(total=page.total, applied_filters=page.applied_filters),
    )


@router.post(
    "",
    response_model=IncidentRead,
    status_code=201,
    summary="Cria incidente",
    description="Cria o incidente em ABERTO com código legível, SLA e priority score calculados.",
    responses=ERROR_RESPONSES,
)
def create_incident(
    payload: IncidentCreate, service: ServiceDep, response: Response
) -> IncidentRead:
    """Cria um incidente e devolve a representação completa."""
    incident = service.create(payload)
    response.headers["Location"] = f"/api/v1/incidents/{incident.id}"
    response.headers["ETag"] = f'"{incident.version}"'
    return IncidentRead.model_validate(incident)


@router.get(
    "/{incident_id}",
    response_model=IncidentRead,
    summary="Detalha incidente",
    description="Devolve o incidente e o header ETag com a versão atual.",
    responses=ERROR_RESPONSES,
)
def get_incident(incident_id: UUID, service: ServiceDep, response: Response) -> IncidentRead:
    """Devolve o detalhe do incidente com ETag para o lock otimista."""
    incident = service.get(incident_id)
    response.headers["ETag"] = f'"{incident.version}"'
    return IncidentRead.model_validate(incident)


@router.post(
    "/{incident_id}/status",
    response_model=IncidentRead,
    summary="Transiciona o status",
    description=(
        "Executa a transição validando a máquina de estados e a versão esperada em uma "
        "única instrução SQL (compare-and-swap). Exige If-Match ou expectedVersion."
    ),
    responses=ERROR_RESPONSES,
)
def change_incident_status(
    incident_id: UUID,
    payload: IncidentStatusChange,
    service: ServiceDep,
    response: Response,
    if_match: Annotated[
        str | None,
        Header(alias="If-Match", description='Versão esperada, ex.: "3".'),
    ] = None,
) -> IncidentRead:
    """Aplica a transição de status sob lock otimista."""
    expected_version = resolve_expected_version(if_match, payload.expected_version)
    incident = service.change_status(incident_id, payload, expected_version=expected_version)
    response.headers["ETag"] = f'"{incident.version}"'
    return IncidentRead.model_validate(incident)


@router.delete(
    "/{incident_id}",
    status_code=204,
    response_class=Response,
    summary="Remove incidente (soft delete)",
    description="Marca o incidente como removido sem apagar o histórico.",
    responses=ERROR_RESPONSES,
)
def delete_incident(
    incident_id: UUID,
    service: ServiceDep,
    if_match: Annotated[
        str | None,
        Header(alias="If-Match", description="Versão esperada opcional, ex.: '3'."),
    ] = None,
) -> Response:
    """Executa o soft delete do incidente."""
    service.soft_delete(incident_id, expected_version=parse_if_match(if_match))
    return Response(status_code=204)
