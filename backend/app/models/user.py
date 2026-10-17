"""Modelo ORM do usuário autenticável."""

from __future__ import annotations

from datetime import datetime
from uuid import UUID, uuid4

from sqlalchemy import Boolean, DateTime, Enum, String, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from app.domain.enums import UserRole
from app.models.base import Base, TimestampMixin


class User(Base, TimestampMixin):
    """Usuário da central de resposta.

    O e-mail é gravado sempre em minúsculas (normalizado na criação), para que
    a restrição de unicidade não aceite `Ana@x.com` e `ana@x.com` como contas
    distintas — um erro clássico de cadastro que só aparece quando alguém tenta
    entrar com a grafia "errada".
    """

    __tablename__ = "users"

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    email: Mapped[str] = mapped_column(String(160), nullable=False, unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    role: Mapped[UserRole] = mapped_column(
        Enum(UserRole, native_enum=False, length=20), nullable=False
    )
    #: Desativar sem apagar preserva a autoria dos eventos já registrados.
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
