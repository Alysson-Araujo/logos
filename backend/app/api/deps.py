"""Injeção de dependência e parsing das pré-condições HTTP."""

from __future__ import annotations

import re
from enum import StrEnum
from typing import Annotated

from fastapi import Depends
from sqlalchemy.orm import Session

from app.core.database import get_session
from app.core.errors import (
    InvalidFilterError,
    PreconditionFailedError,
    PreconditionRequiredError,
)
from app.repositories.incident_repository import IncidentRepository
from app.services.incident_service import IncidentService

#: Aceita `If-Match: "3"` e a forma fraca `W/"3"`.
IF_MATCH_PATTERN = re.compile(r'^(?:W/)?"(?P<version>[0-9]+)"$')

SessionDep = Annotated[Session, Depends(get_session)]


def get_incident_repository(session: SessionDep) -> IncidentRepository:
    """Cria o repositório de incidentes para a requisição."""
    return IncidentRepository(session)


RepositoryDep = Annotated[IncidentRepository, Depends(get_incident_repository)]


def get_incident_service(repository: RepositoryDep) -> IncidentService:
    """Cria o serviço de incidentes para a requisição."""
    return IncidentService(repository)


ServiceDep = Annotated[IncidentService, Depends(get_incident_service)]


def parse_enum_query[EnumT: StrEnum](
    values: list[str] | None,
    enum_type: type[EnumT],
    parameter: str,
) -> tuple[EnumT, ...]:
    """Aceita `?p=A&p=B` e `?p=A,B`, validando contra o enum informado."""
    if not values:
        return ()

    parsed: list[EnumT] = []
    invalid: list[str] = []
    for raw in values:
        for chunk in raw.split(","):
            candidate = chunk.strip()
            if not candidate:
                continue
            try:
                parsed.append(enum_type(candidate))
            except ValueError:
                invalid.append(candidate)

    if invalid:
        raise InvalidFilterError(
            f"Valor inválido para o filtro '{parameter}'.",
            details={
                "parameter": parameter,
                "invalid": invalid,
                "allowed": [item.value for item in enum_type],
            },
        )
    return tuple(dict.fromkeys(parsed))


def parse_if_match(if_match: str | None) -> int | None:
    """Extrai a versão de um header If-Match, ou None quando ausente."""
    if if_match is None:
        return None
    match = IF_MATCH_PATTERN.match(if_match.strip())
    if match is None:
        raise PreconditionFailedError(
            'If-Match deve seguir o formato "3" (ETag numérico entre aspas).',
            details={"ifMatch": if_match, "expectedFormat": '"<version>"'},
        )
    return int(match.group("version"))


def resolve_expected_version(if_match: str | None, body_version: int | None) -> int:
    """Resolve a versão esperada do lock otimista (header tem precedência)."""
    header_version = parse_if_match(if_match)
    if header_version is not None:
        return header_version
    if body_version is not None:
        return body_version
    raise PreconditionRequiredError()
