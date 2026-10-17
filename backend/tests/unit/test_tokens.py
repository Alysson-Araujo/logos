"""Testes do hash de senha e do token de acesso."""

from __future__ import annotations

from uuid import uuid4

import jwt
import pytest

from app.core.errors import TokenExpiredError, UnauthenticatedError
from app.core.tokens import (
    ALGORITHM,
    create_access_token,
    decode_access_token,
    hash_password,
    verify_password,
)
from app.domain.enums import UserRole

SENHA = "ana.logos2026"


class TestHashDeSenha:
    """Argon2id: derivação, verificação e resistência a hash corrompido."""

    def test_hash_usa_argon2id(self) -> None:
        assert hash_password(SENHA).startswith("$argon2id$")

    def test_mesma_senha_gera_hashes_diferentes(self) -> None:
        # Sal aleatório por senha: sem ele, duas contas com a mesma senha
        # teriam o mesmo hash e um vazamento revelaria ambas de uma vez.
        assert hash_password(SENHA) != hash_password(SENHA)

    def test_senha_correta_e_aceita(self) -> None:
        assert verify_password(SENHA, hash_password(SENHA)) is True

    @pytest.mark.parametrize(
        "tentativa",
        ["ana.logos2027", "ANA.LOGOS2026", "ana.logos202", "", " ana.logos2026"],
    )
    def test_senha_errada_e_recusada(self, tentativa: str) -> None:
        assert verify_password(tentativa, hash_password(SENHA)) is False

    def test_hash_corrompido_recusa_sem_estourar(self) -> None:
        # Um hash inválido no banco não pode virar 500: a resposta é a mesma
        # de senha errada.
        assert verify_password(SENHA, "isto-nao-e-um-hash") is False


class TestEmissaoDeToken:
    """Formato e conteúdo do token emitido."""

    def test_claims_obrigatorias_estao_presentes(self) -> None:
        emitido = create_access_token(user_id=uuid4(), role=UserRole.ANALYST)
        conteudo = jwt.decode(emitido.token, options={"verify_signature": False})
        assert set(conteudo) >= {"sub", "jti", "role", "iat", "exp"}

    def test_jti_e_unico_por_token(self) -> None:
        usuario = uuid4()
        primeiro = create_access_token(user_id=usuario, role=UserRole.ANALYST)
        segundo = create_access_token(user_id=usuario, role=UserRole.ANALYST)
        assert primeiro.jti != segundo.jti

    def test_ttl_configuravel(self) -> None:
        emitido = create_access_token(user_id=uuid4(), role=UserRole.ANALYST, ttl_seconds=60)
        claims = decode_access_token(emitido.token)
        restante = (claims.expires_at - emitido.expires_at).total_seconds()
        assert abs(restante) < 1


class TestLeituraDeToken:
    """Validação: o que passa, o que é recusado e com qual código."""

    def test_token_valido_devolve_claims(self) -> None:
        usuario = uuid4()
        emitido = create_access_token(user_id=usuario, role=UserRole.REPORTER)
        claims = decode_access_token(emitido.token)
        assert claims.user_id == usuario
        assert claims.jti == emitido.jti
        assert claims.role is UserRole.REPORTER

    @pytest.mark.parametrize("papel", list(UserRole))
    def test_todos_os_papeis_sobrevivem_ao_ciclo(self, papel: UserRole) -> None:
        emitido = create_access_token(user_id=uuid4(), role=papel)
        assert decode_access_token(emitido.token).role is papel

    def test_token_adulterado_e_recusado(self) -> None:
        emitido = create_access_token(user_id=uuid4(), role=UserRole.ANALYST)
        adulterado = emitido.token[:-4] + "AAAA"
        with pytest.raises(UnauthenticatedError) as erro:
            decode_access_token(adulterado)
        assert erro.value.code == "UNAUTHENTICATED"

    def test_token_expirado_tem_codigo_proprio(self) -> None:
        # Distinto de UNAUTHENTICATED de propósito: é o único caso em que o
        # cliente pode renovar a sessão em vez de voltar ao login.
        expirado = create_access_token(user_id=uuid4(), role=UserRole.ANALYST, ttl_seconds=-1)
        with pytest.raises(TokenExpiredError) as erro:
            decode_access_token(expirado.token)
        assert erro.value.code == "TOKEN_EXPIRED"

    @pytest.mark.parametrize("lixo", ["", "abc", "a.b.c", "....", "nao.e.um.jwt"])
    def test_token_ilegivel_e_recusado(self, lixo: str) -> None:
        with pytest.raises(UnauthenticatedError):
            decode_access_token(lixo)

    def test_token_assinado_com_outra_chave_e_recusado(self) -> None:
        # O atacante conhece o formato e todos os claims — falta a chave.
        # A chave tem 32+ bytes de propósito: uma chave curta faria o PyJWT
        # emitir InsecureKeyLengthWarning, e aviso emitido no meio da suíte
        # transforma um teste determinístico em teste instável.
        forjado = jwt.encode(
            {
                "sub": str(uuid4()),
                "jti": uuid4().hex,
                "role": UserRole.ADMIN.value,
                "exp": 9_999_999_999,
            },
            "chave-do-atacante-com-tamanho-suficiente-p32",
            algorithm=ALGORITHM,
        )
        with pytest.raises(UnauthenticatedError):
            decode_access_token(forjado)

    def test_algoritmo_none_e_recusado(self) -> None:
        # Ataque clássico: trocar o `alg` do cabeçalho por `none` e remover a
        # assinatura. Só é possível quando o servidor confia no campo `alg`.
        cabecalho = jwt.utils.base64url_encode(b'{"alg":"none","typ":"JWT"}').decode()
        corpo = jwt.utils.base64url_encode(b'{"sub":"x","jti":"y","exp":9999999999}').decode()
        with pytest.raises(UnauthenticatedError):
            decode_access_token(f"{cabecalho}.{corpo}.")

    def test_token_sem_claim_obrigatoria_e_recusado(self) -> None:
        from app.core.config import get_settings

        sem_jti = jwt.encode(
            {"sub": str(uuid4()), "exp": 9_999_999_999},
            get_settings().auth_secret_key,
            algorithm=ALGORITHM,
        )
        with pytest.raises(UnauthenticatedError):
            decode_access_token(sem_jti)

    def test_papel_desconhecido_e_recusado(self) -> None:
        from app.core.config import get_settings

        papel_invalido = jwt.encode(
            {"sub": str(uuid4()), "jti": uuid4().hex, "role": "SUPERUSER", "exp": 9_999_999_999},
            get_settings().auth_secret_key,
            algorithm=ALGORITHM,
        )
        with pytest.raises(UnauthenticatedError):
            decode_access_token(papel_invalido)

    def test_sub_que_nao_e_uuid_e_recusado(self) -> None:
        from app.core.config import get_settings

        sub_invalido = jwt.encode(
            {"sub": "nao-e-uuid", "jti": uuid4().hex, "role": "ANALYST", "exp": 9_999_999_999},
            get_settings().auth_secret_key,
            algorithm=ALGORITHM,
        )
        with pytest.raises(UnauthenticatedError):
            decode_access_token(sub_invalido)
