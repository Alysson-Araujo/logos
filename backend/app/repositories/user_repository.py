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
        temp_password_hash: str | None = None,
        invite_expires_at: datetime | None = None,
        invited_by_id: UUID | None = None,
    ) -> User:
        """Insere um usuário e confirma a transação.

        Nas contas criadas por convite, `password_hash` recebe um valor
        **inutilizável** e a credencial de entrada é a senha temporária: a senha
        definitiva só existe quando a própria pessoa a define.
        """
        user = User(
            id=uuid4(),
            email=normalize_email(email),
            password_hash=password_hash,
            name=name,
            role=role,
            is_active=is_active,
            temp_password_hash=temp_password_hash,
            invite_expires_at=invite_expires_at,
            invited_by_id=invited_by_id,
        )
        self._session.add(user)
        self._session.commit()
        return user

    def list_all(self) -> list[User]:
        """Lista todas as contas, das mais recentes para as mais antigas.

        A administração olha para o que acabou de criar, então a ordem natural é
        por data de criação decrescente — e o nome desempata para a lista não
        dançar entre duas contas criadas no mesmo instante.
        """
        statement = select(User).order_by(User.created_at.desc(), User.name.asc())
        return list(self._session.scalars(statement).all())

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

    def issue_invite(
        self,
        user: User,
        *,
        temp_password_hash: str,
        invite_expires_at: datetime,
        invited_by_id: UUID,
        now: datetime,
    ) -> None:
        """Registra (ou reemite) o convite e confirma a transação.

        Reemitir **substitui** o hash anterior, o que invalida na hora a senha
        temporária antiga: dois convites válidos ao mesmo tempo seriam duas
        credenciais circulando por e-mail.
        """
        user.temp_password_hash = temp_password_hash
        user.invite_expires_at = invite_expires_at
        user.invited_by_id = invited_by_id
        user.updated_at = now
        self._session.add(user)
        self._session.commit()

    def complete_invite(self, user: User, *, password_hash: str, now: datetime) -> None:
        """Conclui o primeiro acesso: senha definitiva, conta ativa e sem convite.

        Tudo numa transação só, porque os três estados precisam mudar juntos:
        uma conta ativa que ainda guarda a senha temporária seria uma credencial
        viva que ninguém mais controla.
        """
        user.password_hash = password_hash
        user.temp_password_hash = None
        user.invite_expires_at = None
        user.is_active = True
        user.updated_at = now
        # Encerra as sessões abertas antes desta troca — inclusive a do próprio
        # primeiro acesso, que era uma credencial temporária.
        user.sessions_valid_from = now
        self._session.add(user)
        self._session.commit()

    def set_active(self, user: User, *, is_active: bool, now: datetime) -> None:
        """Ativa ou desativa a conta e confirma a transação.

        Desativar **invalida o convite pendente**: manter uma senha temporária
        válida numa conta desativada deixaria uma porta de entrada aberta
        exatamente em quem foi afastado.
        """
        mudou_estado = user.is_active is not is_active
        user.is_active = is_active
        user.updated_at = now
        if not is_active:
            user.temp_password_hash = None
            user.invite_expires_at = None
        # Só um PATCH que MUDA o estado encerra sessões. Sem esta condição,
        # reativar uma conta já ativa seria um "não fazer nada" que derruba a
        # sessão de quem pediu — e o efeito seria uma tela de login sem motivo.
        #
        # Nos dois sentidos: ao desativar, para o token parar de valer na hora;
        # ao reativar, para um token emitido antes do afastamento não voltar à
        # vida junto com a conta.
        if mudou_estado:
            user.sessions_valid_from = now
        self._session.add(user)
        self._session.commit()

    def revoke_sessions(self, user: User, *, now: datetime) -> None:
        """Encerra as sessões abertas, sem mexer no resto do estado da conta.

        Marca o instante a partir do qual os tokens valem. Tudo que foi emitido
        antes dele deixa de ser aceito — é o que permite dizer "esta troca de
        senha encerrou as outras sessões" sem guardar os tokens emitidos.
        """
        user.sessions_valid_from = now
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
