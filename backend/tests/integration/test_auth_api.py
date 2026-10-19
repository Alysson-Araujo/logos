"""Testes de integração do fluxo de autenticação."""

from __future__ import annotations

from collections.abc import Iterator
from typing import ClassVar
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from app.core.database import create_session
from app.core.tokens import hash_password
from app.domain.enums import UserRole
from app.repositories.revoked_token_repository import RevokedTokenRepository
from app.repositories.user_repository import UserRepository

AUTH_URL = "/api/v1/auth"

SENHA = "ana.logos2026"

#: Domínio próprio deste arquivo, diferente do domínio das contas da suíte
#: (`teste.local`). Estas contas são apagadas entre os testes, e apagar as da
#: suíte invalidaria o token que o `client` compartilhado usa.
DOMINIO_DE_TESTE = "auth-teste.local"

EMAIL = f"ana@{DOMINIO_DE_TESTE}"
REPORTER_EMAIL = f"marina@{DOMINIO_DE_TESTE}"
INATIVO_EMAIL = f"inativo@{DOMINIO_DE_TESTE}"
SENHA_REPORTER = "marina.logos2026"
SENHA_INATIVO = "inativo.logos2026"
EMAILS_DESTE_ARQUIVO = (EMAIL, REPORTER_EMAIL, INATIVO_EMAIL)


def _limpar_contas_deste_arquivo() -> None:
    """Apaga apenas as contas criadas aqui.

    Um `clear()` geral seria mais curto e estaria **errado**: o `client` da
    suíte está autenticado com um token de sessão, e apagar todos os usuários o
    invalidaria — os testes seguintes falhariam com 401 por um motivo que não
    tem relação com o que eles verificam.
    """
    with create_session() as session:
        repositorio = UserRepository(session)
        for email in EMAILS_DESTE_ARQUIVO:
            usuario = repositorio.get_by_email(email)
            if usuario is not None:
                session.delete(usuario)
        session.commit()
        RevokedTokenRepository(session).clear()


@pytest.fixture()
def usuarios() -> Iterator[dict[str, str]]:
    """Cria as contas deste arquivo e limpa depois."""

    def criar(email: str, senha: str, papel: UserRole, nome: str, ativo: bool = True) -> None:
        with create_session() as session:
            UserRepository(session).create(
                email=email,
                password_hash=hash_password(senha),
                name=nome,
                role=papel,
                is_active=ativo,
            )

    _limpar_contas_deste_arquivo()
    criar(EMAIL, SENHA, UserRole.ANALYST, "Ana Paula Ribeiro")
    criar(REPORTER_EMAIL, SENHA_REPORTER, UserRole.REPORTER, "Marina Souza")
    criar(INATIVO_EMAIL, SENHA_INATIVO, UserRole.ANALYST, "Conta Inativa", False)
    yield {"analista": EMAIL, "senha": SENHA}
    _limpar_contas_deste_arquivo()


def entrar(client: TestClient, email: str, senha: str) -> dict[str, object]:
    """Faz login e devolve a resposta já validada."""
    resposta = client.post(f"{AUTH_URL}/login", json={"email": email, "password": senha})
    assert resposta.status_code == 200, resposta.text
    return resposta.json()


class TestLogin:
    """Autenticação e o que a resposta revela."""

    def test_credencial_valida_devolve_token_e_papel(
        self, client: TestClient, usuarios: dict[str, str]
    ) -> None:
        corpo = entrar(client, usuarios["analista"], usuarios["senha"])

        assert corpo["tokenType"] == "Bearer"
        assert corpo["expiresIn"] == 8 * 3600
        assert corpo["accessToken"]
        assert corpo["user"]["role"] == "ANALYST"
        assert corpo["user"]["name"] == "Ana Paula Ribeiro"

    def test_primeiro_login_nao_tem_acesso_anterior(
        self, client: TestClient, usuarios: dict[str, str]
    ) -> None:
        assert (
            entrar(client, usuarios["analista"], usuarios["senha"])["user"]["lastLoginAt"] is None
        )

    def test_segundo_login_devolve_o_acesso_anterior(
        self, client: TestClient, usuarios: dict[str, str]
    ) -> None:
        # Não pode devolver "agora": a interface mostraria "último acesso: agora",
        # que não informa nada a quem entrou.
        primeiro = entrar(client, usuarios["analista"], usuarios["senha"])
        anterior = client.get(f"{AUTH_URL}/me", headers=_auth(primeiro)).json()["lastLoginAt"]
        segundo = entrar(client, usuarios["analista"], usuarios["senha"])

        assert segundo["user"]["lastLoginAt"] == anterior
        assert segundo["user"]["lastLoginAt"] is not None

    def test_email_e_normalizado_no_login(
        self, client: TestClient, usuarios: dict[str, str]
    ) -> None:
        # Quem digita não sabe que o e-mail é gravado em minúsculas.
        resposta = client.post(
            f"{AUTH_URL}/login",
            json={"email": f"  {EMAIL.upper()}  ", "password": SENHA},
        )
        assert resposta.status_code == 200, resposta.text

    @pytest.mark.parametrize(
        ("email", "senha", "motivo"),
        [
            (EMAIL, "senha-errada-mesmo", "senha incorreta"),
            ("ninguem@demo.example.com", SENHA, "e-mail inexistente"),
            ("inativo@demo.example.com", "inativo.logos2026", "conta desativada"),
        ],
    )
    def test_falha_de_login_e_indistinguivel(
        self, client: TestClient, usuarios: dict[str, str], email: str, senha: str, motivo: str
    ) -> None:
        # Os três casos precisam produzir a MESMA resposta: diferenciá-los
        # revelaria quais e-mails existem, e uma resposta própria para conta
        # desativada confirmaria que a senha estava certa.
        resposta = client.post(f"{AUTH_URL}/login", json={"email": email, "password": senha})

        assert resposta.status_code == 401, motivo
        assert resposta.json()["error"]["code"] == "INVALID_CREDENTIALS", motivo
        assert resposta.json()["error"]["message"] == "E-mail ou senha inválidos.", motivo


