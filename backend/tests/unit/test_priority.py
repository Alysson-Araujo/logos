"""Testes do priority score (fórmula da seção 9.2 do plano)."""

from __future__ import annotations

from datetime import datetime, timedelta

import pytest

from app.domain.enums import IncidentCategory, IncidentCriticality
from app.domain.priority import (
    AGING_MAX_POINTS,
    CATEGORY_IMPACT,
    CRITICALITY_URGENCY,
    SLA_HOURS_BY_CRITICALITY,
    SLA_PRESSURE_POINTS,
    aging_points,
    compute_priority_score,
    compute_sla_due_at,
    sla_pressure_points,
)

NOW = datetime(2026, 2, 11, 12, 0, 0)


def score(
    category: IncidentCategory,
    criticality: IncidentCriticality,
    *,
    age_hours: float = 0.0,
    sla_in_hours: float = 10.0,
) -> int:
    created_at = NOW - timedelta(hours=age_hours)
    sla_due_at = NOW + timedelta(hours=sla_in_hours)
    return compute_priority_score(
        category=category,
        criticality=criticality,
        created_at=created_at,
        sla_due_at=sla_due_at,
        now=NOW,
    )


def test_pesos_de_impacto_por_categoria() -> None:
    assert CATEGORY_IMPACT[IncidentCategory.ACIDENTE_COM_VITIMAS] == 300
    assert CATEGORY_IMPACT[IncidentCategory.BLOQUEIO_DE_PISTA] == 180
    assert CATEGORY_IMPACT[IncidentCategory.ACIDENTE_COM_VEICULO] == 150
    assert CATEGORY_IMPACT[IncidentCategory.CONDICAO_CLIMATICA_ATIPICA] == 100
    assert CATEGORY_IMPACT[IncidentCategory.PROBLEMA_MECANICO] == 60


def test_pesos_de_urgencia_por_criticidade() -> None:
    assert CRITICALITY_URGENCY[IncidentCriticality.ALTA] == 500
    assert CRITICALITY_URGENCY[IncidentCriticality.MEDIA] == 250
    assert CRITICALITY_URGENCY[IncidentCriticality.BAIXA] == 80


def test_acidente_com_vitimas_alta_ordena_antes_de_problema_mecanico_baixa() -> None:
    victims_score = score(IncidentCategory.ACIDENTE_COM_VITIMAS, IncidentCriticality.ALTA)
    mechanical_score = score(IncidentCategory.PROBLEMA_MECANICO, IncidentCriticality.BAIXA)
    assert victims_score == 300 + 500
    assert mechanical_score == 60 + 80
    assert victims_score > mechanical_score


def test_aging_cresce_doze_pontos_por_hora_com_teto_de_quatrocentos() -> None:
    assert aging_points(NOW - timedelta(hours=1), NOW) == 12
    assert aging_points(NOW - timedelta(hours=4), NOW) == 48
    assert aging_points(NOW - timedelta(hours=50), NOW) == AGING_MAX_POINTS
    assert aging_points(NOW + timedelta(hours=1), NOW) == 0


def test_aging_entra_no_score() -> None:
    recente = score(IncidentCategory.PROBLEMA_MECANICO, IncidentCriticality.BAIXA, age_hours=0)
    antigo = score(IncidentCategory.PROBLEMA_MECANICO, IncidentCriticality.BAIXA, age_hours=4)
    assert antigo - recente == 48


@pytest.mark.parametrize(
    ("sla_in_hours", "expected"),
    [
        (2.0, 0),
        (1.0, 0),
        (0.9, SLA_PRESSURE_POINTS),
        (0.0, SLA_PRESSURE_POINTS),
        (-3.0, SLA_PRESSURE_POINTS),
    ],
)
def test_pressao_de_sla_entra_na_ultima_hora(sla_in_hours: float, expected: int) -> None:
    assert sla_pressure_points(NOW + timedelta(hours=sla_in_hours), NOW) == expected


def test_pressao_de_sla_soma_no_score() -> None:
    folgado = score(IncidentCategory.BLOQUEIO_DE_PISTA, IncidentCriticality.ALTA, sla_in_hours=5)
    apertado = score(IncidentCategory.BLOQUEIO_DE_PISTA, IncidentCriticality.ALTA, sla_in_hours=0.5)
    assert apertado - folgado == SLA_PRESSURE_POINTS


def test_sla_derivado_da_criticidade() -> None:
    assert SLA_HOURS_BY_CRITICALITY == {
        IncidentCriticality.ALTA: 2,
        IncidentCriticality.MEDIA: 8,
        IncidentCriticality.BAIXA: 24,
    }
    assert compute_sla_due_at(IncidentCriticality.ALTA, NOW) == NOW + timedelta(hours=2)
    assert compute_sla_due_at(IncidentCriticality.MEDIA, NOW) == NOW + timedelta(hours=8)
    assert compute_sla_due_at(IncidentCriticality.BAIXA, NOW) == NOW + timedelta(hours=24)


def test_score_maximo_respeita_as_parcelas() -> None:
    created_at = NOW - timedelta(hours=80)
    result = compute_priority_score(
        category=IncidentCategory.ACIDENTE_COM_VITIMAS,
        criticality=IncidentCriticality.ALTA,
        created_at=created_at,
        sla_due_at=NOW - timedelta(minutes=30),
        now=NOW,
    )
    assert result == 300 + 500 + AGING_MAX_POINTS + SLA_PRESSURE_POINTS
    assert result == 1400
