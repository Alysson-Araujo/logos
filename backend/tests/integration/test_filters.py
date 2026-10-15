"""Testes de integração de filtros, ordenação e paginação por cursor."""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

from fastapi.testclient import TestClient

INCIDENTS_URL = "/api/v1/incidents"


def create_matrix(incident_factory: Callable[..., dict[str, Any]]) -> list[dict[str, Any]]:
    """Cria uma matriz pequena e determinística de incidentes."""
    return [
        incident_factory(
            title="Acidente com vítimas na BR-116",
            category="ACIDENTE_COM_VITIMAS",
            criticality="ALTA",
            locationLabel="BR-116 km 100, sentido São Paulo",
            truckPlate="AAA1A11",
        ),
        incident_factory(
            title="Bloqueio de pista na SP-330",
            category="BLOQUEIO_DE_PISTA",
            criticality="ALTA",
            locationLabel="SP-330 km 88, sentido interior",
            truckPlate="BBB2B22",
        ),
        incident_factory(
            title="Falha mecânica na BR-101",
            category="PROBLEMA_MECANICO",
            criticality="MEDIA",
            locationLabel="BR-101 km 220, sentido norte",
            truckPlate="CCC3C33",
        ),
        incident_factory(
            title="Neblina densa na BR-376",
            category="CONDICAO_CLIMATICA_ATIPICA",
            criticality="BAIXA",
            locationLabel="BR-376 km 640, sentido litoral",
            truckPlate="DDD4D44",
        ),
    ]


def test_lista_vazia_segue_o_contrato(client: TestClient) -> None:
    response = client.get(INCIDENTS_URL)
    assert response.status_code == 200
    assert response.json() == {
        "items": [],
        "pageInfo": {"nextCursor": None, "hasNextPage": False, "limit": 50},
        "meta": {
            "total": 0,
            "appliedFilters": {
                "status": [],
                "criticality": [],
                "category": [],
                "search": None,
                "sort": "priority_desc",
            },
        },
    }


def test_lista_traz_o_dto_completo(
    client: TestClient, incident_factory: Callable[..., dict[str, Any]]
) -> None:
    incident_factory()
    item = client.get(INCIDENTS_URL).json()["items"][0]
    assert set(item) == {
        "id",
        "code",
        "title",
        "description",
        "category",
        "criticality",
        "status",
        "latitude",
        "longitude",
        "locationLabel",
        "truckPlate",
        "driverName",
        "reportedBy",
        "assignedAnalyst",
        "resolutionNotes",
        "priorityScore",
        "slaDueAt",
        "version",
        "createdAt",
        "updatedAt",
        "closedAt",
    }


def test_filtro_por_criticidade(
    client: TestClient, incident_factory: Callable[..., dict[str, Any]]
) -> None:
    create_matrix(incident_factory)
    body = client.get(INCIDENTS_URL, params={"criticality": "ALTA"}).json()
    assert body["meta"]["total"] == 2
    assert {item["criticality"] for item in body["items"]} == {"ALTA"}
    assert body["meta"]["appliedFilters"]["criticality"] == ["ALTA"]


def test_filtro_multivalor_por_virgula(
    client: TestClient, incident_factory: Callable[..., dict[str, Any]]
) -> None:
    create_matrix(incident_factory)
    body = client.get(INCIDENTS_URL, params={"criticality": "ALTA,BAIXA"}).json()
    assert body["meta"]["total"] == 3
    assert {item["criticality"] for item in body["items"]} == {"ALTA", "BAIXA"}


def test_filtro_multivalor_repetido(
    client: TestClient, incident_factory: Callable[..., dict[str, Any]]
) -> None:
    create_matrix(incident_factory)
    response = client.get(INCIDENTS_URL, params=[("criticality", "ALTA"), ("criticality", "MEDIA")])
    body = response.json()
    assert body["meta"]["total"] == 3
    assert {item["criticality"] for item in body["items"]} == {"ALTA", "MEDIA"}


