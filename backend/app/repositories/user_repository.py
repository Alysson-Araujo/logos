"""Acesso a dados do usuário autenticável."""

from __future__ import annotations

from datetime import datetime
from uuid import UUID, uuid4

from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.domain.accounts import normalize_email
from app.domain.enums import UserRole
from app.models.user import User


class UserRepository:
    """Consultas e gravações da tabela `users`."""

    def __init__(self, session: Session) -> None:
        """Guarda a sessão usada nas operações."""
        self._session = session

    def get_by_id(self, user_id: UUID) -> User | None:
        """Busca pelo identificador."""
        return self._session.get(User, user_id)

    def get_by_email(self, email: str) -> User | None:
        """Busca pelo e-mail, normalizado antes da consulta.

        Normalizar aqui, e não só na gravação, é o que faz o login funcionar
        quando a pessoa digita `Ana@empresa.com`: sem isso a consulta não
        encontraria a linha gravada em minúsculas.
        """
        statement = select(User).where(User.email == normalize_email(email))
        return self._session.scalar(statement)

    def create(
        self,
        *,
        email: str,
        password_hash: str,
        name: str,
        role: UserRole,
        is_active: bool = True,
    ) -> User:
        """Insere um usuário e confirma a transação."""
        user = User(
            id=uuid4(),
            email=normalize_email(email),
            password_hash=password_hash,
            name=name,
            role=role,
            is_active=is_active,
        )
        self._session.add(user)
        self._session.commit()
        return user

    def register_last_login(self, user: User, *, now: datetime) -> None:
        """Grava o instante do login e confirma a transação."""
        user.last_login_at = now
        self._session.add(user)
        self._session.commit()

    def update_password(self, user: User, *, password_hash: str, now: datetime) -> None:
        """Troca o hash da senha e confirma a transação."""
        user.password_hash = password_hash
        user.updated_at = now
        self._session.add(user)
        self._session.commit()

    def count(self) -> int:
        """Quantidade de usuários cadastrados."""
        return int(self._session.scalar(select(func.count()).select_from(User)) or 0)

    def clear(self) -> None:
        """Remove todos os usuários (usado nos testes)."""
        self._session.execute(delete(User))
        self._session.commit()
