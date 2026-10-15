"""Testes de integração dos endpoints de incidentes."""

from __future__ import annotations

import re
from collections.abc import Callable
from typing import Any

from fastapi.testclient import TestClient

from app.core.database import create_session
from app.infra.seed import SEED_COUNT, seed_incidents
from app.repositories.incident_repository import IncidentFilter, IncidentRepository

CODE_PATTERN = re.compile(r"^INC-\d{4}-\d{6}$")
INCIDENTS_URL = "/api/v1/incidents"


def test_health_live_responde_alive(client: TestClient) -> None:
    response = client.get("/api/v1/health/live")
    assert response.status_code == 200
    assert response.json() == {"status": "alive"}


def test_health_ready_valida_banco(client: TestClient) -> None:
    response = client.get("/api/v1/health/ready")
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ready"
    assert body["database"] == "ok"


def test_meta_enums_traz_categorias_criticidades_e_status(client: TestClient) -> None:
    response = client.get("/api/v1/meta/enums")
    assert response.status_code == 200
    body = response.json()

    assert [item["value"] for item in body["categories"]] == [
        "ACIDENTE_COM_VEICULO",
        "ACIDENTE_COM_VITIMAS",
        "CONDICAO_CLIMATICA_ATIPICA",
        "PROBLEMA_MECANICO",
        "BLOQUEIO_DE_PISTA",
    ]
    assert len(body["categories"]) == 5
    assert [item["value"] for item in body["criticalities"]] == ["ALTA", "MEDIA", "BAIXA"]
    assert len(body["criticalities"]) == 3
    assert [item["value"] for item in body["statuses"]] == [
        "ABERTO",
        "EM_INVESTIGACAO",
        "FECHADO",
        "INCONCLUSIVO",
    ]
    assert len(body["statuses"]) == 4


def test_meta_enums_tem_rotulo_pt_br_cor_e_icone(client: TestClient) -> None:
    body = client.get("/api/v1/meta/enums").json()

    victims = next(item for item in body["categories"] if item["value"] == "ACIDENTE_COM_VITIMAS")
    assert victims["label"] == "Acidente com Vítimas"
    assert victims["color"] == "#DC2626"
    assert victims["icon"] == "✚"
    assert victims["impact"] == 300

    high = next(item for item in body["criticalities"] if item["value"] == "ALTA")
    assert high["label"] == "Alta"
    assert high["urgency"] == 500
    assert high["slaHours"] == 2
    assert high["shape"] == "triangle"

    closed = next(item for item in body["statuses"] if item["value"] == "FECHADO")
    assert closed["label"] == "Fechado"
    assert closed["terminal"] is True
    assert closed["allowedTransitions"] == []

    open_status = next(item for item in body["statuses"] if item["value"] == "ABERTO")
    assert open_status["terminal"] is False
    assert open_status["allowedTransitions"] == ["EM_INVESTIGACAO", "FECHADO", "INCONCLUSIVO"]
    assert all(item["colorDark"].startswith("#") for item in body["categories"])


def test_criacao_devolve_201_com_codigo_legivel(
    incident_factory: Callable[..., dict[str, Any]],
) -> None:
    created = incident_factory()
    assert CODE_PATTERN.match(created["code"])
    assert created["status"] == "ABERTO"
    assert created["version"] == 1
    assert created["priorityScore"] > 0
    assert created["slaDueAt"].endswith("Z")
    assert created["createdAt"].endswith("Z")
    assert created["closedAt"] is None
    assert created["assignedAnalyst"] is None
    assert created["latitude"] is None
    assert created["truckPlate"] == "QRD1A23"


def test_criacao_calcula_sla_e_score_por_criticidade(
    incident_factory: Callable[..., dict[str, Any]],
) -> None:
    alta = incident_factory(criticality="ALTA")
    baixa = incident_factory(criticality="BAIXA")
    assert alta["priorityScore"] - baixa["priorityScore"] == 500 - 80


def test_criacao_devolve_headers_location_e_etag(client: TestClient) -> None:
    response = client.post(
        INCIDENTS_URL,
        json={
            "title": "Falha mecânica na BR-101",
            "category": "PROBLEMA_MECANICO",
            "criticality": "BAIXA",
            "reportedBy": "Central 0800",
        },
    )
    assert response.status_code == 201
    incident = response.json()
    assert response.headers["Location"] == f"{INCIDENTS_URL}/{incident['id']}"
    assert response.headers["ETag"] == '"1"'


def test_detalhe_devolve_etag_com_a_versao(
    client: TestClient, incident_factory: Callable[..., dict[str, Any]]
) -> None:
    created = incident_factory()
    response = client.get(f"{INCIDENTS_URL}/{created['id']}")
    assert response.status_code == 200
    assert response.headers["ETag"] == f'"{created["version"]}"'
    assert response.json()["code"] == created["code"]


def test_detalhe_de_id_inexistente_devolve_404_no_envelope(client: TestClient) -> None:
    response = client.get(f"{INCIDENTS_URL}/2f1c9f7e-0000-4000-8000-000000000000")
    assert response.status_code == 404
    body = response.json()
    assert body["error"]["code"] == "INCIDENT_NOT_FOUND"
    assert set(body["error"]) == {"code", "message", "details", "requestId", "timestamp"}


