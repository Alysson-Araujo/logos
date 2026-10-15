"""Teste de corrida real: 10 threads disputando a mesma transição de status.

Este é o teste que prova o lock otimista. O banco é um arquivo SQLite real (não `:memory:`),
porque threads diferentes precisam compartilhar a mesma base através de conexões distintas.
"""

from __future__ import annotations

from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from typing import Any

import pytest
from fastapi.testclient import TestClient

INCIDENTS_URL = "/api/v1/incidents"
CONCURRENT_REQUESTS = 10


def fire_concurrently(
    client: TestClient,
    incident_id: str,
    *,
    headers: dict[str, str],
    payload: dict[str, Any],
) -> list[int]:
    """Dispara N transições simultâneas idênticas e devolve os status HTTP."""

    def attempt(_index: int) -> int:
        response = client.post(
            f"{INCIDENTS_URL}/{incident_id}/status",
            json=payload,
            headers=headers,
        )
        return response.status_code

    with ThreadPoolExecutor(max_workers=CONCURRENT_REQUESTS) as executor:
        return list(executor.map(attempt, range(CONCURRENT_REQUESTS)))


@pytest.mark.concurrency
def test_dez_threads_com_mesma_versao_tem_um_vencedor_e_nove_conflitos(
    client: TestClient, incident_factory: Callable[..., dict[str, Any]]
) -> None:
    created = incident_factory(title="Acidente com vítimas na BR-116 - teste de corrida")
    incident_id = created["id"]
    expected_version = created["version"]

    statuses = fire_concurrently(
        client,
        incident_id,
        headers={"If-Match": f'"{expected_version}"'},
        payload={"status": "EM_INVESTIGACAO", "assignedAnalyst": "Ana Paula Ribeiro"},
    )

    assert statuses.count(200) == 1, statuses
    assert statuses.count(409) == CONCURRENT_REQUESTS - 1, statuses

    final = client.get(f"{INCIDENTS_URL}/{incident_id}")
    assert final.status_code == 200
    body = final.json()
    assert body["version"] == expected_version + 1
    assert body["status"] == "EM_INVESTIGACAO"
    assert final.headers["ETag"] == f'"{expected_version + 1}"'


@pytest.mark.concurrency
def test_corrida_com_expected_version_no_corpo(
    client: TestClient, incident_factory: Callable[..., dict[str, Any]]
) -> None:
    created = incident_factory(title="Bloqueio de pista na SP-330 - corrida no corpo")
    incident_id = created["id"]
    expected_version = created["version"]

    statuses = fire_concurrently(
        client,
        incident_id,
        headers={},
        payload={
            "status": "INCONCLUSIVO",
            "expectedVersion": expected_version,
            "resolutionNotes": "Sem evidências no local para conclusão do caso.",
        },
    )

    assert statuses.count(200) == 1, statuses
    assert statuses.count(409) == CONCURRENT_REQUESTS - 1, statuses


@pytest.mark.concurrency
def test_vencedor_nao_e_sobrescrito_por_escrita_tardia(
    client: TestClient, incident_factory: Callable[..., dict[str, Any]]
) -> None:
    created = incident_factory(title="Falha mecânica na BR-101 - escrita tardia")
    incident_id = created["id"]
    first_version = created["version"]

    winner = client.post(
        f"{INCIDENTS_URL}/{incident_id}/status",
        json={"status": "EM_INVESTIGACAO"},
        headers={"If-Match": f'"{first_version}"'},
    )
    assert winner.status_code == 200
    second_version = winner.json()["version"]

    late = client.post(
        f"{INCIDENTS_URL}/{incident_id}/status",
        json={"status": "FECHADO", "resolutionNotes": "Encerrado após atendimento no local."},
        headers={"If-Match": f'"{first_version}"'},
    )
    assert late.status_code == 409
    assert late.json()["error"]["code"] == "VERSION_CONFLICT"
    assert late.json()["error"]["details"]["current"]["version"] == second_version

    final = client.get(f"{INCIDENTS_URL}/{incident_id}").json()
    assert final["status"] == "EM_INVESTIGACAO"
    assert final["closedAt"] is None
