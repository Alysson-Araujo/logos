"""Testes de integração do envelope de erro e das pré-condições HTTP."""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

from fastapi.testclient import TestClient

INCIDENTS_URL = "/api/v1/incidents"
ERROR_KEYS = {"code", "message", "details", "requestId", "timestamp"}


def assert_error_envelope(response: Any, *, status: int, code: str) -> dict[str, Any]:
    """Valida o formato único do envelope de erro."""
    assert response.status_code == status
    body = response.json()
    assert set(body) == {"error"}
    assert set(body["error"]) == ERROR_KEYS
    assert body["error"]["code"] == code
    assert isinstance(body["error"]["message"], str)
    assert body["error"]["message"]
    assert body["error"]["requestId"]
    assert body["error"]["timestamp"].endswith("Z")
    return body["error"]


def test_erro_de_validacao_usa_envelope_e_nao_detail(client: TestClient) -> None:
    response = client.post(INCIDENTS_URL, json={"title": "Curto"})
    error = assert_error_envelope(response, status=422, code="VALIDATION_ERROR")
    assert "detail" not in response.json()
    assert error["details"]["validationErrors"]
    locais = {str(part) for item in error["details"]["validationErrors"] for part in item["loc"]}
    assert {"category", "criticality"} <= locais
    assert locais & {"reported_by", "reportedBy"}


def test_enum_invalido_no_corpo(client: TestClient) -> None:
    response = client.post(
        INCIDENTS_URL,
        json={
            "title": "Incidente com categoria inválida",
            "category": "PANE",
            "criticality": "ALTA",
            "reportedBy": "Central 0800",
        },
    )
    assert_error_envelope(response, status=422, code="VALIDATION_ERROR")


def test_json_malformado_devolve_422(client: TestClient) -> None:
    response = client.post(
        INCIDENTS_URL,
        content=b'{"title": "sem fechar"',
        headers={"Content-Type": "application/json"},
    )
    assert_error_envelope(response, status=422, code="VALIDATION_ERROR")


def test_tipos_inesperados_nunca_geram_500(client: TestClient) -> None:
    payloads: list[Any] = [
        {"title": 42, "category": "PROBLEMA_MECANICO", "criticality": "BAIXA", "reportedBy": "X1"},
        {
            "title": ["a"],
            "category": "PROBLEMA_MECANICO",
            "criticality": "BAIXA",
            "reportedBy": "X1",
        },
        {
            "title": "Incidente válido",
            "category": "PROBLEMA_MECANICO",
            "criticality": "BAIXA",
            "reportedBy": "Central",
            "latitude": {"a": 1},
        },
        {
            "title": "Incidente válido",
            "category": "PROBLEMA_MECANICO",
            "criticality": "BAIXA",
            "reportedBy": "Central",
            "longitude": "oeste",
        },
        {
            "title": "Incidente válido",
            "category": "PROBLEMA_MECANICO",
            "criticality": "BAIXA",
            "reportedBy": "Central",
            "latitude": 91,
        },
        {
            "title": "Incidente válido",
            "category": "PROBLEMA_MECANICO",
            "criticality": "BAIXA",
            "reportedBy": "Central",
            "truckPlate": "INVALIDA",
        },
    ]
    for payload in payloads:
        response = client.post(INCIDENTS_URL, json=payload)
        assert response.status_code == 422, payload
        assert response.json()["error"]["code"] == "VALIDATION_ERROR"


def test_id_invalido_na_rota_devolve_422(client: TestClient) -> None:
    response = client.get(f"{INCIDENTS_URL}/nao-e-uuid")
    assert_error_envelope(response, status=422, code="VALIDATION_ERROR")


def test_rota_inexistente_devolve_404_no_envelope(client: TestClient) -> None:
    response = client.get("/api/v1/incidentes")
    assert_error_envelope(response, status=404, code="HTTP_404")


