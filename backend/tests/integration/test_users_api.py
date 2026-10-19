"""Testes da administração de contas por convite e do primeiro acesso.

Os testes que trocam senha, desativam conta ou fazem logout criam a **própria
conta**: as contas da suíte são compartilhadas pela sessão inteira, e invalidar
o token delas derrubaria todos os testes seguintes (o aviso está no
`conftest.tokens_da_suite`).

Os e-mails levam um sufixo único porque `clean_database` limpa incidentes e
tokens, mas **não** usuários — de propósito, já que a suíte autentica com eles.
"""

from __future__ import annotations

import json
from collections.abc import Iterator
from datetime import timedelta
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from app.api.deps import provide_mailer
from app.core.database import create_session
from app.core.mailer import MailDeliveryError, OutboundEmail
from app.domain.enums import UserRole
from app.main import app
from app.models.base import utcnow
from app.repositories.user_repository import UserRepository
from tests.conftest import SENHA_DA_SUITE

USERS_URL = "/api/v1/users"
LOGIN_URL = "/api/v1/auth/login"
ME_URL = "/api/v1/auth/me"
CHANGE_PASSWORD_URL = "/api/v1/auth/change-password"  # noqa: S105 — é uma rota, não um segredo
INCIDENTS_URL = "/api/v1/incidents"

#: Senha definitiva usada pelos testes. Cumpre a política mínima de 12.
SENHA_DEFINITIVA = "senha-definitiva-do-teste-2026"


class MailerEspiao:
    """Guarda as mensagens em vez de enviá-las."""

    def __init__(self) -> None:
        """Começa sem nenhuma mensagem."""
        self.enviados: list[OutboundEmail] = []

    def send(self, message: OutboundEmail) -> None:
        """Registra a mensagem."""
        self.enviados.append(message)


class MailerQuebrado:
    """Falha sempre — para provar que a falha de envio **aparece**."""

    def send(self, message: OutboundEmail) -> None:
        """Levanta o erro que o `SmtpMailer` levanta quando não entrega."""
        raise MailDeliveryError("servidor de e-mail fora do ar")


@pytest.fixture()
def mailer_espiao() -> Iterator[MailerEspiao]:
    """Substitui a porta de e-mail por um espião durante o teste."""
    espiao = MailerEspiao()
    app.dependency_overrides[provide_mailer] = lambda: espiao
    yield espiao
    app.dependency_overrides.pop(provide_mailer, None)


def email_unico(prefixo: str) -> str:
    """Gera um e-mail que nenhum outro teste usou."""
    return f"{prefixo}.{uuid4().hex[:8]}@demo.example.com"


def extrair_senha_temporaria(mensagem: OutboundEmail) -> str:
    """Lê a senha temporária do corpo do e-mail de convite.

    O corpo segue o frame "Convite · e-mail": o rótulo `SUA SENHA TEMPORÁRIA`
    vem numa linha e o código na linha seguinte. Ler assim — e não procurando
    por `Senha temporária:` — mantém o teste alinhado ao desenho, que é a
    referência do contrato.
    """
    linhas = mensagem.body.splitlines()
    for indice, linha in enumerate(linhas):
        if linha.strip().upper() == "SUA SENHA TEMPORÁRIA":
            for seguinte in linhas[indice + 1 :]:
                if seguinte.strip():
                    return seguinte.strip()
    raise AssertionError(f"senha temporária não encontrada no corpo:\n{mensagem.body}")


def criar_conta(cliente: TestClient, email: str, papel: str = "REPORTER") -> dict[str, object]:
    """Cria a conta pelo endpoint e devolve o corpo da resposta."""
    resposta = cliente.post(USERS_URL, json={"email": email, "role": papel})
    assert resposta.status_code == 201, resposta.text
    return dict(resposta.json())


