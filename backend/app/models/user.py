"""Modelo ORM do usuário autenticável."""

from __future__ import annotations

from datetime import datetime
from uuid import UUID, uuid4

from sqlalchemy import Boolean, DateTime, Enum, ForeignKey, String, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from app.domain.enums import UserRole
from app.models.base import Base, TimestampMixin, utcnow


class User(Base, TimestampMixin):
    """Usuário da central de resposta.

    O e-mail é gravado sempre em minúsculas (normalizado na criação), para que
    a restrição de unicidade não aceite `Ana@x.com` e `ana@x.com` como contas
    distintas — um erro clássico de cadastro que só aparece quando alguém tenta
    entrar com a grafia "errada".

    A conta nasce **inativa** e sem senha definitiva: quem a cria é um
    administrador, e quem define a senha é a própria pessoa no primeiro acesso.
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

    # --- Convite e primeiro acesso -----------------------------------------
    #: Hash da senha TEMPORÁRIA do convite. Nulo quando não há convite pendente.
    #: Guardada só como hash, como qualquer senha: nem o administrador que
    #: convidou consegue lê-la depois.
    temp_password_hash: Mapped[str | None] = mapped_column(String(255), nullable=True)
    #: Prazo do convite. Vencido, a senha temporária deixa de valer.
    invite_expires_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, index=True)
    #: Quem convidou — a administração de contas também precisa de autoria.
    invited_by_id: Mapped[UUID | None] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    #: Instante a partir do qual as sessões valem.
    #:
    #: Tudo que foi emitido **antes** dele deixa de ser aceito. É assim que
    #: desativar uma conta e trocar a senha encerram as sessões abertas — sem
    #: precisar guardar os tokens emitidos, e sem o efeito colateral de a
    #: reativação ressuscitar um token antigo.
    sessions_valid_from: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    @property
    def must_change_password(self) -> bool:
        """A credencial em uso é temporária?

        É o que o login devolve como `mustChangePassword` e o que bloqueia as
        demais rotas: enquanto for verdadeiro, a pessoa tem uma senha que outra
        pessoa escolheu — e não pode exercer o papel dela.
        """
        return self.temp_password_hash is not None

    @property
    def invite_pending(self) -> bool:
        """Existe convite dentro do prazo que a pessoa ainda não utilizou?

        "Não utilizou" é `last_login_at is None`, e o primeiro acesso com senha
        temporária **não** conta como login (ver `AuthService.login`): ele é uma
        troca de credencial, não uma sessão de trabalho.
        """
        return (
            self.temp_password_hash is not None
            and self.invite_expires_at is not None
            and self.invite_expires_at > utcnow()
            and self.last_login_at is None
        )
