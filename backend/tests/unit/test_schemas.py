"""Testes dos validadores Pydantic dos schemas de incidente."""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from app.schemas.incident import IncidentCreate, IncidentStatusChange


def valid_payload(**overrides: object) -> dict[str, object]:
    payload: dict[str, object] = {
        "title": "Bloqueio de pista na BR-116",
        "description": "Faixa da esquerda interditada por queda de carga.",
        "category": "BLOQUEIO_DE_PISTA",
        "criticality": "ALTA",
        "latitude": -23.55,
        "longitude": -46.63,
        "locationLabel": "BR-116 km 412, sentido São Paulo",
        "truckPlate": "qrd-1a23",
        "driverName": "João Batista Ferreira",
        "reportedBy": "Rádio Frota 12",
    }
    payload.update(overrides)
    return payload


def test_payload_valido_e_normalizado() -> None:
    incident = IncidentCreate.model_validate(valid_payload())
    assert incident.title == "Bloqueio de pista na BR-116"
    assert incident.truck_plate == "QRD1A23"
    assert incident.category.value == "BLOQUEIO_DE_PISTA"
    assert incident.latitude == pytest.approx(-23.55)


def test_payload_aceita_snake_case_e_camel_case() -> None:
    camel = IncidentCreate.model_validate(valid_payload())
    snake = IncidentCreate.model_validate(
        {
            "title": camel.title,
            "category": camel.category,
            "criticality": camel.criticality,
            "location_label": camel.location_label,
            "truck_plate": camel.truck_plate,
            "reported_by": camel.reported_by,
        }
    )
    assert snake.location_label == camel.location_label
    assert snake.truck_plate == "QRD1A23"


def test_placa_antiga_tambem_e_aceita() -> None:
    incident = IncidentCreate.model_validate(valid_payload(truckPlate="abc1234"))
    assert incident.truck_plate == "ABC1234"


def test_placa_vazia_vira_nulo() -> None:
    incident = IncidentCreate.model_validate(valid_payload(truckPlate="   "))
    assert incident.truck_plate is None


@pytest.mark.parametrize("plate", ["ABC12", "ABC12345", "A1C1234", "ABCD123", "ABC-123-XY"])
def test_placa_invalida_e_rejeitada(plate: str) -> None:
    with pytest.raises(ValidationError):
        IncidentCreate.model_validate(valid_payload(truckPlate=plate))


@pytest.mark.parametrize("title", ["ab", "", "a" * 121])
def test_titulo_fora_do_tamanho_e_rejeitado(title: str) -> None:
    with pytest.raises(ValidationError):
        IncidentCreate.model_validate(valid_payload(title=title))


@pytest.mark.parametrize("title", ["<b>Colisão</b>", "Incidente <script>alert(1)</script>"])
def test_titulo_com_html_e_rejeitado(title: str) -> None:
    with pytest.raises(ValidationError):
        IncidentCreate.model_validate(valid_payload(title=title))


def test_titulo_e_descricao_sao_aparados() -> None:
    incident = IncidentCreate.model_validate(
        valid_payload(title="   Faixa interditada na BR-116   ", description="  detalhe  ")
    )
    assert incident.title == "Faixa interditada na BR-116"
    assert incident.description == "detalhe"


def test_descricao_muito_longa_e_rejeitada() -> None:
    with pytest.raises(ValidationError):
        IncidentCreate.model_validate(valid_payload(description="x" * 2001))


def test_descricao_limite_e_aceita() -> None:
    incident = IncidentCreate.model_validate(valid_payload(description="x" * 2000))
    assert incident.description is not None
    assert len(incident.description) == 2000


@pytest.mark.parametrize(("field", "value"), [("latitude", 90.1), ("latitude", -90.1)])
def test_latitude_fora_da_faixa_e_rejeitada(field: str, value: float) -> None:
    with pytest.raises(ValidationError):
        IncidentCreate.model_validate(valid_payload(**{field: value}))


@pytest.mark.parametrize(("field", "value"), [("longitude", 180.1), ("longitude", -180.1)])
def test_longitude_fora_da_faixa_e_rejeitada(field: str, value: float) -> None:
    with pytest.raises(ValidationError):
        IncidentCreate.model_validate(valid_payload(**{field: value}))


def test_limites_de_coordenadas_sao_inclusivos() -> None:
    incident = IncidentCreate.model_validate(valid_payload(latitude=90, longitude=-180))
    assert incident.latitude == 90
    assert incident.longitude == -180


@pytest.mark.parametrize("reported_by", ["A", "", "x" * 81])
def test_reported_by_fora_do_tamanho_e_rejeitado(reported_by: str) -> None:
    with pytest.raises(ValidationError):
        IncidentCreate.model_validate(valid_payload(reportedBy=reported_by))


def test_categoria_e_criticidade_invalidas_sao_rejeitadas() -> None:
    with pytest.raises(ValidationError):
        IncidentCreate.model_validate(valid_payload(category="ROUBO_DE_CARGA"))
    with pytest.raises(ValidationError):
        IncidentCreate.model_validate(valid_payload(criticality="URGENTE"))


def test_criacao_exige_campos_obrigatorios() -> None:
    with pytest.raises(ValidationError) as excinfo:
        IncidentCreate.model_validate({"title": "Sem os demais campos"})
    missing = {str(error["loc"][0]) for error in excinfo.value.errors()}
    assert {"category", "criticality"} <= missing
    assert missing & {"reported_by", "reportedBy"}


def test_tipos_inesperados_nao_quebram_a_validacao() -> None:
    with pytest.raises(ValidationError):
        IncidentCreate.model_validate(valid_payload(title=123))
    with pytest.raises(ValidationError):
        IncidentCreate.model_validate(valid_payload(latitude="norte"))
    with pytest.raises(ValidationError):
        IncidentCreate.model_validate(valid_payload(category=["BLOQUEIO_DE_PISTA"]))


def test_transicao_valida_de_status() -> None:
    change = IncidentStatusChange.model_validate(
        {"status": "EM_INVESTIGACAO", "expectedVersion": 3, "assignedAnalyst": "Ana Paula"}
    )
    assert change.status.value == "EM_INVESTIGACAO"
    assert change.expected_version == 3
    assert change.assigned_analyst == "Ana Paula"


def test_transicao_rejeita_versao_invalida() -> None:
    with pytest.raises(ValidationError):
        IncidentStatusChange.model_validate({"status": "ABERTO", "expectedVersion": 0})


def test_justificativa_muito_longa_e_rejeitada() -> None:
    with pytest.raises(ValidationError):
        IncidentStatusChange.model_validate({"status": "FECHADO", "resolutionNotes": "x" * 1001})


def test_justificativa_no_limite_e_aceita() -> None:
    change = IncidentStatusChange.model_validate(
        {"status": "FECHADO", "resolutionNotes": "x" * 1000}
    )
    assert change.resolution_notes is not None
    assert len(change.resolution_notes) == 1000
