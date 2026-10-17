"""Injeção de dependência e parsing das pré-condições HTTP."""

from __future__ import annotations

import re
from enum import StrEnum
from typing import Annotated, Final

from fastapi import Depends, Header
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.database import get_session
from app.core.errors import (
    InvalidFilterError,
    PreconditionFailedError,
    PreconditionRequiredError,
    UnauthenticatedError,
)
from app.core.idempotency import is_replay_safe
from app.core.tokens import TokenClaims, decode_access_token
from app.infra.retry import RetryConfig, RetryPolicy
from app.models.user import User
from app.repositories.incident_repository import IncidentRepository
from app.repositories.revoked_token_repository import RevokedTokenRepository
from app.repositories.user_repository import UserRepository
from app.services.auth_service import AuthService
from app.services.incident_service import IncidentService

#: Aceita `If-Match: "3"` e a forma fraca `W/"3"`.
IF_MATCH_PATTERN = re.compile(r'^(?:W/)?"(?P<version>[0-9]+)"$')

SessionDep = Annotated[Session, Depends(get_session)]


def get_incident_repository(session: SessionDep) -> IncidentRepository:
    """Cria o repositório de incidentes para a requisição."""
    return IncidentRepository(session)


RepositoryDep = Annotated[IncidentRepository, Depends(get_incident_repository)]


def get_incident_service(repository: RepositoryDep) -> IncidentService:
    """Cria o serviço de incidentes para a requisição, com a política de retentativa.

    Os limites vêm da configuração; a permissão de repetir uma escrita vem do
    marcador que o middleware de idempotência deixa quando o cliente envia
    `Idempotency-Key`.
    """
    settings = get_settings()
    return IncidentService(
        repository,
        retry=RetryConfig(
            policy=RetryPolicy(
                max_attempts=settings.retry_max_attempts,
                base_delay=settings.retry_base_delay_seconds,
            ),
            request_allows_replay=is_replay_safe(),
        ),
    )


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


def get_user_repository(session: SessionDep) -> UserRepository:
    """Cria o repositório de usuários para a requisição."""
    return UserRepository(session)


def get_revoked_token_repository(session: SessionDep) -> RevokedTokenRepository:
    """Cria o repositório de tokens revogados para a requisição."""
    return RevokedTokenRepository(session)


def get_auth_service(
    users: Annotated[UserRepository, Depends(get_user_repository)],
    revoked: Annotated[RevokedTokenRepository, Depends(get_revoked_token_repository)],
) -> AuthService:
    """Cria o serviço de autenticação para a requisição."""
    return AuthService(users, revoked)


AuthServiceDep = Annotated[AuthService, Depends(get_auth_service)]

BEARER_PREFIX: Final[str] = "bearer "


def extract_bearer_token(authorization: str | None) -> str:
    """Extrai o token de um header `Authorization: Bearer <token>`."""
    if authorization is None or not authorization.strip():
        raise UnauthenticatedError("Informe o header Authorization com o token de acesso.")

    valor = authorization.strip()
    if not valor.lower().startswith(BEARER_PREFIX):
        raise UnauthenticatedError('O header Authorization deve usar o esquema "Bearer".')
    return valor[len(BEARER_PREFIX) :].strip()


def get_current_claims(
    authorization: Annotated[str | None, Header()] = None,
) -> TokenClaims:
    """Valida o token de acesso e devolve as claims.

    Separado de `get_current_user` porque o logout precisa do `jti` e do
    vencimento — e não do usuário.
    """
    token = extract_bearer_token(authorization)
    return decode_access_token(token)


CurrentClaims = Annotated[TokenClaims, Depends(get_current_claims)]


def get_current_user(
    claims: CurrentClaims,
    users: Annotated[UserRepository, Depends(get_user_repository)],
    revoked: Annotated[RevokedTokenRepository, Depends(get_revoked_token_repository)],
) -> User:
    """Resolve o usuário autenticado a partir das claims já validadas.

    A ordem das checagens é o ponto:

    1. Sem header, ou fora do formato `Bearer` → não sei quem você é.
    2. Assinatura e vencimento conferidos **antes de tocar no banco**: um token
       forjado custa zero de I/O.
    3. Token revogado por logout → não vale mais.
    4. Usuário apagado, ou desativado depois do login, responde **401** e não
       403: a sessão deixou de existir. Um 403 sugeriria "você está logado, mas
       sem permissão", que seria falso.
    """
    if revoked.is_revoked(claims.jti):
        raise UnauthenticatedError("Esta sessão foi encerrada. Entre novamente.")

    user = users.get_by_id(claims.user_id)
    if user is None or not user.is_active:
        raise UnauthenticatedError("Esta sessão não é mais válida. Entre novamente.")

    return user


CurrentUser = Annotated[User, Depends(get_current_user)]
