"""Endpoints de incidentes: listagem, detalhe, criação, transição e soft delete."""

from __future__ import annotations

from typing import Annotated, Any, Final, cast
from uuid import UUID

from fastapi import APIRouter, Header, Query, Response

from app.api.deps import (
    CurrentActor,
    ServiceDep,
    parse_enum_query,
    parse_if_match,
    resolve_expected_version,
)
from app.core.cache import CACHE_STATUS_HEADER, CacheStatus, cache_key, get_listing_cache
from app.core.errors import ServiceUnavailableError
from app.core.idempotency import IdempotentRoute
from app.domain.enums import (
    IncidentCategory,
    IncidentCriticality,
    IncidentStatus,
    SortOption,
)
from app.domain.permissions import Permission, ensure_permission, visibility_scope
from app.infra.retry import is_transient
from app.repositories.incident_repository import IncidentFilter, decode_cursor
from app.schemas.common import ErrorResponse
from app.schemas.incident import (
    IncidentCreate,
    IncidentEventRead,
    IncidentListMeta,
    IncidentListResponse,
    IncidentRead,
    IncidentStatusChange,
    IncidentTimelineResponse,
)

ERROR_RESPONSES: Final[dict[int | str, dict[str, Any]]] = {
    400: {"model": ErrorResponse, "description": "Cursor de paginação inválido"},
    401: {
        "model": ErrorResponse,
        "description": (
            "Sem token, token inválido (UNAUTHENTICATED), token vencido "
            "(TOKEN_EXPIRED) ou conta desativada"
        ),
    },
    404: {"model": ErrorResponse, "description": "Incidente não encontrado"},
    409: {
        "model": ErrorResponse,
        "description": (
            "Conflito: versão divergente (VERSION_CONFLICT), ou Idempotency-Key "
            "reusada com corpo diferente ou ainda em processamento"
        ),
    },
    412: {"model": ErrorResponse, "description": "If-Match malformado"},
    422: {
        "model": ErrorResponse,
        "description": "Validação, transição de status ou Idempotency-Key inválida",
    },
    428: {"model": ErrorResponse, "description": "If-Match ou expectedVersion ausente"},
}

router = APIRouter(
    prefix="/incidents",
    tags=["incidents"],
    route_class=IdempotentRoute,
)


def _is_degradation(error: BaseException) -> bool:
    """A falha significa que o banco não respondeu?

    Cobre os **dois** caminhos da indisponibilidade: o circuito já aberto, que
    recusa sem tocar no banco, e a falha transitória que acabou de abri-lo. Sem o
    segundo, a primeira requisição durante a queda receberia erro tendo cópia
    guardada — que é exatamente o que esta issue existe para evitar.

    Erro de cliente, como cursor inválido, **não** é degradação: servir dado
    antigo para um pedido malformado esconderia o defeito em vez de mostrá-lo.
    """
    return isinstance(error, ServiceUnavailableError) or is_transient(error)


