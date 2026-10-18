"""Rotas de administração de contas.

Todas exigem `ADMIN`. Não é uma checagem de conveniência: quem administra
contas escolhe **quem entra** e **com que papel** — é a permissão que distribui
todas as outras.
"""

from __future__ import annotations

from typing import Any, Final
from uuid import UUID

from fastapi import APIRouter, Response, status

from app.api.deps import CurrentActor, UserServiceDep
from app.domain.permissions import Permission, ensure_permission
from app.schemas.common import ErrorResponse
from app.schemas.user import InvitedUserRead, UserCreate, UserSummary, UserUpdate

ERROR_RESPONSES: Final[dict[int | str, dict[str, Any]]] = {
    401: {
        "model": ErrorResponse,
        "description": "Sem token válido.",
    },
    403: {
        "model": ErrorResponse,
        "description": (
            "Papel sem permissão (`INSUFFICIENT_ROLE`) ou senha temporária "
            "em uso (`PASSWORD_CHANGE_REQUIRED`)."
        ),
    },
    404: {
        "model": ErrorResponse,
        "description": "Conta não encontrada.",
    },
    409: {
        "model": ErrorResponse,
        "description": "E-mail já cadastrado ou tentativa de desativar a própria conta.",
    },
    429: {
        "model": ErrorResponse,
        "description": "Teto de requisições excedido.",
    },
    503: {
        "model": ErrorResponse,
        "description": "Banco indisponível ou circuit breaker aberto.",
    },
}

router = APIRouter(
    prefix="/users",
    tags=["contas"],
    responses=ERROR_RESPONSES,
)


@router.get(
    "",
    response_model=list[UserSummary],
    summary="Lista as contas",
    description=(
        "Devolve todas as contas, das mais recentes para as mais antigas. "
        "`invitePending` indica convite dentro do prazo que ainda não foi usado. "
        "**Nenhum hash de senha sai nesta resposta.**"
    ),
)
def list_users(actor: CurrentActor, service: UserServiceDep) -> list[UserSummary]:
    """Lista as contas cadastradas."""
    ensure_permission(actor, Permission.MANAGE_ACCOUNTS)
    return [UserSummary.model_validate(user) for user in service.list_users()]


@router.post(
    "",
    response_model=InvitedUserRead,
    status_code=status.HTTP_201_CREATED,
    summary="Cria uma conta e envia o convite",
    description=(
        "Cria a conta **inativa**, gera a senha temporária e envia por e-mail. "
        "A senha **não** aparece nesta resposta e o administrador não a escolhe: "
        "a credencial é de quem vai usá-la. A conta só passa a valer quando a "
        "pessoa conclui o primeiro acesso."
    ),
)
def create_user(
    payload: UserCreate,
    actor: CurrentActor,
    service: UserServiceDep,
) -> InvitedUserRead:
    """Cria a conta e dispara o convite."""
    ensure_permission(actor, Permission.MANAGE_ACCOUNTS)
    user, expires_at = service.create_user(
        email=payload.email,
        role=payload.role,
        name=payload.name,
        actor=actor,
    )
    return InvitedUserRead(
        id=user.id,
        email=user.email,
        role=user.role,
        invite_expires_at=expires_at,
    )


@router.post(
    "/{user_id}/invite",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Reenvia o convite",
    description=(
        "Gera uma senha temporária **nova** e um prazo novo. A senha anterior "
        "deixa de valer no mesmo instante: dois convites válidos ao mesmo tempo "
        "seriam duas credenciais circulando por e-mail."
    ),
)
def resend_invite(
    user_id: UUID,
    actor: CurrentActor,
    service: UserServiceDep,
) -> Response:
    """Reemite o convite com nova senha temporária."""
    ensure_permission(actor, Permission.MANAGE_ACCOUNTS)
    service.resend_invite(user_id, actor=actor)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.patch(
    "/{user_id}",
    response_model=UserSummary,
    summary="Ativa ou desativa uma conta",
    description=(
        "`isActive: false` desativa e encerra as sessões abertas; `true` "
        "reativa. Desativar também invalida um convite pendente, e um "
        "administrador não consegue desativar a própria conta."
    ),
)
def update_user(
    user_id: UUID,
    payload: UserUpdate,
    actor: CurrentActor,
    service: UserServiceDep,
) -> UserSummary:
    """Ativa ou desativa a conta."""
    ensure_permission(actor, Permission.MANAGE_ACCOUNTS)
    user = service.set_active(user_id, is_active=payload.is_active, actor=actor)
    return UserSummary.model_validate(user)
