"""Regras puras de conta: normalização de e-mail e política de senha."""

from __future__ import annotations

from typing import Final

from app.core.errors import WeakPasswordError

#: Mínimo de caracteres da senha. Doze por decisão de produto: a senha é a
#: única barreira entre a internet e a central de incidentes.
MIN_PASSWORD_LENGTH: Final[int] = 12

#: Teto para não permitir que um corpo gigante vire custo de derivação.
MAX_PASSWORD_LENGTH: Final[int] = 128


def normalize_email(email: str) -> str:
    """Padroniza o e-mail para gravação e comparação.

    Minúsculas e sem espaços nas pontas. Sem isso, `Ana@empresa.com` e
    `ana@empresa.com` seriam contas distintas: a segunda tentativa de cadastro
    falharia por unicidade e ninguém entenderia o motivo, porque na tela os
    dois e-mails parecem idênticos.
    """
    return email.strip().lower()


def validate_password_strength(password: str) -> None:
    """Recusa senha fora da política, com detalhes do que faltou.

    Não há exigência de símbolo, maiúscula ou número. Regra de composição
    empurra o usuário para `Senha@123` — previsível e pior que uma frase longa.
    O comprimento é o que realmente encarece o ataque.
    """
    if len(password) < MIN_PASSWORD_LENGTH:
        raise WeakPasswordError(
            f"A senha deve ter ao menos {MIN_PASSWORD_LENGTH} caracteres.",
            details={"minLength": MIN_PASSWORD_LENGTH, "received": len(password)},
        )
    if len(password) > MAX_PASSWORD_LENGTH:
        raise WeakPasswordError(
            f"A senha deve ter no máximo {MAX_PASSWORD_LENGTH} caracteres.",
            details={"maxLength": MAX_PASSWORD_LENGTH, "received": len(password)},
        )