def conta_ativa_com_token(
    admin_client: TestClient, anonymous_client: TestClient, mailer_espiao: MailerEspiao
) -> tuple[str, str]:
    """Cria a conta, conclui o primeiro acesso e devolve (email, token).

    Serve aos testes que precisam de uma sessão comum — de alguém que já
    definiu a própria senha.
    """
    email = email_unico("ativa")
    criar_conta(admin_client, email)
    temporaria = extrair_senha_temporaria(mailer_espiao.enviados[-1])

    primeiro = anonymous_client.post(LOGIN_URL, json={"email": email, "password": temporaria})
    assert primeiro.status_code == 200, primeiro.text
    troca = anonymous_client.post(
        CHANGE_PASSWORD_URL,
        json={"currentPassword": temporaria, "newPassword": SENHA_DEFINITIVA},
        headers={"Authorization": f"Bearer {primeiro.json()['accessToken']}"},
    )
    assert troca.status_code == 204, troca.text

    definitivo = anonymous_client.post(
        LOGIN_URL, json={"email": email, "password": SENHA_DEFINITIVA}
    )
    assert definitivo.status_code == 200, definitivo.text
    return email, str(definitivo.json()["accessToken"])


def expirar_convite(email: str) -> None:
    """Empurra o prazo do convite para o passado."""
    with create_session() as session:
        user = UserRepository(session).get_by_email(email)
        assert user is not None
        user.invite_expires_at = utcnow() - timedelta(hours=1)
        session.add(user)
        session.commit()


class TestPermissoes:
    """Todas as rotas de contas exigem ADMIN."""

    ROTAS: tuple[tuple[str, str, dict[str, object] | None], ...] = (
        ("GET", USERS_URL, None),
        ("POST", USERS_URL, {"email": "x@demo.example.com", "role": "REPORTER"}),
        ("POST", f"{USERS_URL}/00000000-0000-0000-0000-000000000000/invite", None),
        ("PATCH", f"{USERS_URL}/00000000-0000-0000-0000-000000000000", {"isActive": False}),
    )

    def _chamar(self, cliente: TestClient, metodo: str, rota: str, corpo: object) -> object:
        return cliente.request(metodo, rota, json=corpo)

    @pytest.mark.parametrize(("metodo", "rota", "corpo"), ROTAS)
    def test_reporter_recebe_403(
        self, reporter_client: TestClient, metodo: str, rota: str, corpo: object
    ) -> None:
        """REPORTER não administra contas."""
        resposta = self._chamar(reporter_client, metodo, rota, corpo)
        assert resposta.status_code == 403, resposta.text
        assert resposta.json()["error"]["code"] == "INSUFFICIENT_ROLE"

    @pytest.mark.parametrize(("metodo", "rota", "corpo"), ROTAS)
    def test_analyst_recebe_403(
        self, client: TestClient, metodo: str, rota: str, corpo: object
    ) -> None:
        """ANALYST conduz incidentes, mas não administra contas."""
        resposta = self._chamar(client, metodo, rota, corpo)
        assert resposta.status_code == 403, resposta.text
        assert resposta.json()["error"]["code"] == "INSUFFICIENT_ROLE"

    @pytest.mark.parametrize(("metodo", "rota", "corpo"), ROTAS)
    def test_admin_nao_recebe_403(
        self, admin_client: TestClient, metodo: str, rota: str, corpo: object
    ) -> None:
        """ADMIN passa da checagem de papel — pode falhar depois por outro motivo.

        O 404 do identificador inexistente é justamente a prova de que a barreira
        de papel foi vencida: sem ela, a resposta seria 403.
        """
        resposta = self._chamar(admin_client, metodo, rota, corpo)
        assert resposta.status_code != 403, resposta.text

    def test_sem_token_recebe_401(self, anonymous_client: TestClient) -> None:
        """Sem credencial, nem chega a discutir papel."""
        resposta = anonymous_client.get(USERS_URL)
        assert resposta.status_code == 401
        assert resposta.json()["error"]["code"] == "UNAUTHENTICATED"


