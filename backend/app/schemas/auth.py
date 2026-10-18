"""Schemas do contrato de autenticação."""

from __future__ import annotations

from typing import Final
from uuid import UUID

from pydantic import Field

from app.domain.enums import UserRole
from app.schemas.common import CamelModel, UtcDateTime

#: Tipo do token devolvido no login. Fixo em Bearer: o cliente não escolhe.
#: O `noqa` silencia a regra de segredo embutido, que confunde o nome do campo
#: do contrato (`tokenType`) com uma credencial.
TOKEN_TYPE: Final[str] = "Bearer"  # noqa: S105


class LoginRequest(CamelModel):
    """Credenciais enviadas no login."""

    email: str = Field(min_length=3, max_length=160)
    password: str = Field(min_length=1, max_length=128)


class UserRead(CamelModel):
    """Usuário exposto pela API — nunca inclui o hash da senha."""

    id: UUID
    email: str
    name: str
    role: UserRole
    last_login_at: UtcDateTime | None


class LoginResponse(CamelModel):
    """Resposta do login: o token e quem entrou."""

    access_token: str
    token_type: str = TOKEN_TYPE
    #: Segundos até o vencimento. O cliente calcula o instante absoluto local.
    expires_in: int
    #: `true` quando a sessão entrou com a senha temporária do convite. Nesse
    #: estado, só `POST /auth/change-password`, `GET /auth/me` e o logout
    #: respondem — o restante devolve 403 `PASSWORD_CHANGE_REQUIRED`. A interface
    #: deve levar a pessoa direto para a tela de definir senha.
    must_change_password: bool = False
    user: UserRead


class ChangePasswordRequest(CamelModel):
    """Troca de senha do próprio usuário."""

    current_password: str = Field(min_length=1, max_length=128)
    new_password: str = Field(min_length=1, max_length=128)
