"""Cache da listagem visto pela camada HTTP.

O que se verifica aqui é o comportamento que o analista percebe: a segunda
leitura não vai ao banco, uma mutação não fica escondida, e — o ponto da issue —
durante uma degradação a lista continua na tela em vez de virar erro.
"""

from __future__ import annotations

from collections.abc import Callable, Iterator
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.exc import OperationalError

from app.core.cache import CACHE_STATUS_HEADER, reset_listing_cache
from app.core.circuit_breaker import reset_circuit_breaker
from app.core.config import reset_settings_cache
from app.repositories.incident_repository import IncidentRepository

INCIDENTS_URL = "/api/v1/incidents"


@pytest.fixture()
def cache_fresco(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    """TTL longo: a segunda leitura é `HIT`."""
    monkeypatch.setenv("CACHE_TTL_SECONDS", "300")
    reset_settings_cache()
    reset_listing_cache()
    yield
    reset_settings_cache()
    reset_listing_cache()


@pytest.fixture()
def cache_vencido(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    """TTL zero: toda leitura tenta revalidar, então `REVALIDATED` ou `STALE`.

    O disjuntor entra ligado com limiar 1 para o cenário de degradação ser
    atingido em uma única falha, sem espera.
    """
    monkeypatch.setenv("CACHE_TTL_SECONDS", "0")
    monkeypatch.setenv("CIRCUIT_BREAKER_ENABLED", "true")
    monkeypatch.setenv("CIRCUIT_BREAKER_FAILURE_THRESHOLD", "1")
    monkeypatch.setenv("RETRY_MAX_ATTEMPTS", "1")
    reset_settings_cache()
    reset_listing_cache()
    reset_circuit_breaker()
    yield
    reset_settings_cache()
    reset_listing_cache()
    reset_circuit_breaker()


def derruba_o_banco(monkeypatch: pytest.MonkeyPatch) -> None:
    """Faz a listagem falhar por motivo transitório de infraestrutura."""

    def sempre_falha(self: IncidentRepository, filters: Any) -> Any:
        raise OperationalError("SELECT 1", {}, Exception("conexao caiu"))

    monkeypatch.setattr(IncidentRepository, "list_incidents", sempre_falha)


# --------------------------------------------------------------------------- #
# HIT
# --------------------------------------------------------------------------- #
def test_primeira_leitura_e_miss_e_a_seguinte_e_hit(client: TestClient, cache_fresco: None) -> None:
    primeira = client.get(INCIDENTS_URL)
    assert primeira.status_code == 200
    assert primeira.headers[CACHE_STATUS_HEADER] == "MISS"

    segunda = client.get(INCIDENTS_URL)

    assert segunda.headers[CACHE_STATUS_HEADER] == "HIT"
    assert segunda.json() == primeira.json()


def test_hit_nao_consulta_o_banco(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, cache_fresco: None
) -> None:
    """O ganho do cache é exatamente este: a resposta não custa ida ao banco."""
    client.get(INCIDENTS_URL)

    original = IncidentRepository.list_incidents
    chamadas: list[int] = []

    def conta(self: IncidentRepository, filters: Any) -> Any:
        chamadas.append(1)
        return original(self, filters)

    monkeypatch.setattr(IncidentRepository, "list_incidents", conta)

    resposta = client.get(INCIDENTS_URL)

    assert resposta.headers[CACHE_STATUS_HEADER] == "HIT"
    assert chamadas == []


# --------------------------------------------------------------------------- #
# Invalidação por mutação
# --------------------------------------------------------------------------- #
def test_mutacao_invalida_o_cache(
    client: TestClient,
    cache_fresco: None,
    incident_factory: Callable[..., dict[str, Any]],
) -> None:
    """Sem isto, criar um incidente e não vê-lo na lista pareceria perda de dado."""
    antes = client.get(INCIDENTS_URL)
    assert antes.headers[CACHE_STATUS_HEADER] == "MISS"
    total_antes = antes.json()["meta"]["total"]

    incident_factory()

    depois = client.get(INCIDENTS_URL)

    assert depois.headers[CACHE_STATUS_HEADER] == "MISS"  # o cache foi esvaziado
    assert depois.json()["meta"]["total"] == total_antes + 1


def test_filtros_diferentes_nao_compartilham_entrada(
    client: TestClient,
    cache_fresco: None,
    incident_factory: Callable[..., dict[str, Any]],
) -> None:
    incident_factory()
    incident_factory(criticality="ALTA")

    todas = client.get(INCIDENTS_URL)
    altas = client.get(f"{INCIDENTS_URL}?criticality=ALTA")

    assert todas.headers[CACHE_STATUS_HEADER] == "MISS"
    assert altas.headers[CACHE_STATUS_HEADER] == "MISS"  # chave diferente
    assert altas.json()["meta"]["total"] == 1
    assert client.get(f"{INCIDENTS_URL}?criticality=ALTA").json() == altas.json()


# --------------------------------------------------------------------------- #
# Revalidação e degradação
# --------------------------------------------------------------------------- #
def test_ttl_vencido_revalida(client: TestClient, cache_vencido: None) -> None:
    primeira = client.get(INCIDENTS_URL)
    assert primeira.headers[CACHE_STATUS_HEADER] == "MISS"

    segunda = client.get(INCIDENTS_URL)

    assert segunda.status_code == 200
    assert segunda.headers[CACHE_STATUS_HEADER] == "REVALIDATED"


def test_serve_copia_antiga_quando_o_banco_cai(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    cache_vencido: None,
    incident_factory: Callable[..., dict[str, Any]],
) -> None:
    """É o ponto da issue: dado levemente antigo em vez de tela de erro."""
    esperado = incident_factory()

    populada = client.get(INCIDENTS_URL)
    assert populada.headers[CACHE_STATUS_HEADER] == "MISS"
    assert [item["id"] for item in populada.json()["items"]] == [esperado["id"]]

    derruba_o_banco(monkeypatch)

    # A revalidação falha e abre o circuito (limiar 1)...
    primeira_degradada = client.get(INCIDENTS_URL)
    assert primeira_degradada.headers[CACHE_STATUS_HEADER] == "STALE"

    # ...e a seguinte nem toca no banco: sai na hora, com a cópia.
    degradada = client.get(INCIDENTS_URL)

    assert degradada.status_code == 200
    assert degradada.headers[CACHE_STATUS_HEADER] == "STALE"
    assert degradada.json() == populada.json()


def test_sem_copia_o_503_sobe(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, cache_vencido: None
) -> None:
    """Sem cópia guardada não há o que servir: devolver lista vazia mentiria."""
    derruba_o_banco(monkeypatch)

    resposta = client.get(INCIDENTS_URL)

    assert resposta.status_code == 503
    assert resposta.json()["error"]["code"] == "SERVICE_UNAVAILABLE"
    assert "items" not in resposta.json()