class TestCriacao:
    """Criação de conta e convite."""

    def test_cria_inativa_com_convite_e_sem_senha_na_resposta(
        self, admin_client: TestClient, mailer_espiao: MailerEspiao
    ) -> None:
        """A conta nasce inativa, o convite fica pendente e a senha não vaza."""
        email = email_unico("joana")
        resposta = admin_client.post(USERS_URL, json={"email": email, "role": "REPORTER"})
        assert resposta.status_code == 201, resposta.text

        corpo = resposta.json()
        assert set(corpo) == {"id", "email", "role", "inviteExpiresAt"}

        # A senha temporária NÃO pode aparecer em lugar nenhum da resposta.
        assert "senha" not in json.dumps(corpo, ensure_ascii=False).lower()
        assert "password" not in json.dumps(corpo, ensure_ascii=False).lower()

        listagem = admin_client.get(USERS_URL).json()
        criada = next(item for item in listagem if item["email"] == email)
        assert criada["isActive"] is False, "a conta deve nascer inativa"
        assert criada["invitePending"] is True
        assert criada["lastLoginAt"] is None
        assert criada["role"] == "REPORTER"

    def test_normaliza_o_email(self, admin_client: TestClient) -> None:
        """E-mail entra em maiúsculas e com espaço, e é gravado normalizado."""
        alvo = email_unico("maiusculo")
        resposta = admin_client.post(
            USERS_URL, json={"email": f"  {alvo.upper()}  ", "role": "ANALYST"}
        )
        assert resposta.status_code == 201, resposta.text
        assert resposta.json()["email"] == alvo

    def test_nome_derivado_do_email(self, admin_client: TestClient) -> None:
        """Sem nome no corpo, ele é derivado do e-mail."""
        email = email_unico("joana.prado")
        criar_conta(admin_client, email)
        listagem = admin_client.get(USERS_URL).json()
        criada = next(item for item in listagem if item["email"] == email)
        assert criada["name"].startswith("Joana Prado"), criada["name"]

    def test_email_duplicado_devolve_409(
        self, admin_client: TestClient, mailer_espiao: MailerEspiao
    ) -> None:
        """Não pode existir duas contas com o mesmo e-mail."""
        email = email_unico("duplicado")
        criar_conta(admin_client, email)

        repetido = admin_client.post(USERS_URL, json={"email": email, "role": "ANALYST"})
        assert repetido.status_code == 409, repetido.text
        assert repetido.json()["error"]["code"] == "EMAIL_ALREADY_EXISTS"
        # E não manda convite para uma conta que não foi criada.
        assert len(mailer_espiao.enviados) == 1

    def test_email_duplicado_ignora_a_caixa(self, admin_client: TestClient) -> None:
        """Maiúsculas não criam uma segunda conta."""
        email = email_unico("caixa")
        criar_conta(admin_client, email.lower())
        repetido = admin_client.post(USERS_URL, json={"email": email.upper(), "role": "ANALYST"})
        assert repetido.status_code == 409

    @pytest.mark.parametrize("invalido", ["sem-arroba", "sem@ponto", "a@b", "com espaco@x.com", ""])
    def test_email_invalido_devolve_422(self, admin_client: TestClient, invalido: str) -> None:
        """Formato de e-mail é validado na entrada."""
        resposta = admin_client.post(USERS_URL, json={"email": invalido, "role": "REPORTER"})
        assert resposta.status_code == 422, resposta.text
        assert resposta.json()["error"]["code"] == "VALIDATION_ERROR"

    def test_papel_invalido_devolve_422(self, admin_client: TestClient) -> None:
        """O papel precisa estar no enum."""
        resposta = admin_client.post(
            USERS_URL, json={"email": email_unico("papel"), "role": "SUPERUSER"}
        )
        assert resposta.status_code == 422

    def test_senha_no_corpo_e_ignorada(self, admin_client: TestClient) -> None:
        """`password` no corpo não tem efeito: quem escolhe a senha é o servidor.

        O campo é desconhecido para o schema, então o Pydantic o descarta — e a
        senha enviada não pode virar a credencial da conta.
        """
        email = email_unico("comsenha")
        resposta = admin_client.post(
            USERS_URL,
            json={"email": email, "role": "REPORTER", "password": "senha-escolhida-pelo-admin"},
        )
        assert resposta.status_code == 201, resposta.text
        assert "senha-escolhida-pelo-admin" not in resposta.text


