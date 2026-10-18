"""Testes do escape de curingas na busca por placa."""

from __future__ import annotations

import pytest

from app.repositories.vehicle_repository import escape_like


@pytest.mark.parametrize(
    ("entrada", "esperado"),
    [
        ("ABC", "ABC"),
        ("ABC1D23", "ABC1D23"),
        ("%", "\\%"),
        ("_", "\\_"),
        ("A%C", "A\\%C"),
        ("A_C", "A\\_C"),
        ("\\", "\\\\"),
        ("", ""),
    ],
)
def test_escapa_os_curingas_do_like(entrada: str, esperado: str) -> None:
    assert escape_like(entrada) == esperado


def test_barra_invertida_e_escapada_primeiro() -> None:
    """A ordem importa, e o resultado tem que ter quatro caracteres.

    Entrada `\\%` (barra + curinga). Escapando a barra primeiro: `\\\\%`. Depois
    o `%`: `\\\\\\%` — três barras e um `%` literal.

    Na ordem inversa, o `%` viraria `\\%` e a barra recém-inserida seria
    escapada em seguida, produzindo `\\\\%`: uma barra literal seguida de
    **curinga**. A busca passaria a casar qualquer coisa, que é exatamente o que
    o escape existe para impedir.
    """
    resultado = escape_like("\\%")
    assert resultado == "\\\\\\%"
    assert len(resultado) == 4
