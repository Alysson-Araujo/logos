"""Exceções de domínio e handlers globais de erro da API."""

from __future__ import annotations

import logging
from datetime import UTC, datetime
from typing import Any
from uuid import uuid4

from fastapi import FastAPI, Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.core.logging import get_request_id, serialize_timestamp

logger = logging.getLogger(__name__)


class DomainError(Exception):
    """Erro de domínio com código estável, HTTP status e detalhes opcionais."""

    code: str = "DOMAIN_ERROR"
    status_code: int = 400
    default_message: str = "Erro de domínio."

    def __init__(
        self, message: str | None = None, *, details: dict[str, Any] | None = None
    ) -> None:
        """Guarda mensagem e detalhes para o envelope de erro."""
        self.message = message or self.default_message
        self.details = details
        super().__init__(self.message)


class IncidentNotFoundError(DomainError):
    """Incidente inexistente ou removido logicamente."""

    code = "INCIDENT_NOT_FOUND"
    status_code = 404
    default_message = "Incidente não encontrado."


class InvalidStatusTransitionError(DomainError):
    """Transição proibida pela máquina de estados."""

    code = "INVALID_STATUS_TRANSITION"
    status_code = 422
    default_message = "Transição de status não permitida."


class ResolutionNotesRequiredError(DomainError):
    """FECHADO e INCONCLUSIVO exigem justificativa registrada."""

    code = "RESOLUTION_NOTES_REQUIRED"
    status_code = 422
    default_message = "resolutionNotes é obrigatório para FECHADO e INCONCLUSIVO."


class VersionConflictError(DomainError):
    """O lock otimista falhou: alguém alterou o incidente antes."""

    code = "VERSION_CONFLICT"
    status_code = 409
    default_message = "O incidente foi alterado por outro usuário."


class PreconditionRequiredError(DomainError):
    """A mutação exige If-Match ou expectedVersion."""

    code = "PRECONDITION_REQUIRED"
    status_code = 428
    default_message = 'Informe a versão esperada via If-Match (ex.: "3") ou expectedVersion.'


class PreconditionFailedError(DomainError):
    """If-Match em formato inválido."""

    code = "PRECONDITION_FAILED"
    status_code = 412
    default_message = "If-Match malformado."


class IdempotencyKeyReusedError(DomainError):
    """A mesma Idempotency-Key chegou com um corpo diferente."""

    code = "IDEMPOTENCY_KEY_REUSED"
    status_code = 409
    default_message = "Esta Idempotency-Key já foi usada com um corpo diferente."


class IdempotencyKeyInProgressError(DomainError):
    """Ainda existe uma requisição em execução com esta chave.

    Não é erro do cliente: significa que o reenvio chegou antes de a primeira
    tentativa terminar. Repetir com a mesma chave resolve.
    """

    code = "IDEMPOTENCY_KEY_IN_PROGRESS"
    status_code = 409
    default_message = (
        "Uma requisição com esta Idempotency-Key ainda está em processamento. "
        "Repita com a mesma chave."
    )


class InvalidIdempotencyKeyError(DomainError):
    """Idempotency-Key vazia, longa demais ou com caracteres fora do permitido."""

    code = "INVALID_IDEMPOTENCY_KEY"
    status_code = 422
    default_message = "Idempotency-Key inválida."


class InvalidFilterError(DomainError):
    """Valor de filtro desconhecido na query string."""

    code = "INVALID_FILTER"
    status_code = 422
    default_message = "Filtro inválido."


class InvalidCursorError(DomainError):
    """Cursor de paginação ilegível."""

    code = "INVALID_CURSOR"
    status_code = 400
    default_message = "Cursor inválido."


class CodeGenerationError(DomainError):
    """Não foi possível gerar um código único de incidente."""

    code = "CODE_GENERATION_FAILED"
    status_code = 503
    default_message = "Não foi possível gerar o código do incidente."


def resolve_request_id(request: Request) -> str:
    """Recupera o request id da requisição ou cria um novo."""
    candidate = getattr(request.state, "request_id", None)
    if isinstance(candidate, str) and candidate:
        return candidate
    return get_request_id() or uuid4().hex


def build_error_payload(
    code: str,
    message: str,
    *,
    details: dict[str, Any] | None = None,
    request_id: str | None = None,
) -> dict[str, Any]:
    """Monta o envelope de erro único da API."""
    return {
        "error": {
            "code": code,
            "message": message,
            "details": details,
            "requestId": request_id or uuid4().hex,
            "timestamp": serialize_timestamp(datetime.now(UTC)),
        }
    }


def _http_error_code(status_code: int) -> str:
    """Traduz o status HTTP para um código estável de erro."""
    return f"HTTP_{status_code}"


def register_exception_handlers(app: FastAPI) -> None:
    """Registra os handlers globais que garantem o envelope de erro único."""

    @app.exception_handler(DomainError)
    async def _handle_domain_error(request: Request, exc: DomainError) -> JSONResponse:
        return JSONResponse(
            status_code=exc.status_code,
            content=build_error_payload(
                exc.code,
                exc.message,
                details=exc.details,
                request_id=resolve_request_id(request),
            ),
        )

    @app.exception_handler(RequestValidationError)
    async def _handle_validation_error(
        request: Request, exc: RequestValidationError
    ) -> JSONResponse:
        details: dict[str, Any] = {"validationErrors": jsonable_encoder(exc.errors())}
        return JSONResponse(
            status_code=422,
            content=build_error_payload(
                "VALIDATION_ERROR",
                "A requisição contém dados inválidos.",
                details=details,
                request_id=resolve_request_id(request),
            ),
        )

    @app.exception_handler(StarletteHTTPException)
    async def _handle_http_exception(request: Request, exc: StarletteHTTPException) -> JSONResponse:
        detail = exc.detail
        if isinstance(detail, dict):
            code = str(detail.get("code", _http_error_code(exc.status_code)))
            message = str(detail.get("message", "Erro na requisição."))
            details: dict[str, Any] | None = detail
        else:
            code = _http_error_code(exc.status_code)
            message = str(detail)
            details = None
        response = JSONResponse(
            status_code=exc.status_code,
            content=build_error_payload(
                code,
                message,
                details=details,
                request_id=resolve_request_id(request),
            ),
        )
        if exc.headers:
            response.headers.update(exc.headers)
        return response

    @app.exception_handler(Exception)
    async def _handle_unexpected_error(request: Request, exc: Exception) -> JSONResponse:
        logger.exception(
            "unhandled_exception",
            extra={
                "path": request.url.path,
                "method": request.method,
                "error_code": type(exc).__name__,
            },
        )
        return JSONResponse(
            status_code=500,
            content=build_error_payload(
                "INTERNAL_ERROR",
                "Erro interno inesperado.",
                request_id=resolve_request_id(request),
            ),
        )