def _invalidate_listing_cache() -> None:
    """Esvazia o cache da listagem depois de uma mutação bem-sucedida.

    Invalidar apenas a chave afetada exigiria saber quais combinações de filtro
    incluem o registro alterado — e errar isso **esconderia a mudança** de quem
    olha a lista, que é o pior resultado possível durante um incidente. Um cache
    frio custa uma consulta a mais; um cache errado custa a confiança no painel.
    """
    get_listing_cache().clear()


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
    actor: CurrentActor,
    service: ServiceDep,
    response: Response,
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
    """Devolve a página de incidentes já filtrada, ordenada e priorizada.

    A resposta passa pelo cache e traz `X-Cache-Status`, para o cliente saber se
    o que recebeu é atual (`MISS` ou `REVALIDATED`) ou uma cópia servida durante
    uma degradação (`STALE`).
    """
    filters = IncidentFilter(
        statuses=parse_enum_query(status_filter, IncidentStatus, "status"),
        criticalities=parse_enum_query(criticality_filter, IncidentCriticality, "criticality"),
        categories=parse_enum_query(category_filter, IncidentCategory, "category"),
        search=search or None,
        sort=sort,
        limit=limit,
        cursor=decode_cursor(cursor) if cursor else None,
        # O escopo por papel entra na QUERY, e não num filtro em memória depois
        # de carregar: filtrar depois vazaria o total do `meta` e o esforço de
        # paginação. Como a contagem usa as mesmas condições, os KPIs do topo
        # ficam escopados de graça.
        created_by=visibility_scope(actor),
    )

    cache = get_listing_cache()
    key = cache_key(filters)
    cached = cache.get(key)

    if cached is not None and cache.is_fresh(cached):
        response.headers[CACHE_STATUS_HEADER] = CacheStatus.HIT.value
        return cast("IncidentListResponse", cached.value)

    try:
        page = service.list(filters)
    except Exception as exc:
        # O banco está fora. Uma cópia antiga vale mais que uma tela de erro:
        # para triagem, o dado de trinta segundos atrás é utilizável. Sem cópia,
        # o erro sobe — devolver lista vazia mentiria sobre o estado do sistema.
        if cached is None or not _is_degradation(exc):
            raise
        response.headers[CACHE_STATUS_HEADER] = CacheStatus.STALE.value
        return cast("IncidentListResponse", cached.value)

    payload = IncidentListResponse(
        items=[IncidentRead.model_validate(item) for item in page.items],
        page_info=page.page_info,
        meta=IncidentListMeta(total=page.total, applied_filters=page.applied_filters),
    )
    cache.put(key, payload)
    response.headers[CACHE_STATUS_HEADER] = (
        CacheStatus.REVALIDATED.value if cached is not None else CacheStatus.MISS.value
    )
    return payload


@router.post(
    "",
    response_model=IncidentRead,
    status_code=201,
    summary="Cria incidente",
    description="Cria o incidente em ABERTO com código legível, SLA e priority score calculados.",
    responses=ERROR_RESPONSES,
)
def create_incident(
    payload: IncidentCreate, actor: CurrentActor, service: ServiceDep, response: Response
) -> IncidentRead:
    """Cria um incidente e devolve a representação completa."""
    ensure_permission(actor, Permission.CREATE_INCIDENT)
    incident = service.create(payload, actor)
    # Só depois do sucesso: uma criação que falhou não muda a listagem.
    _invalidate_listing_cache()
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
def get_incident(
    incident_id: UUID, actor: CurrentActor, service: ServiceDep, response: Response
) -> IncidentRead:
    """Devolve o detalhe do incidente com ETag para o lock otimista."""
    incident = service.get(incident_id, actor)
    response.headers["ETag"] = f'"{incident.version}"'
    return IncidentRead.model_validate(incident)


@router.get(
    "/{incident_id}/events",
    response_model=IncidentTimelineResponse,
    summary="Timeline de auditoria",
    description=(
        "Histórico do incidente em ordem cronológica: criação, transições de status e "
        "remoção, com o autor e a versão que o cliente declarou esperar."
    ),
    responses=ERROR_RESPONSES,
)
def list_incident_events(
    incident_id: UUID, actor: CurrentActor, service: ServiceDep
) -> IncidentTimelineResponse:
    """Devolve a timeline de auditoria do incidente."""
    return IncidentTimelineResponse(
        items=[
            IncidentEventRead.model_validate(event) for event in service.events(incident_id, actor)
        ]
    )


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
    actor: CurrentActor,
    service: ServiceDep,
    response: Response,
    if_match: Annotated[
        str | None,
        Header(alias="If-Match", description='Versão esperada, ex.: "3".'),
    ] = None,
) -> IncidentRead:
    """Aplica a transição de status sob lock otimista."""
    ensure_permission(actor, Permission.TRANSITION_INCIDENT)
    expected_version = resolve_expected_version(if_match, payload.expected_version)
    incident = service.change_status(
        incident_id, payload, expected_version=expected_version, actor=actor
    )
    _invalidate_listing_cache()
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
    actor: CurrentActor,
    service: ServiceDep,
    if_match: Annotated[
        str | None,
        Header(alias="If-Match", description="Versão esperada opcional, ex.: '3'."),
    ] = None,
) -> Response:
    """Executa o soft delete do incidente."""
    ensure_permission(actor, Permission.DELETE_INCIDENT)
    service.soft_delete(incident_id, expected_version=parse_if_match(if_match), actor=actor)
    _invalidate_listing_cache()
    return Response(status_code=204)
