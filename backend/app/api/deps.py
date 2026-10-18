"""Injeção de dependência e parsing das pré-condições HTTP."""

from __future__ import annotations

import re
from enum import StrEnum
from typing import Annotated, Final

from fastapi import Depends, Header, Request
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.database import get_session
from app.core.errors import (
    InvalidFilterError,
    PasswordChangeRequiredError,
    PreconditionFailedError,
    PreconditionRequiredError,
    UnauthenticatedError,
)
from app.core.idempotency import is_replay_safe
from app.core.mailer import Mailer, get_mailer
from app.core.tokens import TokenClaims, decode_access_token
from app.domain.identity import Actor
from app.infra.retry import RetryConfig, RetryPolicy
from app.models.user import User
from app.repositories.incident_repository import IncidentRepository
from app.repositories.revoked_token_repository import RevokedTokenRepository
from app.repositories.user_repository import UserRepository
from app.services.auth_service import AuthService
from app.services.incident_service import IncidentService
from app.services.user_service import UserService

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


def provide_mailer() -> Mailer:
    """Entrega a porta de e-mail da aplicação.

    Existe como dependência para poder ser trocada nos testes: o spy que conta
    os convites enviados entra por `app.dependency_overrides` sem que o serviço
    saiba de nada.
    """
    return get_mailer()


def get_user_service(
    users: Annotated[UserRepository, Depends(get_user_repository)],
    mailer: Annotated[Mailer, Depends(provide_mailer)],
) -> UserService:
    """Cria o serviço de administração de contas para a requisição."""
    return UserService(users, mailer, frontend_url=get_settings().frontend_url)


UserServiceDep = Annotated[UserService, Depends(get_user_service)]

#: Rotas que continuam liberadas enquanto a senha em uso é temporária.
#:
#: A lista é curta de propósito. Quem entrou com a senha do convite tem uma
#: credencial que **outra pessoa escolheu** e que viajou por e-mail: liberar o
#: resto da API faria o convite valer como acesso pleno ao papel.
#:
#: `logout` está aqui embora o contrato mencionasse apenas as duas primeiras.
#: Negar a saída deixaria a sessão viva por até 8 horas, que é o oposto do que a
#: restrição existe para proteger — e sair não concede poder nenhum.
PASSWORD_CHANGE_ALLOWED_PATHS: Final[frozenset[str]] = frozenset(
    {
        "/api/v1/auth/change-password",
        "/api/v1/auth/me",
        "/api/v1/auth/logout",
    }
)

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
    request: Request,
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
    5. Token emitido antes do corte de sessões da conta → não vale mais. É o que
       faz desativar a conta e trocar a senha encerrarem as sessões abertas.
    6. Senha temporária de convite → só as rotas de primeiro acesso respondem.
    """
    if revoked.is_revoked(claims.jti):
        raise UnauthenticatedError("Esta sessão foi encerrada. Entre novamente.")

    user = users.get_by_id(claims.user_id)
    if user is None:
        raise UnauthenticatedError("Esta sessão não é mais válida. Entre novamente.")

    # `is_active=False` significa duas coisas diferentes, e separá-las é o ponto:
    #
    # - **Conta convidada, ainda não ativada** — a senha temporária está lá, e a
    #   sessão de primeiro acesso precisa funcionar para a pessoa concluir o
    #   convite. É o próprio caminho de ativação.
    # - **Conta desativada por um administrador** — a senha temporária foi
    #   apagada junto (ver `UserRepository.set_active`), então não há primeiro
    #   acesso pendente e a sessão morre aqui.
    if not user.is_active and not user.must_change_password:
        raise UnauthenticatedError("Esta sessão não é mais válida. Entre novamente.")

    # `iat` é emitido com precisão de microssegundos, então a comparação é exata
    # e não precisa de folga. Desativar já é barrado acima, independentemente de
    # relógio; este corte existe para o token não voltar à vida numa reativação.
    #
    # O `issued_at` vem com fuso (o JWT é UTC) e a coluna guarda UTC **sem**
    # fuso, como o resto do projeto. Comparar os dois direto levanta TypeError —
    # ou seja, derrubaria a requisição com 500 em vez de recusar a sessão.
    corte = user.sessions_valid_from
    if corte is not None and claims.issued_at.replace(tzinfo=None) < corte:
        raise UnauthenticatedError("Esta sessão foi encerrada. Entre novamente.")

    if user.must_change_password and request.url.path not in PASSWORD_CHANGE_ALLOWED_PATHS:
        raise PasswordChangeRequiredError(
            details={
                "allowed": sorted(PASSWORD_CHANGE_ALLOWED_PATHS),
                "reason": "A senha em uso é temporária.",
            }
        )

    return user


CurrentUser = Annotated[User, Depends(get_current_user)]


def get_current_actor(user: CurrentUser) -> Actor:
    """Projeta o usuário autenticado no ator que as regras de domínio usam.

    O domínio não conhece o modelo ORM: recebe id, nome e papel. Assim as regras
    de permissão continuam puras e testáveis sem banco.
    """
    return Actor(id=user.id, name=user.name, role=user.role)


CurrentActor = Annotated[Actor, Depends(get_current_actor)]