class TestConvite:
    """Envio, reenvio e prazo do convite."""

    def test_envia_um_email_com_o_destinatario_certo(
        self, admin_client: TestClient, mailer_espiao: MailerEspiao
    ) -> None:
        """Um convite, um e-mail, para quem foi convidado."""
        email = email_unico("umemail")
        criar_conta(admin_client, email)

        assert len(mailer_espiao.enviados) == 1
        mensagem = mailer_espiao.enviados[0]
        assert mensagem.to == email
        assert mensagem.subject == "Sua conta no Logos foi criada"
        # O frame mostra o código do papel, não a descrição em português.
        assert "com o papel REPORTER" in mensagem.body

    def test_email_leva_as_duas_versoes(
        self, admin_client: TestClient, mailer_espiao: MailerEspiao
    ) -> None:
        """Texto puro e HTML, dizendo a mesma coisa.

        Um e-mail só de HTML tem entrega pior e depende de o cliente renderizar
        marcação; só de texto perde o botão do desenho. As duas versões saem
        juntas, e a senha aparece em ambas.
        """
        criar_conta(admin_client, email_unico("versoes"))
        mensagem = mailer_espiao.enviados[0]

        assert mensagem.html is not None, "o convite precisa da versão HTML do frame"
        senha = extrair_senha_temporaria(mensagem)
        assert senha in mensagem.body
        assert senha in mensagem.html

    def test_corpo_traz_senha_prazo_e_link(
        self, admin_client: TestClient, mailer_espiao: MailerEspiao
    ) -> None:
        """O e-mail tem o que a pessoa precisa para entrar."""
        criar_conta(admin_client, email_unico("corpo"))
        mensagem = mailer_espiao.enviados[0]

        assert extrair_senha_temporaria(mensagem)
        assert "24 horas" in mensagem.body
        assert "Definir minha senha" in mensagem.body
        assert "https://" in mensagem.body or "http://" in mensagem.body
        assert "ignore" in mensagem.body

    def test_falha_de_email_aparece_na_resposta(self, admin_client: TestClient) -> None:
        """Servidor de e-mail fora do ar **não** pode passar por sucesso.

        Era exatamente aqui que o convite se perdia: a falha virava uma linha de
        log, a rota respondia `201` e a tela dizia "Convite enviado". A conta
        continua criada — desfazê-la faria o administrador tentar de novo e
        bater em `EMAIL_ALREADY_EXISTS` —, mas a resposta precisa dizer que o
        e-mail não saiu.
        """
        app.dependency_overrides[provide_mailer] = MailerQuebrado
        try:
            resposta = admin_client.post(
                USERS_URL, json={"email": email_unico("falha"), "role": "REPORTER"}
            )
            assert resposta.status_code == 409, resposta.text
            assert resposta.json()["error"]["code"] == "INVITE_DELIVERY_FAILED"
            assert "Reenviar" in resposta.json()["error"]["message"]
        finally:
            app.dependency_overrides.pop(provide_mailer, None)

    def test_falha_de_email_nao_desfaz_a_conta(self, admin_client: TestClient) -> None:
        """A conta fica criada: "Reenviar convite" é o caminho de recuperação."""
        email = email_unico("permanece")
        app.dependency_overrides[provide_mailer] = MailerQuebrado
        try:
            assert (
                admin_client.post(USERS_URL, json={"email": email, "role": "REPORTER"}).status_code
                == 409
            )
        finally:
            app.dependency_overrides.pop(provide_mailer, None)

        contas = admin_client.get(USERS_URL).json()
        assert any(conta["email"] == email for conta in contas), (
            "a conta precisa existir para o reenvio funcionar"
        )

    def test_reenvio_que_falha_nao_responde_204(
        self, admin_client: TestClient, mailer_espiao: MailerEspiao
    ) -> None:
        """Reenviar também só responde 204 quando o e-mail realmente sai."""
        criada = criar_conta(admin_client, email_unico("reenviofalha"))
        app.dependency_overrides[provide_mailer] = MailerQuebrado
        try:
            resposta = admin_client.post(f"{USERS_URL}/{criada['id']}/invite")
        finally:
            app.dependency_overrides.pop(provide_mailer, None)

        assert resposta.status_code == 409, resposta.text
        assert resposta.json()["error"]["code"] == "INVITE_DELIVERY_FAILED"

    def test_reenvio_gera_senha_nova_e_invalida_a_anterior(
        self, admin_client: TestClient, anonymous_client: TestClient, mailer_espiao: MailerEspiao
    ) -> None:
        """Reenviar substitui a credencial; não somam duas válidas."""
        email = email_unico("reenvio")
        criada = criar_conta(admin_client, email)
        primeira = extrair_senha_temporaria(mailer_espiao.enviados[-1])

        reenvio = admin_client.post(f"{USERS_URL}/{criada['id']}/invite")
        assert reenvio.status_code == 204, reenvio.text
        assert len(mailer_espiao.enviados) == 2
        segunda = extrair_senha_temporaria(mailer_espiao.enviados[-1])
        assert segunda != primeira

        antiga = anonymous_client.post(LOGIN_URL, json={"email": email, "password": primeira})
        assert antiga.status_code == 401, "a senha temporária anterior deveria morrer"
        assert antiga.json()["error"]["code"] == "INVALID_CREDENTIALS"

        nova = anonymous_client.post(LOGIN_URL, json={"email": email, "password": segunda})
        assert nova.status_code == 200, nova.text
        assert nova.json()["mustChangePassword"] is True

    def test_convite_expirado_nao_entra(
        self, admin_client: TestClient, anonymous_client: TestClient, mailer_espiao: MailerEspiao
    ) -> None:
        """Prazo vencido responde o 401 genérico, sem revelar o motivo."""
        email = email_unico("expirado")
        criar_conta(admin_client, email)
        temporaria = extrair_senha_temporaria(mailer_espiao.enviados[-1])
        expirar_convite(email)

        resposta = anonymous_client.post(LOGIN_URL, json={"email": email, "password": temporaria})
        assert resposta.status_code == 401
        assert resposta.json()["error"]["code"] == "INVALID_CREDENTIALS"
        # A mensagem não pode denunciar que o convite venceu.
        assert "convite" not in resposta.json()["error"]["message"].lower()
        assert "expirado" not in resposta.json()["error"]["message"].lower()

    def test_reenvio_depois_de_expirar_funciona(
        self, admin_client: TestClient, anonymous_client: TestClient, mailer_espiao: MailerEspiao
    ) -> None:
        """O caminho de recuperação do convite vencido é reenviar."""
        email = email_unico("reexpira")
        criada = criar_conta(admin_client, email)
        expirar_convite(email)

        assert admin_client.post(f"{USERS_URL}/{criada['id']}/invite").status_code == 204
        nova = extrair_senha_temporaria(mailer_espiao.enviados[-1])

        resposta = anonymous_client.post(LOGIN_URL, json={"email": email, "password": nova})
        assert resposta.status_code == 200, resposta.text

    def test_convite_de_usuario_inexistente_devolve_404(self, admin_client: TestClient) -> None:
        """Reenviar para quem não existe é 404, não 500."""
        resposta = admin_client.post(f"{USERS_URL}/{uuid4()}/invite")
        assert resposta.status_code == 404
        assert resposta.json()["error"]["code"] == "USER_NOT_FOUND"