def test_filtro_por_categoria_e_combinacao(
    client: TestClient, incident_factory: Callable[..., dict[str, Any]]
) -> None:
    create_matrix(incident_factory)
    body = client.get(
        INCIDENTS_URL, params={"category": "ACIDENTE_COM_VITIMAS,BLOQUEIO_DE_PISTA"}
    ).json()
    assert body["meta"]["total"] == 2

    combinado = client.get(
        INCIDENTS_URL, params={"criticality": "ALTA", "category": "BLOQUEIO_DE_PISTA"}
    ).json()
    assert combinado["meta"]["total"] == 1
    assert combinado["items"][0]["category"] == "BLOQUEIO_DE_PISTA"


def test_filtro_por_status(
    client: TestClient, incident_factory: Callable[..., dict[str, Any]]
) -> None:
    created = incident_factory()
    client.post(
        f"{INCIDENTS_URL}/{created['id']}/status",
        json={"status": "EM_INVESTIGACAO"},
        headers={"If-Match": '"1"'},
    )
    incident_factory()

    apenas_abertos = client.get(INCIDENTS_URL, params={"status": "ABERTO"}).json()
    assert apenas_abertos["meta"]["total"] == 1
    em_investigacao = client.get(INCIDENTS_URL, params={"status": "EM_INVESTIGACAO"}).json()
    assert em_investigacao["meta"]["total"] == 1
    ambos = client.get(INCIDENTS_URL, params={"status": "ABERTO,EM_INVESTIGACAO"}).json()
    assert ambos["meta"]["total"] == 2


def test_busca_por_titulo_placa_codigo_e_local(
    client: TestClient, incident_factory: Callable[..., dict[str, Any]]
) -> None:
    created = incident_factory(title="Colisão com carreta na BR-040", truckPlate="ZZZ9Z99")

    por_titulo = client.get(INCIDENTS_URL, params={"search": "carreta"}).json()
    assert por_titulo["meta"]["total"] == 1

    por_placa = client.get(INCIDENTS_URL, params={"search": "zzz9z99"}).json()
    assert por_placa["meta"]["total"] == 1
    assert por_placa["items"][0]["truckPlate"] == "ZZZ9Z99"

    por_codigo = client.get(INCIDENTS_URL, params={"search": created["code"]}).json()
    assert por_codigo["meta"]["total"] == 1

    por_local = client.get(INCIDENTS_URL, params={"search": "BR-040"}).json()
    assert por_local["meta"]["total"] == 1
    assert por_local["meta"]["appliedFilters"]["search"] == "BR-040"


def test_busca_escapa_curingas_do_like(
    client: TestClient, incident_factory: Callable[..., dict[str, Any]]
) -> None:
    incident_factory(title="Falha mecânica na BR-116")
    vazio = client.get(INCIDENTS_URL, params={"search": "%"}).json()
    assert vazio["meta"]["total"] == 0
    assert client.get(INCIDENTS_URL, params={"search": "_"}).json()["meta"]["total"] == 0


def test_ordenacao_por_prioridade_e_o_padrao(
    client: TestClient, incident_factory: Callable[..., dict[str, Any]]
) -> None:
    create_matrix(incident_factory)
    body = client.get(INCIDENTS_URL).json()
    scores = [item["priorityScore"] for item in body["items"]]
    assert scores == sorted(scores, reverse=True)
    assert body["items"][0]["category"] == "ACIDENTE_COM_VITIMAS"


def test_ordenacao_por_criacao(
    client: TestClient, incident_factory: Callable[..., dict[str, Any]]
) -> None:
    create_matrix(incident_factory)
    desc = client.get(INCIDENTS_URL, params={"sort": "created_desc"}).json()["items"]
    asc = client.get(INCIDENTS_URL, params={"sort": "created_asc"}).json()["items"]
    assert [item["id"] for item in desc] == list(reversed([item["id"] for item in asc]))