def _auth(corpo: dict[str, object]) -> dict[str, str]:
    """Monta o header Authorization a partir da resposta do login."""
    return {"Authorization": f"Bearer {corpo['accessToken']}"}


class TestIdentidade:
    """`GET /auth/me` como fonte do papel que a interface usa."""

    def test_me_devolve_o_usuario_do_token(
        self, client: TestClient, usuarios: dict[str, str]
    ) -> None:
        sessao = entrar(client, usuarios["analista"], usuarios["senha"])
        resposta = client.get(f"{AUTH_URL}/me", headers=_auth(sessao))

        assert resposta.status_code == 200
        assert resposta.json()["email"] == EMAIL
        assert resposta.json()["role"] == "ANALYST"

    def test_me_sem_token_e_recusado(
        self, anonymous_client: TestClient, usuarios: dict[str, str]
    ) -> None:
        resposta = anonymous_client.get(f"{AUTH_URL}/me")

        assert resposta.status_code == 401
        assert resposta.json()["error"]["code"] == "UNAUTHENTICATED"

    @pytest.mark.parametrize(
        "header",
        ["Bearer nao-e-um-token", "Basic abc", "token-sem-esquema", "Bearer "],
    )
    def test_header_malformado_e_recusado(
        self, anonymous_client: TestClient, usuarios: dict[str, str], header: str
    ) -> None:
        resposta = anonymous_client.get(f"{AUTH_URL}/me", headers={"Authorization": header})

        assert resposta.status_code == 401
        assert resposta.json()["error"]["code"] == "UNAUTHENTICATED"


class TestLogout:
    """O logout precisa revogar de verdade, não só o cliente esquecer."""

    def test_token_revogado_deixa_de_valer(
        self, client: TestClient, usuarios: dict[str, str]
    ) -> None:
        sessao = entrar(client, usuarios["analista"], usuarios["senha"])
        assert client.post(f"{AUTH_URL}/logout", headers=_auth(sessao)).status_code == 204

        depois = client.get(f"{AUTH_URL}/me", headers=_auth(sessao))
        assert depois.status_code == 401
        assert depois.json()["error"]["code"] == "UNAUTHENTICATED"

    def test_logout_registra_o_jti_para_revogacao(
        self, client: TestClient, usuarios: dict[str, str]
    ) -> None:
        sessao = entrar(client, usuarios["analista"], usuarios["senha"])
        client.post(f"{AUTH_URL}/logout", headers=_auth(sessao))

        with create_session() as session:
            assert RevokedTokenRepository(session).count() == 1

    def test_novo_login_funciona_apos_o_logout(
        self, client: TestClient, usuarios: dict[str, str]
    ) -> None:
        primeira = entrar(client, usuarios["analista"], usuarios["senha"])
        client.post(f"{AUTH_URL}/logout", headers=_auth(primeira))

        nova = entrar(client, usuarios["analista"], usuarios["senha"])
        assert client.get(f"{AUTH_URL}/me", headers=_auth(nova)).status_code == 200


