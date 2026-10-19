"""Fixtures compartilhadas dos testes.

O ambiente é configurado ANTES de importar a aplicação.

Por padrão a suíte roda contra um SQLite em arquivo (não `:memory:`, que não
compartilha conexão entre threads). Definindo `TEST_DATABASE_URL`, ela passa a
rodar contra um PostgreSQL de verdade — que é o banco de produção e o único
onde o comportamento do lock otimista sob concorrência real pode ser observado.
É exatamente isso que o job `backend-postgres` da CI faz.
"""

from __future__ import annotations

import os
import tempfile
from collections.abc import Callable, Iterator
from pathlib import Path
from typing import Any

_TEST_DIR = Path(tempfile.mkdtemp(prefix="logos-tests-"))
_DB_FILE = _TEST_DIR / "logos-test.db"

# PostgreSQL quando TEST_DATABASE_URL estiver definida; SQLite em arquivo caso
# contrário. Sem esta distinção o job de PostgreSQL da CI subiria o serviço e
# rodaria a suíte inteira no SQLite, sem ninguém perceber — um falso positivo
# caro, porque é justamente sob concorrência de PostgreSQL que a garantia do
# lock otimista precisa ser exercida.
_EXTERNAL_DATABASE_URL = os.environ.get("TEST_DATABASE_URL", "").strip()
if _EXTERNAL_DATABASE_URL:
    os.environ["DATABASE_URL"] = _EXTERNAL_DATABASE_URL
else:
    os.environ["DATABASE_URL"] = f"sqlite:///{_DB_FILE.as_posix()}"

os.environ["SEED_ON_STARTUP"] = "false"
os.environ["LOG_LEVEL"] = "ERROR"
os.environ["ENVIRONMENT"] = "test"
os.environ["CORS_ORIGINS"] = "http://localhost:5173"
# A suíte NUNCA fala com um servidor de e-mail.
#
# Sem isto, o `backend/.env` de quem desenvolve decide o resultado dos testes: com
# `SMTP_HOST` configurado, `get_mailer()` devolve o `SmtpMailer` de verdade e cada
# convite criado nos testes abre uma conexão SMTP real. Isso é ruim de três
# formas: depende da rede, é lento, e a credencial de quem roda a suíte é usada
# para mandar e-mail para endereços fictícios.
#
# Passava despercebido enquanto o serviço engolia a falha de envio. Quando a falha
# passou a ser propagada (`INVITE_DELIVERY_FAILED`), os testes que criam conta sem
# trocar o mailer começaram a falhar com `SMTPServerDisconnected` — na máquina de
# quem tem SMTP configurado, e não no CI.
#
# Esvaziar `SMTP_HOST` faz o padrão ser o `LoggingMailer`. Quem precisa observar
# o conteúdo do e-mail usa a fixture `mailer_espiao`; quem testa o SMTP de verdade
# instancia `SmtpMailer` com `Settings` explícito.
os.environ["SMTP_HOST"] = ""
os.environ["SMTP_USER"] = ""
os.environ["SMTP_PASSWORD"] = ""
os.environ["SMTP_FROM"] = "Logos <nao-responda@logos.test>"
# O teto de requisições fica desligado na suíte: os testes não são carga, e a
# cota é compartilhada por IP — os últimos testes do arquivo passariam a receber
# 429 e a falhar por um motivo que não é o que eles verificam. O comportamento do
# limitador tem teste próprio, que o liga explicitamente.
os.environ["RATE_LIMIT_ENABLED"] = "false"
# O disjuntor também guarda estado no processo, com um agravante: os testes que
# simulam falha de banco o deixariam aberto para os testes seguintes, que
# passariam a receber 503 sem relação com o que verificam. Quem testa o
# disjuntor o liga explicitamente.
os.environ["CIRCUIT_BREAKER_ENABLED"] = "false"

import pytest
from alembic.config import Config
from fastapi.testclient import TestClient

from alembic import command
from app.core.cache import get_listing_cache
from app.core.database import create_session
from app.core.tokens import hash_password
from app.domain.enums import UserRole
from app.main import app
from app.repositories.idempotency_repository import IdempotencyRepository
from app.repositories.incident_repository import IncidentRepository
from app.repositories.revoked_token_repository import RevokedTokenRepository
from app.repositories.user_repository import UserRepository
from app.repositories.vehicle_repository import VehicleRepository

TEST_DATABASE_PATH = _DB_FILE
INCIDENTS_URL = "/api/v1/incidents"
LOGIN_URL = "/api/v1/auth/login"

#: Contas usadas pela suíte, criadas uma vez por sessão.
#:
#: Os e-mails ficam num domínio próprio (`.teste.local`) para NÃO colidirem com
#: os do seed de demonstração: se um teste limpasse a base, apagaria as contas
#: que a sessão inteira usa para autenticar.
CONTAS_DA_SUITE: tuple[tuple[str, str, UserRole], ...] = (
    ("analista-suite@teste.local", "Analista da Suite", UserRole.ANALYST),
    ("reporter-suite@teste.local", "Reporter da Suite", UserRole.REPORTER),
    ("admin-suite@teste.local", "Admin da Suite", UserRole.ADMIN),
)

#: Senha das contas da suíte. Cumpre a política mínima de 12 caracteres.
SENHA_DA_SUITE = "senha-da-suite-2026"

_BACKEND_DIR = Path(__file__).resolve().parent.parent


def apply_migrations() -> None:
    """Aplica as migracoes do Alembic no banco de teste.

    A suite usa o mesmo caminho que a producao (`alembic upgrade head`) em vez
    de `Base.metadata.create_all`. Assim uma migracao quebrada — ou um modelo
    que ficou para tras em relacao a ela — aparece aqui, e nao no deploy.
    """
    configuracao = Config(str(_BACKEND_DIR / "alembic.ini"))
    configuracao.set_main_option("script_location", str(_BACKEND_DIR / "alembic"))
    command.upgrade(configuracao, "head")


