"""Modelo ORM do token revogado."""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, String
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, utcnow


class RevokedToken(Base):
    """JWT revogado antes do vencimento natural.

    Sem esta tabela, o logout seria apenas o cliente esquecendo o token: um
    token capturado continuaria válido até expirar. Com ela, o `jti` entra numa
    lista de bloqueio e o token morre de verdade.
    """

    __tablename__ = "revoked_tokens"

    #: `jti` é o identificador único do token (claim `jti` do JWT).
    jti: Mapped[str] = mapped_column(String(32), primary_key=True)
    #: Guardado para a limpeza periódica: passado o vencimento, a linha é inútil.
    expires_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=utcnow)
