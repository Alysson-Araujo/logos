"""Hash de senha com Argon2id e emissão/validação do token de acesso."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Final
from uuid import UUID, uuid4

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import Argon2Error, InvalidHashError

from app.core.config import get_settings
from app.core.errors import TokenExpiredError, UnauthenticatedError
from app.domain.enums import UserRole

#: Único algoritmo aceito na verificação. A lista é fixa de propósito: escolher
#: o algoritmo a partir do campo `alg` do próprio token é a vulnerabilidade
#: clássica de JWT — o atacante assina com `none`, ou troca RSA por HMAC
#: usando a chave pública como segredo.
ALGORITHM: Final[str] = "HS256"

#: Claims sem os quais o token não identifica ninguém.
REQUIRED_CLAIMS: Final[tuple[str, ...]] = ("sub", "jti", "exp")

_hasher = PasswordHasher()


@dataclass(frozen=True, slots=True)
class AccessToken:
    """Token emitido e o que a API precisa para descrevê-lo na resposta."""

    token: str
    jti: str
    expires_at: datetime


@dataclass(frozen=True, slots=True)
class TokenClaims:
    """Conteúdo já verificado de um token de acesso."""

    user_id: UUID
    jti: str
    role: UserRole
    expires_at: datetime


def hash_password(password: str) -> str:
    """Deriva o hash Argon2id da senha.

    O sal é aleatório por senha e vai embutido no próprio hash, junto com os
    parâmetros de custo — por isso trocar o custo depois não invalida as senhas
    já cadastradas.
    """
    return _hasher.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    """Confere a senha contra o hash, devolvendo apenas verdadeiro ou falso.

    Não levanta exceção nem informa o motivo da falha: quem chama já vai
    responder a mesma coisa para senha errada, e-mail inexistente e conta
    desativada. Um hash corrompido também devolve falso, em vez de derrubar a
    requisição com 500.
    """
    try:
        return _hasher.verify(password_hash, password)
    except (Argon2Error, InvalidHashError, ValueError):
        return False


def create_access_token(
    *, user_id: UUID, role: UserRole, ttl_seconds: int | None = None
) -> AccessToken:
    """Emite um token de acesso assinado para o usuário."""
    settings = get_settings()
    ttl = settings.auth_token_ttl_seconds if ttl_seconds is None else ttl_seconds

    issued_at = datetime.now(UTC)
    expires_at = issued_at + timedelta(seconds=ttl)
    jti = uuid4().hex

    payload = {
        "sub": str(user_id),
        "jti": jti,
        "role": role.value,
        "iat": int(issued_at.timestamp()),
        "exp": int(expires_at.timestamp()),
    }
    token = jwt.encode(payload, settings.auth_secret_key, algorithm=ALGORITHM)
    return AccessToken(token=token, jti=jti, expires_at=expires_at)


def decode_access_token(token: str) -> TokenClaims:
    """Valida a assinatura e o vencimento, devolvendo as claims úteis.

    A verificação acontece **antes de qualquer acesso ao banco**: um token
    forjado ou adulterado é recusado sem custo de I/O.
    """
    settings = get_settings()
    try:
        payload = jwt.decode(
            token,
            settings.auth_secret_key,
            algorithms=[ALGORITHM],
            options={"require": list(REQUIRED_CLAIMS)},
        )
    except jwt.ExpiredSignatureError as exc:
        # Único caso em que o cliente pode tentar renovar em vez de relogar.
        raise TokenExpiredError() from exc
    except jwt.PyJWTError as exc:
        # Assinatura inválida, token malformado, claim obrigatória ausente,
        # algoritmo inesperado: tudo isso é "não sei quem você é".
        raise UnauthenticatedError("Token de acesso inválido.") from exc

    try:
        user_id = UUID(str(payload["sub"]))
        role = UserRole(str(payload.get("role", "")))
    except (ValueError, KeyError) as exc:
        # Assinatura válida mas conteúdo inutilizável: só acontece com token
        # emitido por uma versão incompatível da aplicação.
        raise UnauthenticatedError("Token de acesso inválido.") from exc

    return TokenClaims(
        user_id=user_id,
        jti=str(payload["jti"]),
        role=role,
        expires_at=datetime.fromtimestamp(int(payload["exp"]), tz=UTC),
    )
