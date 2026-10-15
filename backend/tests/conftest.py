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

import pytest
from alembic.config import Config
from fastapi.testclient import TestClient

from alembic import command
from app.core.database import create_session
from app.main import app
from app.repositories.idempotency_repository import IdempotencyRepository
from app.repositories.incident_repository import IncidentRepository

TEST_DATABASE_PATH = _DB_FILE
INCIDENTS_URL = "/api/v1/incidents"

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
def client() -> Iterator[TestClient]:
    """Cliente HTTP apoiado no ASGI da aplicação, com lifespan executado."""
    with TestClient(app, raise_server_exceptions=False) as test_client:
        yield test_client


@pytest.fixture(autouse=True)
def clean_database() -> Iterator[None]:
    """Zera a base antes de cada teste para garantir isolamento.

    O schema já foi criado pelas migrações na importação deste módulo; aqui só
    removemos as linhas, sem recriar tabela nenhuma.
    """
    with create_session() as session:
        IncidentRepository(session).clear()
        IdempotencyRepository(session).clear()
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