def test_ordenacao_por_criticidade(
    client: TestClient, incident_factory: Callable[..., dict[str, Any]]
) -> None:
    create_matrix(incident_factory)
    body = client.get(INCIDENTS_URL, params={"sort": "criticality_desc"}).json()
    ordered = [item["criticality"] for item in body["items"]]
    assert ordered == ["ALTA", "ALTA", "MEDIA", "BAIXA"]
    assert body["meta"]["appliedFilters"]["sort"] == "criticality_desc"


def test_paginacao_por_cursor_percorre_todas_as_paginas(
    client: TestClient, incident_factory: Callable[..., dict[str, Any]]
) -> None:
    for index in range(7):
        incident_factory(title=f"Incidente numerado {index} na BR-116")

    seen: list[str] = []
    cursor: str | None = None
    pages = 0
    while True:
        params: dict[str, Any] = {"limit": 3}
        if cursor is not None:
            params["cursor"] = cursor
        body = client.get(INCIDENTS_URL, params=params).json()
        pages += 1
        seen.extend(item["id"] for item in body["items"])
        assert body["meta"]["total"] == 7
        if not body["pageInfo"]["hasNextPage"]:
            assert body["pageInfo"]["nextCursor"] is None
            break
        cursor = body["pageInfo"]["nextCursor"]
        assert cursor is not None

    assert pages == 3
    assert len(seen) == 7
    assert len(set(seen)) == 7


def test_paginacao_por_cursor_na_ordenacao_por_criacao(
    client: TestClient, incident_factory: Callable[..., dict[str, Any]]
) -> None:
    created = [incident_factory(title=f"Incidente {index} na BR-116") for index in range(5)]

    first = client.get(INCIDENTS_URL, params={"sort": "created_desc", "limit": 2}).json()
    cursor = first["pageInfo"]["nextCursor"]
    second = client.get(
        INCIDENTS_URL, params={"sort": "created_desc", "limit": 2, "cursor": cursor}
    ).json()

    first_ids = {item["id"] for item in first["items"]}
    second_ids = {item["id"] for item in second["items"]}
    assert first_ids.isdisjoint(second_ids)
    assert {item["id"] for item in created} >= first_ids | second_ids


def test_limite_de_itens_por_pagina(
    client: TestClient, incident_factory: Callable[..., dict[str, Any]]
) -> None:
    for index in range(5):
        incident_factory(title=f"Incidente {index} na BR-116")
    body = client.get(INCIDENTS_URL, params={"limit": 2}).json()
    assert len(body["items"]) == 2
    assert body["pageInfo"]["limit"] == 2
    assert body["pageInfo"]["hasNextPage"] is True
    assert body["pageInfo"]["nextCursor"] is not None


def test_filtro_invalido_devolve_422_no_envelope(client: TestClient) -> None:
    response = client.get(INCIDENTS_URL, params={"criticality": "URGENTE"})
    assert response.status_code == 422
    error = response.json()["error"]
    assert error["code"] == "INVALID_FILTER"
    assert error["details"]["parameter"] == "criticality"
    assert error["details"]["invalid"] == ["URGENTE"]
    assert error["details"]["allowed"] == ["ALTA", "MEDIA", "BAIXA"]


def test_cursor_invalido_devolve_400(client: TestClient) -> None:
    response = client.get(INCIDENTS_URL, params={"cursor": "nao-e-base64!!"})
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "INVALID_CURSOR"


def test_cursor_bem_formado_porem_estranho_devolve_400(client: TestClient) -> None:
    response = client.get(INCIDENTS_URL, params={"cursor": "eyJ6IjoiYWJjIn0"})
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "INVALID_CURSOR"


def test_limite_fora_da_faixa_devolve_422(client: TestClient) -> None:
    for limit in (0, -3, 101, "muitos"):
        response = client.get(INCIDENTS_URL, params={"limit": limit})
        assert response.status_code == 422
        assert response.json()["error"]["code"] == "VALIDATION_ERROR"


def test_ordenacao_desconhecida_devolve_422(client: TestClient) -> None:
    response = client.get(INCIDENTS_URL, params={"sort": "aleatorio"})
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "VALIDATION_ERROR"
