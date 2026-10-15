"""Aplicação FastAPI: lifespan, middlewares, handlers e rotas."""

from __future__ import annotations

import logging
import time
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager
from typing import Final
from uuid import uuid4

from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware

from app.api.router import api_router
from app.core.config import Settings, get_settings
from app.core.database import create_session, dispose_engine, ensure_schema_is_migrated
from app.core.errors import register_exception_handlers
from app.core.idempotency import REPLAYED_HEADER
from app.core.logging import (
    REQUEST_ID_HEADER,
    configure_logging,
    reset_request_id,
    set_request_id,
)
from app.core.rate_limit import rate_limit_middleware
from app.core.security import security_headers_middleware
from app.infra.seed import seed_incidents

API_PREFIX: Final[str] = "/api/v1"

logger = logging.getLogger(__name__)


def initialize_database(settings: Settings) -> None:
    """Valida que o schema existe e aplica o seed quando configurado.

    O schema NAO e criado aqui. Quem cria e o Alembic (`alembic upgrade head`),
    para existir uma unica fonte de verdade sobre a estrutura do banco: se a
    aplicacao criasse tabelas na subida, ela e as migracoes poderiam divergir
    sem que nada acusasse.
    """
    ensure_schema_is_migrated()
    if not settings.seed_on_startup:
        return
    with create_session() as session:
        created = seed_incidents(session)
    logger.info("seed executado: %s incidentes criados", created)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    """Prepara o banco na subida e libera o pool no shutdown."""
    settings = get_settings()
    configure_logging(settings.log_level)
    initialize_database(settings)
    logger.info("api iniciada: ambiente=%s banco=%s", settings.environment, settings.database_url)
    try:
        yield
    finally:
        dispose_engine()
        logger.info("api finalizada")


async def request_context_middleware(
    request: Request,
    call_next: Callable[[Request], Awaitable[Response]],
) -> Response:
    """Propaga o X-Request-Id e registra uma linha de log por requisição."""
    request_id = request.headers.get(REQUEST_ID_HEADER) or uuid4().hex
    request.state.request_id = request_id
    token = set_request_id(request_id)
    started_at = time.perf_counter()
    status_code = 500
    try:
        response = await call_next(request)
        status_code = response.status_code
        response.headers[REQUEST_ID_HEADER] = request_id
        return response
    finally:
        elapsed_ms = round((time.perf_counter() - started_at) * 1000, 2)
        logger.info(
            "http_request",
            extra={
                "method": request.method,
                "path": request.url.path,
                "status_code": status_code,
                "duration_ms": elapsed_ms,
            },
        )
        reset_request_id(token)


def create_app(settings: Settings | None = None) -> FastAPI:
    """Monta a aplicação FastAPI com middlewares, handlers e rotas."""
    current = settings or get_settings()
    configure_logging(current.log_level)

    application = FastAPI(
        title=current.app_name,
        version=current.app_version,
        description=(
            "Central de Resposta a Incidentes. API com máquina de estados explícita, "
            "priority score determinístico e lock otimista (compare-and-swap) na transição "
            "de status."
        ),
        lifespan=lifespan,
        docs_url="/docs" if current.docs_enabled else None,
        redoc_url="/redoc" if current.docs_enabled else None,
        openapi_url="/openapi.json" if current.docs_enabled else None,
    )

    application.add_middleware(
        CORSMiddleware,
        allow_origins=current.cors_origin_list,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=["*"],
        expose_headers=[REQUEST_ID_HEADER, "ETag", "Location", REPLAYED_HEADER],
    )
    # A ordem de registro e o inverso da ordem de execucao: o ultimo middleware
    # adicionado roda mais por fora. A pilha resultante, de fora para dentro, e
    # request_context -> security_headers -> rate_limit -> CORS -> rotas.
    #
    # Isso importa por dois motivos: o request_id precisa ja existir quando o
    # rate limit recusar, para a resposta e o log terem correlacao entre si; e os
    # cabecalhos de seguranca precisam envolver o rate limit para valerem tambem
    # na resposta 429.
    application.middleware("http")(rate_limit_middleware)
    application.middleware("http")(security_headers_middleware)
    application.middleware("http")(request_context_middleware)

    register_exception_handlers(application)
    application.include_router(api_router, prefix=API_PREFIX)
    return application


app = create_app()