class TestPrimeiroAcesso:
    """O fluxo completo: convite, bloqueio, troca e liberação."""

    def test_fluxo_completo(
        self, admin_client: TestClient, anonymous_client: TestClient, mailer_espiao: MailerEspiao
    ) -> None:
        """Do convite até o acesso pleno, conferindo cada estado intermediário."""
        email = email_unico("primeiro")
        criar_conta(admin_client, email)
        temporaria = extrair_senha_temporaria(mailer_espiao.enviados[-1])

        # 1. Entra com a temporária e é avisado de que precisa trocar.
        login = anonymous_client.post(LOGIN_URL, json={"email": email, "password": temporaria})
        assert login.status_code == 200, login.text
        corpo = login.json()
        assert corpo["mustChangePassword"] is True
        assert corpo["user"]["role"] == "REPORTER"
        # O primeiro acesso com a temporária não conta como acesso à central.
        assert corpo["user"]["lastLoginAt"] is None

        token = {"Authorization": f"Bearer {corpo['accessToken']}"}

        # 2. Bloqueado nas rotas comuns.
        bloqueado = anonymous_client.get(INCIDENTS_URL, headers=token)
        assert bloqueado.status_code == 403, bloqueado.text
        assert bloqueado.json()["error"]["code"] == "PASSWORD_CHANGE_REQUIRED"

        # 3. As rotas de primeiro acesso continuam respondendo.
        assert anonymous_client.get(ME_URL, headers=token).status_code == 200

        # 4. Define a senha.
        troca = anonymous_client.post(
            CHANGE_PASSWORD_URL,
            json={"currentPassword": temporaria, "newPassword": SENHA_DEFINITIVA},
            headers=token,
        )
        assert troca.status_code == 204, troca.text

        # 5. A temporária morreu.
        antiga = anonymous_client.post(LOGIN_URL, json={"email": email, "password": temporaria})
        assert antiga.status_code == 401

        # 6. A definitiva entra, sem exigir troca, e a conta está ativa.
        nova = anonymous_client.post(LOGIN_URL, json={"email": email, "password": SENHA_DEFINITIVA})
        assert nova.status_code == 200, nova.text
        assert nova.json()["mustChangePassword"] is False
        token_novo = {"Authorization": f"Bearer {nova.json()['accessToken']}"}
        assert anonymous_client.get(INCIDENTS_URL, headers=token_novo).status_code == 200

        listagem = admin_client.get(USERS_URL).json()
        conta = next(item for item in listagem if item["email"] == email)
        assert conta["isActive"] is True
        assert conta["invitePending"] is False

    def test_token_de_primeiro_acesso_nao_serve_para_escrever(
        self, admin_client: TestClient, anonymous_client: TestClient, mailer_espiao: MailerEspiao
    ) -> None:
        """O bloqueio vale para toda rota comum, não só para a listagem."""
        email = email_unico("bloqueio")
        criar_conta(admin_client, email)
        temporaria = extrair_senha_temporaria(mailer_espiao.enviados[-1])
        login = anonymous_client.post(LOGIN_URL, json={"email": email, "password": temporaria})
        token = {"Authorization": f"Bearer {login.json()['accessToken']}"}

        criar = anonymous_client.post(
            INCIDENTS_URL,
            json={
                "title": "Tentativa",
                "description": "Nao deveria passar",
                "category": "PROBLEMA_MECANICO",
                "criticality": "BAIXA",
                "reportedBy": "Radio",
            },
            headers=token,
        )
        assert criar.status_code == 403, criar.text
        assert criar.json()["error"]["code"] == "PASSWORD_CHANGE_REQUIRED"

        # E também para a administração de contas.
        contas = anonymous_client.get(USERS_URL, headers=token)
        assert contas.status_code == 403
        assert contas.json()["error"]["code"] == "PASSWORD_CHANGE_REQUIRED"

    def test_senha_curta_no_primeiro_acesso_e_recusada(
        self, admin_client: TestClient, anonymous_client: TestClient, mailer_espiao: MailerEspiao
    ) -> None:
        """A política mínima vale também para quem veio do convite."""
        email = email_unico("curta")
        criar_conta(admin_client, email)
        temporaria = extrair_senha_temporaria(mailer_espiao.enviados[-1])
        login = anonymous_client.post(LOGIN_URL, json={"email": email, "password": temporaria})
        token = {"Authorization": f"Bearer {login.json()['accessToken']}"}

        resposta = anonymous_client.post(
            CHANGE_PASSWORD_URL,
            json={"currentPassword": temporaria, "newPassword": "curta"},
            headers=token,
        )
        assert resposta.status_code == 422
        assert resposta.json()["error"]["code"] == "WEAK_PASSWORD"

    def test_login_de_usuario_comum_nao_exige_troca(self, anonymous_client: TestClient) -> None:
        """Quem já tem senha definitiva entra direto."""
        from tests.conftest import CONTAS_DA_SUITE

        email = CONTAS_DA_SUITE[0][0]
        resposta = anonymous_client.post(
            LOGIN_URL, json={"email": email, "password": SENHA_DA_SUITE}
        )
        assert resposta.status_code == 200
        assert resposta.json()["mustChangePassword"] is False