def test_transicao_de_status_incrementa_versao(
    client: TestClient, incident_factory: Callable[..., dict[str, Any]]
) -> None:
    created = incident_factory()
    response = client.post(
        f"{INCIDENTS_URL}/{created['id']}/status",
        json={"status": "EM_INVESTIGACAO", "assignedAnalyst": "Ana Paula Ribeiro"},
        headers={"If-Match": '"1"'},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "EM_INVESTIGACAO"
    assert body["version"] == 2
    assert body["assignedAnalyst"] == "Ana Paula Ribeiro"
    assert response.headers["ETag"] == '"2"'
    assert body["closedAt"] is None


def test_transicao_aceita_expected_version_no_corpo(
    client: TestClient, incident_factory: Callable[..., dict[str, Any]]
) -> None:
    created = incident_factory()
    response = client.post(
        f"{INCIDENTS_URL}/{created['id']}/status",
        json={"status": "EM_INVESTIGACAO", "expectedVersion": created["version"]},
    )
    assert response.status_code == 200
    assert response.json()["version"] == created["version"] + 1


def test_fechamento_exige_justificativa(
    client: TestClient, incident_factory: Callable[..., dict[str, Any]]
) -> None:
    created = incident_factory()
    response = client.post(
        f"{INCIDENTS_URL}/{created['id']}/status",
        json={"status": "FECHADO"},
        headers={"If-Match": f'"{created["version"]}"'},
    )
    assert response.status_code == 422
    body = response.json()
    assert body["error"]["code"] == "RESOLUTION_NOTES_REQUIRED"
    assert body["error"]["details"]["status"] == "FECHADO"


def test_fechamento_com_justificativa_registra_closed_at(
    client: TestClient, incident_factory: Callable[..., dict[str, Any]]
) -> None:
    created = incident_factory()
    response = client.post(
        f"{INCIDENTS_URL}/{created['id']}/status",
        json={
            "status": "FECHADO",
            "resolutionNotes": "Pista liberada após remoção da carga pelo guincho.",
        },
        headers={"If-Match": f'"{created["version"]}"'},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "FECHADO"
    assert body["closedAt"] is not None
    assert body["resolutionNotes"].startswith("Pista liberada")


def test_fechado_e_terminal_e_recusa_nova_transicao(
    client: TestClient, incident_factory: Callable[..., dict[str, Any]]
) -> None:
    created = incident_factory()
    headers = {"If-Match": f'"{created["version"]}"'}
    closed = client.post(
        f"{INCIDENTS_URL}/{created['id']}/status",
        json={"status": "FECHADO", "resolutionNotes": "Caso encerrado com laudo técnico."},
        headers=headers,
    )
    assert closed.status_code == 200
    version = closed.json()["version"]

    retry = client.post(
        f"{INCIDENTS_URL}/{created['id']}/status",
        json={"status": "EM_INVESTIGACAO"},
        headers={"If-Match": f'"{version}"'},
    )
    assert retry.status_code == 422
    body = retry.json()
    assert body["error"]["code"] == "INVALID_STATUS_TRANSITION"
    assert body["error"]["details"] == {
        "from": "FECHADO",
        "to": "EM_INVESTIGACAO",
        "allowed": [],
    }


def test_conflito_de_versao_devolve_409_com_estado_atual(
    client: TestClient, incident_factory: Callable[..., dict[str, Any]]
) -> None:
    created = incident_factory()
    first = client.post(
        f"{INCIDENTS_URL}/{created['id']}/status",
        json={"status": "EM_INVESTIGACAO"},
        headers={"If-Match": '"1"'},
    )
    assert first.status_code == 200

    stale = client.post(
        f"{INCIDENTS_URL}/{created['id']}/status",
        json={"status": "INCONCLUSIVO", "resolutionNotes": "Sem evidências suficientes no local."},
        headers={"If-Match": '"1"'},
    )
    assert stale.status_code == 409
    body = stale.json()
    assert body["error"]["code"] == "VERSION_CONFLICT"
    current = body["error"]["details"]["current"]
    assert current["version"] == 2
    assert current["status"] == "EM_INVESTIGACAO"
    assert body["error"]["details"]["expectedVersion"] == 1


def test_soft_delete_devolve_204_e_remove_da_listagem(
    client: TestClient, incident_factory: Callable[..., dict[str, Any]]
) -> None:
    created = incident_factory()
    response = client.delete(f"{INCIDENTS_URL}/{created['id']}")
    assert response.status_code == 204
    assert response.content == b""
    assert client.get(f"{INCIDENTS_URL}/{created['id']}").status_code == 404

    listing = client.get(INCIDENTS_URL).json()
    assert listing["items"] == []
    assert listing["meta"]["total"] == 0


def test_soft_delete_inexistente_devolve_404(client: TestClient) -> None:
    response = client.delete(f"{INCIDENTS_URL}/2f1c9f7e-0000-4000-8000-000000000000")
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "INCIDENT_NOT_FOUND"


def test_seed_e_idempotente_e_gera_cento_e_vinte_incidentes() -> None:
    with create_session() as session:
        repository = IncidentRepository(session)
        repository.clear()
        assert seed_incidents(session) == SEED_COUNT
        assert seed_incidents(session) == 0
        assert repository.count() == SEED_COUNT


def test_seed_respeita_a_distribuicao_de_criticidade() -> None:
    with create_session() as session:
        repository = IncidentRepository(session)
        repository.clear()
        seed_incidents(session)
        items, total, _ = repository.list_incidents(IncidentFilter(limit=200))
        assert total == SEED_COUNT
        alta = [item for item in items if item.criticality.value == "ALTA"]
        baixa = [item for item in items if item.criticality.value == "BAIXA"]
        assert len(alta) == 18
        assert len(baixa) == 60
        assert all(item.truck_plate for item in items)
        assert all(item.location_label and "km" in item.location_label for item in items)
        assert all(item.code.startswith("INC-") for item in items)
