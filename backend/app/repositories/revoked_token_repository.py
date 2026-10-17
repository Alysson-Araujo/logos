"""Acesso a dados dos tokens revogados (logout)."""

from __future__ import annotations

from datetime import datetime
from typing import Any, cast

from sqlalchemy import delete, func, select
from sqlalchemy.engine import CursorResult
from sqlalchemy.orm import Session

from app.models.base import utcnow
from app.models.revoked_token import RevokedToken


class RevokedTokenRepository:
    """Lista de bloqueio dos tokens que ainda não venceram."""

    def __init__(self, session: Session) -> None:
        """Guarda a sessão usada nas operações."""
        self._session = session

    def is_revoked(self, jti: str) -> bool:
        """Indica se o token foi revogado por um logout."""
        statement = select(func.count()).select_from(RevokedToken).where(RevokedToken.jti == jti)
        return int(self._session.scalar(statement) or 0) > 0

    def revoke(self, jti: str, *, expires_at: datetime) -> None:
        """Registra o token como revogado.

        `expires_at` é guardado junto para que a limpeza periódica saiba quando
        a linha deixou de ser útil: passado o vencimento natural, o token seria
        recusado de qualquer forma e a linha só ocuparia espaço.
        """
        self._session.add(RevokedToken(jti=jti, expires_at=expires_at))
        self._session.commit()

    def purge_expired(self, *, now: datetime | None = None) -> int:
        """Apaga os registros de tokens que já venceram naturalmente."""
        momento = now or utcnow()
        # `Session.execute` é tipado como Result; o DELETE devolve CursorResult
        # com rowcount — mesmo tratamento usado no repositório de incidentes.
        resultado = cast(
            "CursorResult[Any]",
            self._session.execute(delete(RevokedToken).where(RevokedToken.expires_at < momento)),
        )
        self._session.commit()
        return int(resultado.rowcount or 0)

    def count(self) -> int:
        """Quantidade de tokens revogados e ainda válidos."""
        return int(self._session.scalar(select(func.count()).select_from(RevokedToken)) or 0)

    def clear(self) -> None:
        """Remove todos os registros (usado entre testes)."""
        self._session.execute(delete(RevokedToken))
        self._session.commit()
