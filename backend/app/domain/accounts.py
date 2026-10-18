"""Regras puras de conta: normalização de e-mail e política de senha."""

from __future__ import annotations

import secrets
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


# --- Convite e primeiro acesso ---------------------------------------------

#: Quantas horas o convite vale. Vinte e quatro é o que o desenho mostra, e
#: cobre o caso comum: a pessoa recebe o e-mail em um dia e abre no seguinte.
INVITE_TTL_HOURS: Final[int] = 24

#: Comprimento da senha temporária.
TEMP_PASSWORD_LENGTH: Final[int] = 16

#: Alfabeto da senha temporária.
#:
#: Sem os pares que se confundem ao ler em voz alta ou ao copiar de um e-mail:
#: `0`/`O`, `1`/`l`/`I`. A senha vai ser digitada à mão por quem recebeu o
#: convite, e um caractere ambíguo vira uma ligação para o suporte.
TEMP_PASSWORD_ALPHABET: Final[str] = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789"  # noqa: S105


def generate_temp_password() -> str:
    """Gera a senha temporária entregue no convite.

    Usa `secrets`, e não `random`: `random` é previsível a partir de algumas
    saídas observadas, e esta senha é uma credencial — mesmo temporária.
    """
    return "".join(secrets.choice(TEMP_PASSWORD_ALPHABET) for _ in range(TEMP_PASSWORD_LENGTH))
