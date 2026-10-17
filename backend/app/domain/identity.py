"""Quem está agindo numa requisição.

O `Actor` existe para deixar explícito, no tipo, de onde vem a identidade:
**do token**, nunca do corpo da requisição. Antes da autenticação, o campo
`actor` dos eventos de auditoria era um texto que o cliente escolhia — ou seja,
o histórico registrava quem o cliente dizia ser.
"""

from __future__ import annotations

from dataclasses import dataclass
from uuid import UUID

from app.domain.enums import UserRole


@dataclass(frozen=True, slots=True)
class Actor:
    """Identidade autenticada que executa uma operação."""

    id: UUID
    name: str
    role: UserRole