class TestAtivacao:
    """Ativar e desativar contas."""

    def test_desativar_encerra_a_sessao(
        self, admin_client: TestClient, anonymous_client: TestClient, mailer_espiao: MailerEspiao
    ) -> None:
        """O token que funcionava deixa de valer no pedido seguinte."""
        email, token = conta_ativa_com_token(admin_client, anonymous_client, mailer_espiao)
        cabecalho = {"Authorization": f"Bearer {token}"}
        assert anonymous_client.get(ME_URL, headers=cabecalho).status_code == 200

        listagem = admin_client.get(USERS_URL).json()
        conta = next(item for item in listagem if item["email"] == email)
        resposta = admin_client.patch(f"{USERS_URL}/{conta['id']}", json={"isActive": False})
        assert resposta.status_code == 200, resposta.text
        assert resposta.json()["isActive"] is False

        assert anonymous_client.get(ME_URL, headers=cabecalho).status_code == 401
        # E não consegue entrar de novo.
        reentrada = anonymous_client.post(
            LOGIN_URL, json={"email": email, "password": SENHA_DEFINITIVA}
        )
        assert reentrada.status_code == 401
        assert reentrada.json()["error"]["code"] == "INVALID_CREDENTIALS"

    def test_reativar_permite_entrar_e_nao_ressuscita_o_token_antigo(
        self, admin_client: TestClient, anonymous_client: TestClient, mailer_espiao: MailerEspiao
    ) -> None:
        """Reativar devolve o acesso, mas não o token emitido antes."""
        email, token = conta_ativa_com_token(admin_client, anonymous_client, mailer_espiao)
        listagem = admin_client.get(USERS_URL).json()
        conta = next(item for item in listagem if item["email"] == email)

        admin_client.patch(f"{USERS_URL}/{conta['id']}", json={"isActive": False})
        reativada = admin_client.patch(f"{USERS_URL}/{conta['id']}", json={"isActive": True})
        assert reativada.status_code == 200
        assert reativada.json()["isActive"] is True

        antigo = {"Authorization": f"Bearer {token}"}
        assert anonymous_client.get(ME_URL, headers=antigo).status_code == 401

        novo = anonymous_client.post(LOGIN_URL, json={"email": email, "password": SENHA_DEFINITIVA})
        assert novo.status_code == 200, novo.text

    def test_desativar_invalida_convite_pendente(
        self, admin_client: TestClient, anonymous_client: TestClient, mailer_espiao: MailerEspiao
    ) -> None:
        """Conta afastada não pode manter uma porta de entrada aberta."""
        email = email_unico("desativaconvite")
        criada = criar_conta(admin_client, email)
        temporaria = extrair_senha_temporaria(mailer_espiao.enviados[-1])

        admin_client.patch(f"{USERS_URL}/{criada['id']}", json={"isActive": False})

        resposta = anonymous_client.post(LOGIN_URL, json={"email": email, "password": temporaria})
        assert resposta.status_code == 401, "a senha temporária deveria ter sido invalidada"

    def test_admin_nao_desativa_a_propria_conta(self, admin_client: TestClient) -> None:
        """Sem isso, o último administrador poderia se afastar e travar o sistema."""
        listagem = admin_client.get(USERS_URL).json()
        eu = next(item for item in listagem if item["email"] == "admin-suite@teste.local")

        resposta = admin_client.patch(f"{USERS_URL}/{eu['id']}", json={"isActive": False})
        assert resposta.status_code == 409, resposta.text
        assert resposta.json()["error"]["code"] == "CANNOT_DEACTIVATE_SELF"

    def test_admin_pode_ativar_a_propria_conta(self, admin_client: TestClient) -> None:
        """A proibição é de se afastar, não de mexer no próprio registro."""
        listagem = admin_client.get(USERS_URL).json()
        eu = next(item for item in listagem if item["email"] == "admin-suite@teste.local")

        resposta = admin_client.patch(f"{USERS_URL}/{eu['id']}", json={"isActive": True})
        assert resposta.status_code == 200, resposta.text
        assert resposta.json()["isActive"] is True

    def test_patch_de_usuario_inexistente_devolve_404(self, admin_client: TestClient) -> None:
        """Identificador desconhecido é 404."""
        resposta = admin_client.patch(f"{USERS_URL}/{uuid4()}", json={"isActive": False})
        assert resposta.status_code == 404
        assert resposta.json()["error"]["code"] == "USER_NOT_FOUND"

    def test_patch_sem_campo_devolve_422(self, admin_client: TestClient) -> None:
        """Um PATCH vazio não pode ter efeito nenhum."""
        email = email_unico("vazio")
        criada = criar_conta(admin_client, email)
        resposta = admin_client.patch(f"{USERS_URL}/{criada['id']}", json={})
        assert resposta.status_code == 422


