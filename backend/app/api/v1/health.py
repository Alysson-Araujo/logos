"""Endpoints de saúde (liveness e readiness)."""

from __future__ import annotations

from typing import Final

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from app.api.deps import SessionDep
from app.core.config import get_settings
from app.core.database import ping_database
from app.core.errors import build_error_payload, resolve_request_id
from app.schemas.common import CamelModel, ErrorResponse


class LivenessResponse(CamelModel):
    """Resposta do liveness probe."""

    status: str


class ReadinessResponse(CamelModel):
    """Resposta do readiness probe."""

    status: str
    database: str
    #: `smtp` quando o convite sai por servidor de e-mail; `log` quando a
    #: mensagem fica só no log. Aparece aqui de propósito: "o convite não
    #: chegou" e "o envio está desligado" parecem a mesma coisa para quem usa a
    #: tela, e não são.
    email: str


READINESS_RESPONSES: Final[dict[int | str, dict[str, object]]] = {
    503: {"model": ErrorResponse, "description": "Banco de dados indisponível"}
}

router = APIRouter(tags=["health"])


@router.get(
    "/health/live",
    response_model=LivenessResponse,
    summary="Liveness probe",
    description="Confirma apenas que o processo está vivo.",
)
def liveness() -> LivenessResponse:
    """Devolve o estado básico do processo."""
    return LivenessResponse(status="alive")


@router.get(
    "/health/ready",
    response_model=ReadinessResponse,
    summary="Readiness probe",
    description="Valida se o banco responde antes de liberar tráfego.",
    responses=READINESS_RESPONSES,
)
def readiness(session: SessionDep, request: Request) -> ReadinessResponse | JSONResponse:
    """Executa uma consulta trivial no banco e devolve 200 ou 503."""
    transporte = "smtp" if get_settings().smtp_host else "log"
    if ping_database(session):
        return ReadinessResponse(status="ready", database="ok", email=transporte)
    return JSONResponse(
        status_code=503,
        content=build_error_payload(
            "DATABASE_UNAVAILABLE",
            "Banco de dados indisponível no momento.",
            request_id=resolve_request_id(request),
        ),
    )
