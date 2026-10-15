"""Cálculo determinístico do priority score (regras puras e testáveis)."""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Final

from app.domain.enums import IncidentCategory, IncidentCriticality

#: Peso de impacto de cada categoria (seção 9.2 do plano).
CATEGORY_IMPACT: Final[dict[IncidentCategory, int]] = {
    IncidentCategory.ACIDENTE_COM_VITIMAS: 300,
    IncidentCategory.BLOQUEIO_DE_PISTA: 180,
    IncidentCategory.ACIDENTE_COM_VEICULO: 150,
    IncidentCategory.CONDICAO_CLIMATICA_ATIPICA: 100,
    IncidentCategory.PROBLEMA_MECANICO: 60,
}

#: Peso de urgência de cada criticidade.
CRITICALITY_URGENCY: Final[dict[IncidentCriticality, int]] = {
    IncidentCriticality.ALTA: 500,
    IncidentCriticality.MEDIA: 250,
    IncidentCriticality.BAIXA: 80,
}

#: Prazo de SLA derivado da criticidade.
SLA_HOURS_BY_CRITICALITY: Final[dict[IncidentCriticality, int]] = {
    IncidentCriticality.ALTA: 2,
    IncidentCriticality.MEDIA: 8,
    IncidentCriticality.BAIXA: 24,
}

#: Aging: 12 pontos por hora em aberto, com teto para não transformar tudo em ALTA.
AGING_POINTS_PER_HOUR: Final[int] = 12
AGING_MAX_POINTS: Final[int] = 400

#: Pressão de SLA: bônus quando falta menos de uma hora para o vencimento.
SLA_PRESSURE_WINDOW: Final[timedelta] = timedelta(hours=1)
SLA_PRESSURE_POINTS: Final[int] = 200


def compute_sla_due_at(criticality: IncidentCriticality, created_at: datetime) -> datetime:
    """Deriva o vencimento do SLA a partir da criticidade."""
    return created_at + timedelta(hours=SLA_HOURS_BY_CRITICALITY[criticality])


def aging_points(created_at: datetime, now: datetime) -> int:
    """Pontos de envelhecimento: 12 por hora, limitados a 400."""
    elapsed_hours = (now - created_at).total_seconds() / 3600.0
    if elapsed_hours <= 0:
        return 0
    return min(int(elapsed_hours * AGING_POINTS_PER_HOUR), AGING_MAX_POINTS)


def sla_pressure_points(sla_due_at: datetime, now: datetime) -> int:
    """Bônus aplicado quando o SLA vence em menos de uma hora (ou já venceu)."""
    if sla_due_at - now < SLA_PRESSURE_WINDOW:
        return SLA_PRESSURE_POINTS
    return 0


def compute_priority_score(
    *,
    category: IncidentCategory,
    criticality: IncidentCriticality,
    created_at: datetime,
    sla_due_at: datetime,
    now: datetime,
) -> int:
    """Calcula o score: impacto + urgência + aging + pressão de SLA."""
    return (
        CATEGORY_IMPACT[category]
        + CRITICALITY_URGENCY[criticality]
        + aging_points(created_at, now)
        + sla_pressure_points(sla_due_at, now)
    )