def test_metodo_nao_permitido_devolve_405_no_envelope(client: TestClient) -> None:
    response = client.put(INCIDENTS_URL, json={})
    assert_error_envelope(response, status=405, code="HTTP_405")


def test_if_match_malformado_devolve_412(
    client: TestClient, incident_factory: Callable[..., dict[str, Any]]
) -> None:
    created = incident_factory()
    for valor in ("3", '"abc"', "*", "v3"):
        response = client.post(
            f"{INCIDENTS_URL}/{created['id']}/status",
            json={"status": "EM_INVESTIGACAO"},
            headers={"If-Match": valor},
        )
        error = assert_error_envelope(response, status=412, code="PRECONDITION_FAILED")
        assert error["details"]["ifMatch"] == valor


def test_transicao_sem_precondicao_devolve_428(
    client: TestClient, incident_factory: Callable[..., dict[str, Any]]
) -> None:
    created = incident_factory()
    response = client.post(
        f"{INCIDENTS_URL}/{created['id']}/status", json={"status": "EM_INVESTIGACAO"}
    )
    assert_error_envelope(response, status=428, code="PRECONDITION_REQUIRED")


def test_transicao_inexistente_devolve_404(
    client: TestClient, incident_factory: Callable[..., dict[str, Any]]
) -> None:
    response = client.post(
        f"{INCIDENTS_URL}/2f1c9f7e-0000-4000-8000-000000000000/status",
        json={"status": "EM_INVESTIGACAO"},
        headers={"If-Match": '"1"'},
    )
    assert_error_envelope(response, status=404, code="INCIDENT_NOT_FOUND")


def test_transicao_invalida_devolve_422_com_permitidas(
    client: TestClient, incident_factory: Callable[..., dict[str, Any]]
) -> None:
    created = incident_factory()
    response = client.post(
        f"{INCIDENTS_URL}/{created['id']}/status",
        json={"status": "ABERTO"},
        headers={"If-Match": '"1"'},
    )
    error = assert_error_envelope(response, status=422, code="INVALID_STATUS_TRANSITION")
    assert error["details"] == {
        "from": "ABERTO",
        "to": "ABERTO",
        "allowed": ["EM_INVESTIGACAO", "FECHADO", "INCONCLUSIVO"],
    }


def test_lock_otimista_com_versao_maior_devolve_409(
    client: TestClient, incident_factory: Callable[..., dict[str, Any]]
) -> None:
    created = incident_factory()
    response = client.post(
        f"{INCIDENTS_URL}/{created['id']}/status",
        json={"status": "EM_INVESTIGACAO"},
        headers={"If-Match": '"9"'},
    )
    error = assert_error_envelope(response, status=409, code="VERSION_CONFLICT")
    assert error["details"]["current"]["id"] == created["id"]
    assert error["details"]["current"]["version"] == 1


def test_request_id_e_propagado_no_header_e_no_erro(client: TestClient) -> None:
    response = client.get(f"{INCIDENTS_URL}/2f1c9f7e-0000-4000-8000-000000000000")
    assert response.headers["X-Request-Id"]
    assert response.json()["error"]["requestId"] == response.headers["X-Request-Id"]

    custom = client.get("/api/v1/health/live", headers={"X-Request-Id": "request-id-forcado-123"})
    assert custom.headers["X-Request-Id"] == "request-id-forcado-123"


def test_openapi_expoe_os_endpoints_minimos(client: TestClient) -> None:
    schema = client.get("/openapi.json").json()
    paths = schema["paths"]
    assert "/api/v1/health/live" in paths
    assert "/api/v1/health/ready" in paths
    assert "/api/v1/meta/enums" in paths
    assert set(paths["/api/v1/incidents"]) == {"get", "post"}
    assert set(paths["/api/v1/incidents/{incident_id}"]) == {"get", "delete"}
    assert "post" in paths["/api/v1/incidents/{incident_id}/status"]
