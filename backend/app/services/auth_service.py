"""Regras de autenticação: login, logout e troca de senha."""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime

from app.core.errors import InvalidCredentialsError
from app.core.tokens import AccessToken, create_access_token, hash_password, verify_password
from app.domain.accounts import validate_password_strength
from app.models.base import utcnow
from app.models.user import User
from app.repositories.revoked_token_repository import RevokedTokenRepository
from app.repositories.user_repository import UserRepository
from app.schemas.auth import TOKEN_TYPE

#: Hash descartável usado quando o e-mail não existe.
#:
#: Sem ele, um login com e-mail inexistente responderia muito mais rápido que
#: um com senha errada — a diferença de tempo entregaria quais e-mails estão
#: cadastrados, mesmo com a mensagem de erro sendo idêntica. Verificar contra
#: este hash gasta o mesmo tempo de Argon2 nos dois casos.
_DUMMY_HASH = hash_password("hash-descartavel-para-igualar-o-tempo-de-resposta")


@dataclass(frozen=True, slots=True)
class AuthenticatedSession:
    """Resultado de um login bem-sucedido."""

    token: AccessToken
    user: User
    #: Instante do login ANTERIOR, para a interface mostrar "último acesso".
    previous_login_at: datetime | None
    #: A sessão entrou com a senha temporária do convite e só permite trocá-la.
    must_change_password: bool = False
    token_type: str = TOKEN_TYPE


class AuthService:
    """Casos de uso de autenticação."""

    def __init__(
        self,
        users: UserRepository,
        revoked_tokens: RevokedTokenRepository,
        *,
        now_provider: Callable[[], datetime] = utcnow,
    ) -> None:
        """Monta o serviço com os repositórios da requisição."""
        self._users = users
        self._revoked = revoked_tokens
        self._now_provider = now_provider

    def _now(self) -> datetime:
        """Instante atual, injetável nos testes."""
        return self._now_provider()

    def login(self, *, email: str, password: str) -> AuthenticatedSession:
        """Autentica o usuário e emite um token.

        E-mail inexistente, senha errada, conta desativada e **convite vencido**
        produzem a MESMA exceção, com o mesmo tempo de resposta. Distinguir os
        casos permitiria descobrir quem tem conta, e uma resposta específica
        para conta desativada confirmaria que a senha estava certa.

        São dois caminhos de entrada, e eles não se misturam:

        - **Senha definitiva** — sessão de trabalho, com o papel valendo.
        - **Senha temporária do convite** — primeiro acesso. Emite um token
          marcado com `must_change_password`, que só serve para definir a senha.
        """
        user = self._users.get_by_email(email)

        if user is None:
            # Gasta o mesmo tempo de derivação do caminho com usuário real.
            verify_password(password, _DUMMY_HASH)
            raise InvalidCredentialsError()

        now = self._now()

        # A verificação da temporária acontece SEMPRE que existe uma, inclusive
        # quando o prazo já venceu: pular a derivação nesse caso faria o convite
        # vencido responder mais rápido, e a diferença de tempo denunciaria
        # quais e-mails têm convite.
        temp_hash = user.temp_password_hash
        if temp_hash is not None and verify_password(password, temp_hash):
            if user.invite_expires_at is not None and user.invite_expires_at > now:
                token = create_access_token(user_id=user.id, role=user.role)
                return AuthenticatedSession(
                    token=token,
                    user=user,
                    # NÃO registra o acesso: entrar com a temporária é trocar de
                    # credencial, não começar a trabalhar. Registrar faria o
                    # convite deixar de constar como pendente antes de a pessoa
                    # concluir o primeiro acesso.
                    previous_login_at=None,
                    must_change_password=True,
                )
            # Convite vencido: a senha temporária simplesmente não vale mais.
            raise InvalidCredentialsError()

        if not verify_password(password, user.password_hash) or not user.is_active:
            raise InvalidCredentialsError()

        previous_login_at = user.last_login_at
        token = create_access_token(user_id=user.id, role=user.role)

        # Só depois de montar a resposta: `lastLoginAt` precisa ser o acesso
        # ANTERIOR, não o de agora — senão a interface mostraria "último
        # acesso: agora", que não informa nada.
        self._users.register_last_login(user, now=now)

        return AuthenticatedSession(
            token=token,
            user=user,
            previous_login_at=previous_login_at,
            must_change_password=False,
        )

    def logout(self, *, jti: str, expires_at: datetime) -> None:
        """Revoga o token atual e limpa os vencidos."""
        self._revoked.revoke(jti, expires_at=expires_at)
        # A limpeza aproveita a mesma passagem: sem ela a lista de bloqueio
        # cresceria para sempre guardando tokens que já venceram sozinhos.
        self._revoked.purge_expired(now=self._now())

    def change_password(self, *, user: User, current_password: str, new_password: str) -> None:
        """Troca a senha do próprio usuário após conferir a atual.

        Dois caminhos, e a diferença importa:

        - **Troca comum** — a pessoa já tem uma senha e está escolhendo outra.
        - **Primeiro acesso** — a senha atual é a temporária do convite. Aqui a
          troca também **conclui o convite**: a temporária deixa de valer, a
          conta é ativada e o convite sai de pendente. É o único momento em que
          isso acontece, e é por isso que as três mudanças vão na mesma
          transação (ver `UserRepository.complete_invite`).
        """
        if not verify_password(current_password, user.password_hash):
            # No primeiro acesso a "senha atual" é a temporária, que não está em
            # `password_hash`. Sem esta segunda conferência, quem entrou pelo
            # convite não conseguiria definir a senha definitiva.
            temp_hash = user.temp_password_hash
            if temp_hash is None or not verify_password(current_password, temp_hash):
                raise InvalidCredentialsError("A senha atual está incorreta.")

        validate_password_strength(new_password)

        now = self._now()
        if user.must_change_password:
            self._users.complete_invite(user, password_hash=hash_password(new_password), now=now)
            return

        self._users.update_password(user, password_hash=hash_password(new_password), now=now)

        # Trocar a senha encerra as outras sessões: se a troca foi motivada por
        # suspeita de vazamento, deixar os tokens antigos vivos anularia o
        # motivo. Isto invalida inclusive o token que fez esta requisição — o
        # cliente precisa entrar de novo, e é o comportamento desejado.
        self._users.revoke_sessions(user, now=now)
