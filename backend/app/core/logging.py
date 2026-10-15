"""Logging estruturado em JSON com correlação por requisição."""

from __future__ import annotations

import json
import logging
import sys
from contextvars import ContextVar, Token
from datetime import UTC, datetime
from typing import Any, Final

REQUEST_ID_HEADER: Final[str] = "X-Request-Id"

_EXTRA_FIELDS: Final[tuple[str, ...]] = (
    "method",
    "path",
    "status_code",
    "duration_ms",
    "event",
    "incident_id",
    "error_code",
)

_request_id: ContextVar[str | None] = ContextVar("logos_request_id", default=None)


def set_request_id(value: str | None) -> Token[str | None]:
    """Associa um request id ao contexto da execução atual."""
    return _request_id.set(value)


def reset_request_id(token: Token[str | None]) -> None:
    """Restaura o request id anterior do contexto."""
    _request_id.reset(token)


def get_request_id() -> str | None:
    """Devolve o request id do contexto atual, se existir."""
    return _request_id.get()


def serialize_timestamp(value: datetime) -> str:
    """Formata um datetime como ISO-8601 em UTC com sufixo Z."""
    if value.tzinfo is None:
        value = value.replace(tzinfo=UTC)
    return value.astimezone(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")


class JsonFormatter(logging.Formatter):
    """Formata cada registro de log como uma linha JSON."""

    def format(self, record: logging.LogRecord) -> str:
        """Monta o dicionário de log e devolve o JSON serializado."""
        payload: dict[str, Any] = {
            "timestamp": serialize_timestamp(datetime.now(UTC)),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }
        request_id = get_request_id()
        if request_id is not None:
            payload["requestId"] = request_id
        for field in _EXTRA_FIELDS:
            value = getattr(record, field, None)
            if value is not None:
                payload[field] = value
        if record.exc_info:
            payload["exception"] = self.formatException(record.exc_info)
        return json.dumps(payload, ensure_ascii=False)


def configure_logging(level: str = "INFO") -> None:
    """Configura o logger raiz para emitir JSON em stdout."""
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JsonFormatter())

    root_logger = logging.getLogger()
    root_logger.handlers = [handler]
    root_logger.setLevel(level.upper())

    for name in ("uvicorn", "uvicorn.error"):
        named_logger = logging.getLogger(name)
        named_logger.handlers = []
        named_logger.propagate = True

    # O middleware já registra método, rota, status e duração — evita linha duplicada.
    access_logger = logging.getLogger("uvicorn.access")
    access_logger.handlers = []
    access_logger.disabled = True