apply_migrations()


@pytest.fixture(scope="session")
def anonymous_client() -> Iterator[TestClient]:
    """Cliente **sem** credencial.

    Existe para os testes que verificam a própria autenticação: sem ele, não
    haveria como pedir uma rota protegida sem token.
    """
    with TestClient(app, raise_server_exceptions=False) as test_client:
        yield test_client


@pytest.fixture(scope="session")
def contas_da_suite() -> dict[UserRole, str]:
    """Cria as contas da suíte e devolve o e-mail de cada papel.

    Idempotente por consulta: rodar a suíte duas vezes não acumula contas nem
    falha por e-mail duplicado.
    """
    with create_session() as session:
        repositorio = UserRepository(session)
        for email, nome, papel in CONTAS_DA_SUITE:
            if repositorio.get_by_email(email) is None:
                repositorio.create(
                    email=email,
                    password_hash=hash_password(SENHA_DA_SUITE),
                    name=nome,
                    role=papel,
                )
    return {papel: email for email, _nome, papel in CONTAS_DA_SUITE}


@pytest.fixture(scope="session")
def tokens_da_suite(
    anonymous_client: TestClient, contas_da_suite: dict[UserRole, str]
) -> dict[UserRole, str]:
    """Autentica uma vez por papel e guarda o token de cada um.

    Uma vez por **sessão**, e não por teste: cada login custa uma derivação
    Argon2 (~100 ms) e a suíte tem centenas de testes.

    Regra de ouro para quem for escrever teste novo: `logout`, troca de senha e
    desativar conta **invalidam** este token. Um teste que faça qualquer uma
    dessas coisas precisa de token e USUÁRIO próprios, obtidos com
    `anonymous_client` — senão derruba os testes seguintes, e o 401 vai parecer
    um bug de outra coisa.
    """
    tokens: dict[UserRole, str] = {}
    for papel, email in contas_da_suite.items():
        resposta = anonymous_client.post(
            LOGIN_URL, json={"email": email, "password": SENHA_DA_SUITE}
        )
        assert resposta.status_code == 200, resposta.text
        tokens[papel] = resposta.json()["accessToken"]
    return tokens


def _cliente_autenticado(papel: UserRole, tokens: dict[UserRole, str]) -> Iterator[TestClient]:
    """Abre um cliente já com o header Authorization do papel informado."""
    with TestClient(app, raise_server_exceptions=False) as test_client:
        test_client.headers["Authorization"] = f"Bearer {tokens[papel]}"
        yield test_client


@pytest.fixture(scope="session")
def client(tokens_da_suite: dict[UserRole, str]) -> Iterator[TestClient]:
    """Cliente HTTP autenticado como ANALYST — o padrão da suíte.

    Autenticado por padrão de propósito: as rotas de incidentes exigem token, e
    sem isto os ~270 testes existentes precisariam declarar o papel um a um. Os
    testes que verificam a autenticação usam `anonymous_client`.
    """
    yield from _cliente_autenticado(UserRole.ANALYST, tokens_da_suite)


@pytest.fixture()
def reporter_client(tokens_da_suite: dict[UserRole, str]) -> Iterator[TestClient]:
    """Cliente autenticado como REPORTER, para os testes de permissão."""
    yield from _cliente_autenticado(UserRole.REPORTER, tokens_da_suite)


@pytest.fixture()
def admin_client(tokens_da_suite: dict[UserRole, str]) -> Iterator[TestClient]:
    """Cliente autenticado como ADMIN, para os testes de permissão."""
    yield from _cliente_autenticado(UserRole.ADMIN, tokens_da_suite)


@pytest.fixture(autouse=True)
def clean_database() -> Iterator[None]:
    """Zera a base e o cache antes de cada teste para garantir isolamento.

    O schema já foi criado pelas migrações na importação deste módulo; aqui só
    removemos as linhas, sem recriar tabela nenhuma.

    O cache da listagem entra na limpeza porque vive no processo e é indexado
    pelos filtros: dois testes que pedem `GET /incidents` sem filtro usam a
    **mesma chave**, então sem isto o segundo receberia a página do primeiro.
    """
    with create_session() as session:
        IncidentRepository(session).clear()
        # A frota entra na limpeza porque a busca depende do conteúdo dela: um
        # teste que insere `ABC1D23` faria o teste seguinte encontrar uma placa
        # que ele não criou, e a falha apareceria longe da causa.
        VehicleRepository(session).clear()
        IdempotencyRepository(session).clear()
        # Tokens revogados também: um teste de logout que use o token da sessão
        # o revogaria para todos os testes seguintes. `users` NÃO entra aqui —
        # é justamente o que mantém o token da sessão válido.
        RevokedTokenRepository(session).clear()
    get_listing_cache().clear()
    yield


@pytest.fixture()
def incident_factory(client: TestClient) -> Callable[..., dict[str, Any]]:
    """Fábrica de incidentes válidos via API."""

    def factory(**overrides: Any) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "title": "Colisão com veículo na pista",
            "description": "Bloqueio parcial da faixa da direita no trecho.",
            "category": "ACIDENTE_COM_VEICULO",
            "criticality": "MEDIA",
            "locationLabel": "BR-116 km 412, sentido São Paulo",
            "truckPlate": "QRD1A23",
            "driverName": "João Batista Ferreira",
            "reportedBy": "Rádio Frota 12",
        }
        payload.update(overrides)
        response = client.post(INCIDENTS_URL, json=payload)
        assert response.status_code == 201, response.text
        return response.json()

    return factory
