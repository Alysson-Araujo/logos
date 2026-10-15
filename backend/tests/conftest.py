"""Fixtures compartilhadas dos testes.

O ambiente é configurado ANTES de importar a aplicação: os testes rodam contra um banco
SQLite em arquivo (não `:memory:`), porque o teste de concorrência usa várias threads com
conexões distintas.
"""

from __future__ import annotations

import os
import tempfile
from collections.abc import Callable, Iterator
from pathlib import Path
from typing import Any

_TEST_DIR = Path(tempfile.mkdtemp(prefix="logos-tests-"))
_DB_FILE = _TEST_DIR / "logos-test.db"

os.environ["DATABASE_URL"] = f"sqlite:///{_DB_FILE.as_posix()}"
os.environ["SEED_ON_STARTUP"] = "false"
os.environ["LOG_LEVEL"] = "ERROR"
os.environ["ENVIRONMENT"] = "test"
os.environ["CORS_ORIGINS"] = "http://localhost:5173"

import pytest
from fastapi.testclient import TestClient

from app.core.database import create_session, get_engine
from app.main import app
from app.models import Base
from app.repositories.incident_repository import IncidentRepository

TEST_DATABASE_PATH = _DB_FILE
INCIDENTS_URL = "/api/v1/incidents"

Base.metadata.create_all(bind=get_engine())


@pytest.fixture(scope="session")
def client() -> Iterator[TestClient]:
    """Cliente HTTP apoiado no ASGI da aplicação, com lifespan executado."""
    with TestClient(app, raise_server_exceptions=False) as test_client:
        yield test_client


@pytest.fixture(autouse=True)
def clean_database() -> Iterator[None]:
    """Zera a base antes de cada teste para garantir isolamento."""
    Base.metadata.create_all(bind=get_engine())
    with create_session() as session:
        IncidentRepository(session).clear()
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
