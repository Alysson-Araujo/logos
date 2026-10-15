"""Endpoint de metadados: categorias, criticidades e status com rótulos PT-BR."""

from __future__ import annotations

from typing import Final

from fastapi import APIRouter

from app.schemas.common import ErrorResponse
from app.schemas.meta import EnumsResponse, build_enums_response

META_RESPONSES: Final[dict[int | str, dict[str, object]]] = {
    500: {"model": ErrorResponse, "description": "Erro interno"}
}

router = APIRouter(tags=["meta"])


@router.get(
    "/meta/enums",
    response_model=EnumsResponse,
    summary="Catálogo de enums do domínio",
    description=(
        "Devolve as 5 categorias, as 3 criticidades e os 4 status com rótulo em PT-BR, "
        "cor (claro/escuro), ícone e metadados de priorização."
    ),
    responses=META_RESPONSES,
)
def get_enums() -> EnumsResponse:
    """Monta o catálogo a partir das fontes únicas do domínio."""
    return build_enums_response()
