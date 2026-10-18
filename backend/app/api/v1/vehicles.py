"""Busca de placas da frota, para o autocomplete do formulário."""

from __future__ import annotations

from typing import Final

from fastapi import APIRouter, Query

from app.api.deps import CurrentActor, VehicleRepositoryDep
from app.schemas.common import ErrorResponse
from app.schemas.vehicle import VehicleRead, VehicleSearchResponse

VEHICLE_RESPONSES: Final[dict[int | str, dict[str, object]]] = {
    401: {"model": ErrorResponse, "description": "Credencial ausente, inválida ou vencida"},
    500: {"model": ErrorResponse, "description": "Erro interno"},
}

router = APIRouter(prefix="/vehicles", tags=["frota"])


@router.get(
    "",
    response_model=VehicleSearchResponse,
    summary="Busca placas da frota pelo início",
    description=(
        "Devolve até `limit` veículos cuja placa **começa** com `q`. "
        "A busca é por prefixo, e não por trecho: `ABC` encontra `ABC1D23`, "
        "e não `XABC123` — é como se digita uma placa."
    ),
    responses=VEHICLE_RESPONSES,
)
def search_vehicles(
    repository: VehicleRepositoryDep,
    _actor: CurrentActor,
    q: str = Query("", max_length=8, description="Início da placa, em qualquer caixa."),
    limit: int = Query(8, ge=1, le=25, description="Tamanho máximo da lista devolvida."),
) -> VehicleSearchResponse:
    """Sugere placas para o autocomplete do formulário de incidente.

    **Exige autenticação**, ao contrário de `/meta/enums`. Os enums são catálogo
    do domínio, iguais para todo mundo e sem dono; a frota é dado do negócio —
    são os caminhões de um cliente. Quem consulta é quem já está dentro da
    central, que é exatamente quem registra incidente.

    `q` vazio é aceito e devolve os primeiros da frota em ordem de placa. Isso é
    o que faz o campo mostrar sugestões ao receber o foco, antes de qualquer
    tecla — e não uma lista vazia que parece campo quebrado.
    """
    prefixo = q.strip().upper()
    veiculos = repository.search_by_plate_prefix(prefixo, limit=limit)
    return VehicleSearchResponse(
        items=[VehicleRead.model_validate(veiculo) for veiculo in veiculos],
        total=repository.count(),
    )
