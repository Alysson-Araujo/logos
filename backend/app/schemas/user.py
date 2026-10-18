"""Schemas da administração de contas."""

from __future__ import annotations

import re
from typing import Final
from uuid import UUID

from pydantic import Field, field_validator

from app.domain.accounts import normalize_email
from app.domain.enums import UserRole
from app.schemas.common import CamelModel, UtcDateTime

#: Formato mínimo de e-mail. Deliberadamente permissivo: a validação de verdade
#: é a entrega da mensagem, e uma expressão rígida recusa endereços válidos.
EMAIL_PATTERN: Final[re.Pattern[str]] = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]{2,}$")


class UserSummary(CamelModel):
    """Conta como a tela de administração precisa vê-la."""

    id: UUID
    name: str
    email: str
    role: UserRole
    is_active: bool
    #: Derivado no modelo: existe convite dentro do prazo, ainda não utilizado.
    invite_pending: bool
    last_login_at: UtcDateTime | None
    created_at: UtcDateTime


class UserCreate(CamelModel):
    """Pedido de criação de conta.

    **Não há campo de senha.** Quem define a senha é a própria pessoa, no
    primeiro acesso; o servidor gera uma temporária e envia por e-mail. Um campo
    de senha aqui significaria o administrador escolhendo — e conhecendo — a
    credencial de outra pessoa.
    """

    email: str = Field(min_length=3, max_length=160)
    role: UserRole
    #: Opcional: sem ele, o nome é derivado do e-mail (`joana.prado` → `Joana Prado`).
    name: str | None = Field(default=None, min_length=2, max_length=120)

    @field_validator("email")
    @classmethod
    def _validar_email(cls, valor: str) -> str:
        """Normaliza e confere o formato, devolvendo sempre minúsculo."""
        normalizado = normalize_email(valor)
        if not EMAIL_PATTERN.match(normalizado):
            raise ValueError("Informe um e-mail válido.")
        return normalizado


class InvitedUserRead(CamelModel):
    """Resposta da criação e do reenvio de convite.

    **Não inclui a senha temporária.** Ela sai apenas no e-mail: devolvê-la na
    resposta colocaria a credencial no log do servidor, no histórico do navegador
    e em qualquer captura de tela da administração.
    """

    id: UUID
    email: str
    role: UserRole
    invite_expires_at: UtcDateTime


class UserUpdate(CamelModel):
    """Ativação e desativação."""

    #: Obrigatório: um PATCH vazio não deve ter efeito nenhum.
    is_active: bool
