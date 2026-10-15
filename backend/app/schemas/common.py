"""Schemas compartilhados: base camelCase, paginação e envelope de erro."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Annotated, Any

from pydantic import BaseModel, ConfigDict, PlainSerializer
from pydantic.alias_generators import to_camel


def serialize_datetime(value: datetime) -> str:
    """Serializa datetime em ISO-8601 UTC com sufixo Z (contrato do frontend)."""
    moment = value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)
    return moment.isoformat(timespec="seconds").replace("+00:00", "Z")


#: Datetime sempre serializado em UTC com sufixo Z.
UtcDateTime = Annotated[datetime, PlainSerializer(serialize_datetime, return_type=str)]


class CamelModel(BaseModel):
    """Base de schema: JSON em camelCase, Python em snake_case."""

    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
        from_attributes=True,
    )


class PageInfo(CamelModel):
    """Metadados da paginação por cursor."""

    next_cursor: str | None
    has_next_page: bool
    limit: int


class ErrorBody(CamelModel):
    """Corpo do erro padronizado."""

    code: str
    message: str
    details: dict[str, Any] | None
    request_id: str
    timestamp: UtcDateTime


class ErrorResponse(CamelModel):
    """Envelope de erro único devolvido por toda a API."""

    error: ErrorBody
