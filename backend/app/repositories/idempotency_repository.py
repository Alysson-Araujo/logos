"""Acesso aos registros de idempotência, com reserva atômica da chave.

A garantia de "executa uma vez só" mora aqui, e não no serviço: a reserva é uma
linha cuja chave primária é a própria `Idempotency-Key`. Duas requisições
simultâneas com a mesma chave não podem inserir as duas, então a segunda
encontra a reserva da primeira. É a mesma ideia do compare-and-swap do lock
otimista: a atomicidade vem do banco, não de um `if` em Python.
"""

from __future__ import annotations

from datetime import timedelta
from typing import Any, Final

from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models.base import utcnow
from app.models.idempotency_key import (
    STATUS_COMPLETED,
    STATUS_IN_PROGRESS,
    IdempotencyKey,
)

#: Por quanto tempo a resposta de uma chave fica disponível para reenvio.
DEFAULT_RETENTION: Final[timedelta] = timedelta(hours=24)


class IdempotencyRepository:
    """Operações sobre a tabela de chaves de idempotência."""

    def __init__(self, session: Session, *, retention: timedelta = DEFAULT_RETENTION) -> None:
        """Guarda a sessão e o tempo de retenção das chaves."""
        self._session = session
        self._retention = retention

    def get(self, key: str) -> IdempotencyKey | None:
        """Devolve o registro da chave, ou None quando ela é nova."""
        return self._session.get(IdempotencyKey, key)

    def reserve(self, key: str, request_hash: str) -> bool:
        """Tenta reservar a chave antes de executar a mutação.

        Devolve `False` quando a chave já existe — nesse caso quem chamou decide
        entre reenviar a resposta guardada ou recusar por corpo divergente.
        """
        self._session.add(
            IdempotencyKey(
                key=key,
                request_hash=request_hash,
                status=STATUS_IN_PROGRESS,
                expires_at=utcnow() + self._retention,
            )
        )
        try:
            self._session.commit()
        except IntegrityError:
            self._session.rollback()
            return False
        return True

    def complete(
        self,
        key: str,
        *,
        status_code: int,
        body: str | None,
        headers: dict[str, Any] | None,
    ) -> None:
        """Marca a chave como concluída e guarda a resposta devolvida."""
        registro = self._session.get(IdempotencyKey, key)
        if registro is None:
            return
        registro.status = STATUS_COMPLETED
        registro.response_status = status_code
        registro.response_body = body
        registro.response_headers = headers
        self._session.commit()

    def release(self, key: str) -> None:
        """Solta a reserva quando a resposta não é reaproveitável.

        É chamado quando a mutação falha (4xx ou 5xx): a chave precisa voltar a
        ficar livre para o cliente corrigir o pedido e tentar de novo com a
        mesma chave.
        """
        self._session.execute(delete(IdempotencyKey).where(IdempotencyKey.key == key))
        self._session.commit()

    def purge_expired(self) -> None:
        """Remove as chaves que passaram da retenção.

        Chamada em toda reserva: a tabela é um registro operacional de curto
        prazo, e a alternativa — um job de limpeza — seria mais uma peça móvel
        para um ganho que o índice de `expires_at` já torna barato.
        """
        self._session.execute(delete(IdempotencyKey).where(IdempotencyKey.expires_at < utcnow()))
        self._session.commit()

    def all_keys(self) -> list[str]:
        """Lista as chaves registradas (uso em teste e diagnóstico)."""
        return list(self._session.scalars(select(IdempotencyKey.key)))

    def clear(self) -> None:
        """Remove todas as chaves (isolamento entre testes)."""
        self._session.execute(delete(IdempotencyKey))
        self._session.commit()