class TestListagem:
    """A listagem que a tela de administração consome."""

    def test_nao_expoe_hash_nem_senha(
        self, admin_client: TestClient, mailer_espiao: MailerEspiao
    ) -> None:
        """A resposta só tem o que a tela precisa."""
        criar_conta(admin_client, email_unico("campos"))
        listagem = admin_client.get(USERS_URL).json()

        assert listagem, "a listagem não pode vir vazia"
        campos = set(listagem[0])
        assert campos == {
            "id",
            "name",
            "email",
            "role",
            "isActive",
            "invitePending",
            "lastLoginAt",
            "createdAt",
        }
        texto = json.dumps(listagem, ensure_ascii=False).lower()
        assert "hash" not in texto
        assert "argon2" not in texto

    def test_ordena_das_mais_recentes_para_as_mais_antigas(self, admin_client: TestClient) -> None:
        """A administração olha primeiro para o que acabou de criar."""
        primeira = criar_conta(admin_client, email_unico("ordem1"))
        segunda = criar_conta(admin_client, email_unico("ordem2"))
        listagem = admin_client.get(USERS_URL).json()

        posicoes = {item["id"]: indice for indice, item in enumerate(listagem)}
        assert posicoes[segunda["id"]] < posicoes[primeira["id"]]

    def test_roles_da_suite_aparecem(self, admin_client: TestClient) -> None:
        """A listagem inclui as contas já existentes, com o papel certo."""
        listagem = admin_client.get(USERS_URL).json()
        papeis = {(item["email"], item["role"]) for item in listagem}
        assert ("admin-suite@teste.local", "ADMIN") in papeis
        assert ("analista-suite@teste.local", "ANALYST") in papeis
        assert ("reporter-suite@teste.local", "REPORTER") in papeis


def test_enum_de_papeis_cobre_a_listagem(admin_client: TestClient) -> None:
    """Todo papel devolvido é um valor válido do enum."""
    listagem = admin_client.get(USERS_URL).json()
    validos = {papel.value for papel in UserRole}
    assert {item["role"] for item in listagem} <= validos
