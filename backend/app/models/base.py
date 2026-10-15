"""Base declarativa do ORM e utilitários de tempo."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Final

from sqlalchemy import DateTime, MetaData
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

#: Convenção de nomes de constraints — evita nomes anônimos e facilita migrações futuras.
NAMING_CONVENTION: Final[dict[str, str]] = {
    "ix": "ix_%(column_0_label)s",
    "uq": "uq_%(table_name)s_%(column_0_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
    "pk": "pk_%(table_name)s",
}


class Base(DeclarativeBase):
    """Base declarativa de todos os modelos Logos."""

    metadata = MetaData(naming_convention=NAMING_CONVENTION)


def utcnow() -> datetime:
    """Instante atual em UTC sem timezone — formato de gravação no banco."""
    return datetime.now(UTC).replace(tzinfo=None)


class TimestampMixin:
    """Colunas de auditoria temporal reutilizáveis."""

    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=utcnow, onupdate=utcnow, nullable=False
    )
