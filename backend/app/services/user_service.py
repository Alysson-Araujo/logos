"""Casos de uso da administração de contas."""

from __future__ import annotations

import logging
import secrets
from collections.abc import Callable
from datetime import datetime, timedelta
from uuid import UUID

from app.core.errors import (
    CannotDeactivateSelfError,
    EmailAlreadyExistsError,
    InviteDeliveryFailedError,
    UserNotFoundError,
)
from app.core.mailer import MailDeliveryError, Mailer
from app.core.tokens import hash_password
from app.domain.accounts import (
    INVITE_TTL_HOURS,
    generate_temp_password,
    normalize_email,
)
from app.domain.enums import UserRole
from app.domain.identity import Actor
from app.infra.mail_templates import build_invite_email
from app.models.base import utcnow
from app.models.user import User
from app.repositories.user_repository import UserRepository

logger = logging.getLogger(__name__)


def derive_name_from_email(email: str) -> str:
    """Deriva um nome apresentável a partir do e-mail.

    `joana.prado@demo.example.com` vira `Joana Prado`. Serve para a lista de
    administração não mostrar o e-mail cru enquanto ninguém ajusta o nome —
    e é o padrão quando o corpo da criação não traz um.
    """
    local = normalize_email(email).split("@", 1)[0]
    partes = [parte for parte in local.replace("_", ".").replace("-", ".").split(".") if parte]
    if not partes:
        return local
    return " ".join(parte.capitalize() for parte in partes)


class UserService:
    """Convite, reenvio, listagem e ativação de contas."""

    def __init__(
        self,
        users: UserRepository,
        mailer: Mailer,
        *,
        frontend_url: str,
        now_provider: Callable[[], datetime] = utcnow,
    ) -> None:
        """Monta o serviço com o repositório e a porta de e-mail da requisição."""
        self._users = users
        self._mailer = mailer
        self._frontend_url = frontend_url
        self._now_provider = now_provider

    def _now(self) -> datetime:
        """Instante atual, injetável nos testes."""
        return self._now_provider()

    def list_users(self) -> list[User]:
        """Devolve todas as contas, das mais recentes para as mais antigas."""
        return self._users.list_all()

    def get_user(self, user_id: UUID) -> User:
        """Busca a conta ou levanta 404."""
        user = self._users.get_by_id(user_id)
        if user is None:
            raise UserNotFoundError(details={"id": str(user_id)})
        return user

    def create_user(
        self, *, email: str, role: UserRole, name: str | None, actor: Actor
    ) -> tuple[User, datetime]:
        """Cria a conta inativa e dispara o convite.

        A conta nasce **inativa** e sem senha definitiva: o acesso só passa a
        valer quando a pessoa conclui o primeiro acesso.
        """
        normalizado = normalize_email(email)
        if self._users.get_by_email(normalizado) is not None:
            raise EmailAlreadyExistsError(details={"email": normalizado})

        now = self._now()
        temp_password = generate_temp_password()
        expires_at = now + timedelta(hours=INVITE_TTL_HOURS)

        user = self._users.create(
            email=normalizado,
            # A conta não tem senha definitiva ainda. Gravar o hash de um valor
            # aleatório descartado garante que NENHUMA senha digitada confira —
            # melhor que deixar o campo vazio ou com um literal conhecido.
            password_hash=hash_password(secrets.token_urlsafe(32)),
            name=name or derive_name_from_email(normalizado),
            role=role,
            is_active=False,
            temp_password_hash=hash_password(temp_password),
            invite_expires_at=expires_at,
            invited_by_id=actor.id,
        )

        self._send_invite(user, temp_password=temp_password, expires_at=expires_at)
        return user, expires_at

    def resend_invite(self, user_id: UUID, *, actor: Actor) -> datetime:
        """Emite um convite novo, invalidando o anterior."""
        user = self.get_user(user_id)

        now = self._now()
        temp_password = generate_temp_password()
        expires_at = now + timedelta(hours=INVITE_TTL_HOURS)

        # `issue_invite` substitui o hash: a senha temporária antiga morre aqui.
        self._users.issue_invite(
            user,
            temp_password_hash=hash_password(temp_password),
            invite_expires_at=expires_at,
            invited_by_id=actor.id,
            now=now,
        )
        self._send_invite(user, temp_password=temp_password, expires_at=expires_at)
        return expires_at

    def set_active(self, user_id: UUID, *, is_active: bool, actor: Actor) -> User:
        """Ativa ou desativa a conta.

        Um administrador não desativa a própria conta: sem isso, o último
        administrador ativo poderia se afastar e deixar o sistema sem ninguém
        capaz de gerenciar contas.
        """
        user = self.get_user(user_id)

        if not is_active and user.id == actor.id:
            raise CannotDeactivateSelfError(details={"id": str(user.id)})

        self._users.set_active(user, is_active=is_active, now=self._now())
        return user

    def _send_invite(self, user: User, *, temp_password: str, expires_at: datetime) -> None:
        """Envia o e-mail do convite, e propaga a falha.

        A versão anterior engolia qualquer exceção aqui e registrava um
        `logger.exception`. O resultado foi o pior modo de falha possível: o
        SMTP recusava a credencial, a API respondia `201`, a tela dizia "Convite
        enviado" e **o e-mail não chegava**. Nada quebrado para investigar, só
        uma linha de log de ERROR que ninguém lê.

        A conta continua criada quando o envio falha — desfazê-la geraria um
        problema pior: o administrador tentaria de novo, bateria em
        `EMAIL_ALREADY_EXISTS` e ficaria sem entender por quê. O que muda é que
        a falha agora **aparece**, como `INVITE_DELIVERY_FAILED`, e a saída é
        "Reenviar convite".

        Um e-mail que falha **não** deve derrubar a requisição com um `500`: o
        problema é de um serviço externo, e a mensagem de erro precisa dizer isso
        e o que fazer a seguir.
        """
        mensagem = build_invite_email(
            to=user.email,
            name=user.name,
            role=user.role.value,
            temp_password=temp_password,
            expires_at=expires_at,
            frontend_url=self._frontend_url,
        )
        try:
            self._mailer.send(mensagem)
        except MailDeliveryError as exc:
            logger.error(
                "falha_ao_enviar_convite email=%s detalhe=%s",
                user.email,
                exc,
            )
            raise InviteDeliveryFailedError(
                details={"email": user.email, "reason": str(exc)},
            ) from exc
        logger.info("convite_enviado email=%s", user.email)
