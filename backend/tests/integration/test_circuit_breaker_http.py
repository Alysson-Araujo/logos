"""O disjuntor visto pela camada HTTP.

Prova o que importa na operação: depois de N falhas a API **para de chamar o
banco** e responde `503` com `Retry-After`; passado o cooldown, uma sondagem é
autorizada e, se funcionar, o tráfego volta.
"""

from __future__ import annotations

import time
from collections.abc import Iterator
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.exc import OperationalError

from app.core.circuit_breaker import reset_circuit_breaker
from app.core.config import reset_settings_cache
from app.repositories.incident_repository import IncidentRepository

INCIDENTS_URL = "/api/v1/incidents"
HEALTH_URL = "/api/v1/health/live"
INEXISTENTE = f"{INCIDENTS_URL}/2f1c9f7e-0000-4000-8000-000000000000"

LIMIAR = 2
COOLDOWN = 0.3


@pytest.fixture()
def disjuntor_curto(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    """Limiar e cooldown mínimos, para o teste não esperar de verdade."""
    monkeypatch.setenv("CIRCUIT_BREAKER_ENABLED", "true")
    monkeypatch.setenv("CIRCUIT_BREAKER_FAILURE_THRESHOLD", str(LIMIAR))
    monkeypatch.setenv("CIRCUIT_BREAKER_COOLDOWN_SECONDS", str(COOLDOWN))
    monkeypatch.setenv("RETRY_BASE_DELAY_SECONDS", "0")
    reset_settings_cache()
    reset_circuit_breaker()
    yield
    reset_settings_cache()
    reset_circuit_breaker()


def falha_transitoria() -> OperationalError:
    """Conexão perdida: o que o disjuntor conta como falha."""
    return OperationalError("SELECT 1", {}, Exception("conexao caiu"))


def test_abre_apos_o_limiar_e_para_de_chamar_o_banco(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, disjuntor_curto: None
) -> None:
    chamadas: list[int] = []

    def sempre_falha(self: IncidentRepository, filters: Any) -> Any:
        chamadas.append(1)
        raise falha_transitoria()

    monkeypatch.setattr(IncidentRepository, "list_incidents", sempre_falha)

    for _ in range(LIMIAR):
        assert client.get(INCIDENTS_URL).status_code == 503

    antes = len(chamadas)
    # A retentativa tentou de verdade antes de o circuito abrir.
    assert antes > 0

    recusada = client.get(INCIDENTS_URL)

    assert recusada.status_code == 503
    assert recusada.json()["error"]["code"] == "SERVICE_UNAVAILABLE"
    assert int(recusada.headers["Retry-After"]) >= 1
    assert recusada.json()["error"]["details"]["retryAfterSeconds"] >= 1
    # O ponto do disjuntor: esta requisição não tocou no banco.
    assert len(chamadas) == antes


def test_apos_o_cooldown_a_sondagem_volta_a_passar(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, disjuntor_curto: None
) -> None:
    original = IncidentRepository.list_incidents
    estado = {"quebrado": True}
    chamadas: list[int] = []

    def talvez_falhe(self: IncidentRepository, filters: Any) -> Any:
        chamadas.append(1)
        if estado["quebrado"]:
            raise falha_transitoria()
        return original(self, filters)

    monkeypatch.setattr(IncidentRepository, "list_incidents", talvez_falhe)

    for _ in range(LIMIAR):
        assert client.get(INCIDENTS_URL).status_code == 503

    antes = len(chamadas)
    assert client.get(INCIDENTS_URL).status_code == 503
    assert len(chamadas) == antes

    # O banco volta...
    estado["quebrado"] = False
    time.sleep(COOLDOWN + 0.05)

    # ...e a sondagem, única, é autorizada a descobrir isso.
    assert client.get(INCIDENTS_URL).status_code == 200
    assert len(chamadas) == antes + 1
    # Circuito fechado: o tráfego normal volta.
    assert client.get(INCIDENTS_URL).status_code == 200


def test_erro_de_negocio_nao_abre_o_circuito(client: TestClient, disjuntor_curto: None) -> None:
    """Um 404 rápido é sinal de que o banco respondeu — saúde, não doença."""
    for _ in range(LIMIAR * 4):
        assert client.get(INEXISTENTE).status_code == 404

    assert client.get(INCIDENTS_URL).status_code == 200


def test_liveness_responde_com_o_circuito_aberto(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, disjuntor_curto: None
) -> None:
    """Se o liveness caísse junto, a plataforma reiniciaria o serviço durante a queda.

    O reinício não conserta o banco e ainda derruba o processo que estava de pé —
    exatamente o dano que o disjuntor existe para evitar.
    """

    def sempre_falha(self: IncidentRepository, filters: Any) -> Any:
        raise falha_transitoria()

    monkeypatch.setattr(IncidentRepository, "list_incidents", sempre_falha)

    for _ in range(LIMIAR + 1):
        client.get(INCIDENTS_URL)

    assert client.get(HEALTH_URL).status_code == 200
