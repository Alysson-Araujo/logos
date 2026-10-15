"""Modelo ORM do registro de idempotência das mutações.

Cada `Idempotency-Key` enviada pelo cliente vira uma linha aqui. A reserva
acontece **antes** de a requisição executar e é completada depois, com a
resposta devolvida. É isso que sustenta as três garantias:

- **reenvio seguro**: a mesma chave com o mesmo corpo devolve a resposta
  original, sem executar a mutação de novo;
- **uso indevido detectado**: a mesma chave com corpo diferente é `409`,
  porque reutilizar a chave para outra operação é erro do cliente;
- **concorrência**: duas requisições simultâneas com a mesma chave não
  executam as duas — a segunda encontra a reserva em andamento.

A retenção é limitada por `expires_at`: a tabela é um registro operacional de
curto prazo, não um histórico.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Final

from sqlalchemy import JSON, DateTime, Index, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, utcnow

#: Chave reservada, requisição ainda em execução.
STATUS_IN_PROGRESS: Final[str] = "in_progress"
#: Requisição concluída com sucesso e resposta guardada.
STATUS_COMPLETED: Final[str] = "completed"


class IdempotencyKey(Base):
    """Registro de uma chave de idempotência e da resposta que ela produziu."""

    __tablename__ = "idempotency_keys"
    __table_args__ = (
        # A limpeza das chaves expiradas roda em toda reserva, então precisa
        # deste índice para não virar varredura completa da tabela.
        Index("ix_idempotency_keys_expires_at", "expires_at"),
    )

    key: Mapped[str] = mapped_column(String(120), primary_key=True)
    #: SHA-256 do método, do caminho e do corpo: identifica a operação lógica.
    request_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default=STATUS_IN_PROGRESS)
    response_status: Mapped[int | None] = mapped_column(Integer, nullable=True)
    response_body: Mapped[str | None] = mapped_column(Text, nullable=True)
    #: Cabeçalhos que o cliente precisa receber de volta no reenvio (ETag, Location).
    response_headers: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
