"""Matriz de permissões por papel.

A matriz inteira vive aqui, e não espalhada em dependências por rota. Dois
motivos: existe um lugar único para auditar quem pode o quê, e a suíte consegue
verificar a matriz de uma vez, em vez de descobrir buracos rota a rota.
"""

from __future__ import annotations

from enum import StrEnum
from typing import Final
from uuid import UUID

from app.core.errors import InsufficientRoleError
from app.domain.enums import UserRole
from app.domain.identity import Actor


class Permission(StrEnum):
    """Ações que exigem verificação de papel."""

    #: Registrar um incidente novo.
    CREATE_INCIDENT = "CREATE_INCIDENT"
    #: Enxergar incidentes de qualquer autor. Sem isto, só os próprios.
    SEE_EVERY_INCIDENT = "SEE_EVERY_INCIDENT"
    #: Assumir e conduzir o ciclo de vida.
    TRANSITION_INCIDENT = "TRANSITION_INCIDENT"
    #: Remover logicamente.
    DELETE_INCIDENT = "DELETE_INCIDENT"
    #: Criar contas, convidar, reenviar convite e ativar/desativar.
    MANAGE_ACCOUNTS = "MANAGE_ACCOUNTS"


#: Permissões de cada papel.
#:
#: `REPORTER` é o operador de rádio ou do 0800: registra o que aconteceu na
#: estrada e acompanha o que ele mesmo abriu. `ANALYST` conduz a fila inteira.
#: `ADMIN` é o único que remove — remover é irreversível pela API.
PERMISSIONS_BY_ROLE: Final[dict[UserRole, frozenset[Permission]]] = {
    UserRole.REPORTER: frozenset({Permission.CREATE_INCIDENT}),
    UserRole.ANALYST: frozenset(
        {
            Permission.CREATE_INCIDENT,
            Permission.SEE_EVERY_INCIDENT,
            Permission.TRANSITION_INCIDENT,
        }
    ),
    UserRole.ADMIN: frozenset(Permission),
}


def has_permission(role: UserRole, permission: Permission) -> bool:
    """Indica se o papel possui a permissão."""
    return permission in PERMISSIONS_BY_ROLE[role]


def ensure_permission(actor: Actor, permission: Permission) -> None:
    """Levanta 403 quando o papel não possui a permissão.

    403, e não 401: a identidade está estabelecida, o que falta é autorização —
    a distinção importa para o cliente decidir entre "entrar de novo" e "pedir
    acesso a alguém".
    """
    if has_permission(actor.role, permission):
        return
    raise InsufficientRoleError(
        details={
            "role": actor.role.value,
            "required": permission.value,
        }
    )


def visibility_scope(actor: Actor) -> UUID | None:
    """Autor cujo conteúdo o ator enxerga, ou `None` quando enxerga tudo.

    Devolve o próprio id de quem só vê o que criou. O escopo entra na **query**
    da listagem, e não num filtro em memória depois de carregar — filtrar depois
    vazaria a contagem total e o esforço de paginação.
    """
    if has_permission(actor.role, Permission.SEE_EVERY_INCIDENT):
        return None
    return actor.id