class TestTrocaDeSenha:
    """Troca de senha e a política mínima."""

    def test_senha_atual_incorreta_e_recusada(
        self, client: TestClient, usuarios: dict[str, str]
    ) -> None:
        sessao = entrar(client, usuarios["analista"], usuarios["senha"])
        resposta = client.post(
            f"{AUTH_URL}/change-password",
            json={"currentPassword": "nao-e-a-atual", "newPassword": "uma-senha-bem-longa"},
            headers=_auth(sessao),
        )

        assert resposta.status_code == 401
        assert resposta.json()["error"]["code"] == "INVALID_CREDENTIALS"

    def test_senha_curta_e_recusada(self, client: TestClient, usuarios: dict[str, str]) -> None:
        sessao = entrar(client, usuarios["analista"], usuarios["senha"])
        resposta = client.post(
            f"{AUTH_URL}/change-password",
            json={"currentPassword": SENHA, "newPassword": "curta"},
            headers=_auth(sessao),
        )

        assert resposta.status_code == 422
        assert resposta.json()["error"]["code"] == "WEAK_PASSWORD"

    def test_troca_valida_invalida_a_senha_antiga(
        self, client: TestClient, usuarios: dict[str, str]
    ) -> None:
        sessao = entrar(client, usuarios["analista"], usuarios["senha"])
        nova = "senha-nova-bem-longa-2026"

        troca = client.post(
            f"{AUTH_URL}/change-password",
            json={"currentPassword": SENHA, "newPassword": nova},
            headers=_auth(sessao),
        )
        assert troca.status_code == 204

        assert (
            client.post(f"{AUTH_URL}/login", json={"email": EMAIL, "password": nova}).status_code
            == 200
        )
        assert (
            client.post(f"{AUTH_URL}/login", json={"email": EMAIL, "password": SENHA}).status_code
            == 401
        )


class TestRotasDeIncidentesProtegidas:
    """Nenhuma rota de incidente responde sem credencial.

    Antes desta etapa, qualquer pessoa na internet podia listar, criar, fechar e
    remover incidentes. Este é o teste que trava isso.
    """

    ID_INEXISTENTE: ClassVar[str] = str(uuid4())

    ROTAS: ClassVar[list[tuple[str, str]]] = [
        ("GET", "/api/v1/incidents"),
        ("POST", "/api/v1/incidents"),
        ("GET", f"/api/v1/incidents/{ID_INEXISTENTE}"),
        ("GET", f"/api/v1/incidents/{ID_INEXISTENTE}/events"),
        ("POST", f"/api/v1/incidents/{ID_INEXISTENTE}/status"),
        ("DELETE", f"/api/v1/incidents/{ID_INEXISTENTE}"),
    ]

    @pytest.mark.parametrize(("metodo", "rota"), ROTAS)
    def test_sem_token_responde_401(
        self, anonymous_client: TestClient, metodo: str, rota: str
    ) -> None:
        resposta = anonymous_client.request(metodo, rota, json={})

        # 401 antes de qualquer outra coisa: a ordem importa, porque responder
        # 404 aqui revelaria que a rota existe e que o recurso não.
        assert resposta.status_code == 401, resposta.text
        assert resposta.json()["error"]["code"] == "UNAUTHENTICATED"

    @pytest.mark.parametrize(("metodo", "rota"), ROTAS)
    def test_token_invalido_responde_401(
        self, anonymous_client: TestClient, metodo: str, rota: str
    ) -> None:
        resposta = anonymous_client.request(
            metodo, rota, json={}, headers={"Authorization": "Bearer token-adulterado"}
        )

        assert resposta.status_code == 401, resposta.text
        assert resposta.json()["error"]["code"] == "UNAUTHENTICATED"

    def test_com_token_a_rota_e_alcancavel(self, client: TestClient) -> None:
        # Com credencial válida a rota deixa de responder 401 — pode ser 404
        # (não existe), 422 (corpo inválido) ou 200, mas nunca 401.
        resposta = client.get(f"/api/v1/incidents/{self.ID_INEXISTENTE}")

        assert resposta.status_code != 401
        assert resposta.status_code == 404


class TestRotasPublicas:
    """O que precisa continuar aberto para a aplicação conseguir subir.

    Usa `anonymous_client` de propósito: passar pelo `client` autenticado não
    provaria nada sobre a rota ser pública.
    """

    @pytest.mark.parametrize("rota", ["/api/v1/health/live", "/api/v1/health/ready"])
    def test_health_nao_exige_token(self, anonymous_client: TestClient, rota: str) -> None:
        assert anonymous_client.get(rota).status_code == 200

    def test_meta_enums_nao_exige_token(self, anonymous_client: TestClient) -> None:
        # A tela de login precisa do vocabulário antes de existir sessão.
        resposta = anonymous_client.get("/api/v1/meta/enums")
        assert resposta.status_code == 200
        assert resposta.json()["statuses"]
