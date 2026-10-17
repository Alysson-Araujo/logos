"""Testes das regras de conta: e-mail e política de senha."""

from __future__ import annotations

import pytest

from app.core.errors import WeakPasswordError
from app.domain.accounts import (
    MAX_PASSWORD_LENGTH,
    MIN_PASSWORD_LENGTH,
    normalize_email,
    validate_password_strength,
)


class TestNormalizacaoDeEmail:
    """O e-mail precisa ser comparável: a tela mostra os dois como iguais."""

    @pytest.mark.parametrize(
        ("entrada", "esperado"),
        [
            ("ana@autou.com.br", "ana@autou.com.br"),
            ("Ana@AutoU.com.br", "ana@autou.com.br"),
            ("  ana@autou.com.br  ", "ana@autou.com.br"),
            ("ANA@AUTOU.COM.BR", "ana@autou.com.br"),
        ],
    )
    def test_normaliza(self, entrada: str, esperado: str) -> None:
        assert normalize_email(entrada) == esperado

    def test_grafias_diferentes_viram_o_mesmo_email(self) -> None:
        # É isto que impede `Ana@x.com` e `ana@x.com` de serem duas contas.
        assert normalize_email("Ana@X.com") == normalize_email(" ana@x.COM ")


class TestPoliticaDeSenha:
    """Mínimo de 12 caracteres, sem regra de composição."""

    @pytest.mark.parametrize(
        "senha",
        [
            "ana.logos2026",  # 13
            "uma frase longa e fácil de lembrar",
            "a" * MIN_PASSWORD_LENGTH,
            "a" * MAX_PASSWORD_LENGTH,
        ],
    )
    def test_senha_aceita(self, senha: str) -> None:
        validate_password_strength(senha)

    @pytest.mark.parametrize("senha", ["", "curta", "logos2026", "a" * (MIN_PASSWORD_LENGTH - 1)])
    def test_senha_curta_e_recusada(self, senha: str) -> None:
        with pytest.raises(WeakPasswordError) as erro:
            validate_password_strength(senha)
        assert erro.value.code == "WEAK_PASSWORD"
        assert erro.value.details is not None
        assert erro.value.details["minLength"] == MIN_PASSWORD_LENGTH

    def test_senha_longa_demais_e_recusada(self) -> None:
        with pytest.raises(WeakPasswordError) as erro:
            validate_password_strength("a" * (MAX_PASSWORD_LENGTH + 1))
        assert erro.value.details is not None
        assert erro.value.details["maxLength"] == MAX_PASSWORD_LENGTH

    def test_senha_de_demonstracao_respeita_a_politica(self) -> None:
        # A credencial impressa no README precisa passar na validação da própria
        # aplicação: uma senha de demo que a API recusaria aparece no vídeo.
        validate_password_strength("ana.logos2026")
