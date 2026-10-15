"""Seed idempotente com incidentes realistas em pt-BR para demonstração."""

from __future__ import annotations

import logging
import random
from dataclasses import dataclass
from datetime import datetime, timedelta
from enum import StrEnum
from typing import Final
from uuid import uuid4

from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.database import create_session, get_engine
from app.core.logging import configure_logging
from app.domain.enums import IncidentCategory, IncidentCriticality, IncidentStatus
from app.domain.priority import compute_priority_score, compute_sla_due_at
from app.models import Base
from app.models.base import utcnow
from app.models.incident import INITIAL_VERSION, Incident
from app.repositories.incident_repository import IncidentRepository, build_code

logger = logging.getLogger(__name__)

SEED_COUNT: Final[int] = 120
SEED_RANDOM_STATE = 20260211
HISTORY_WINDOW_HOURS = 72

#: Distribuição alvo: ~15% ALTA, ~35% MEDIA, ~50% BAIXA.
CRITICALITY_QUOTA: Final[tuple[tuple[IncidentCriticality, int], ...]] = (
    (IncidentCriticality.ALTA, 18),
    (IncidentCriticality.MEDIA, 42),
    (IncidentCriticality.BAIXA, 60),
)

#: Distribuição de status da amostra.
STATUS_QUOTA: Final[tuple[tuple[IncidentStatus, int], ...]] = (
    (IncidentStatus.ABERTO, 48),
    (IncidentStatus.EM_INVESTIGACAO, 30),
    (IncidentStatus.FECHADO, 30),
    (IncidentStatus.INCONCLUSIVO, 12),
)

CATEGORY_QUOTA: Final[tuple[IncidentCategory, ...]] = (
    IncidentCategory.ACIDENTE_COM_VEICULO,
    IncidentCategory.ACIDENTE_COM_VITIMAS,
    IncidentCategory.CONDICAO_CLIMATICA_ATIPICA,
    IncidentCategory.PROBLEMA_MECANICO,
    IncidentCategory.BLOQUEIO_DE_PISTA,
)


@dataclass(frozen=True, slots=True)
class Highway:
    """Rodovia usada como origem geográfica dos incidentes fictícios."""

    name: str
    latitude: float
    longitude: float
    directions: tuple[str, ...]


HIGHWAYS: tuple[Highway, ...] = (
    Highway(
        "BR-116",
        -23.5505,
        -46.6333,
        ("São Paulo", "Curitiba", "Rio de Janeiro", "interior"),
    ),
    Highway("BR-101", -27.5949, -48.5482, ("Florianópolis", "Santos", "Curitiba", "norte")),
    Highway("SP-330", -22.3500, -47.5500, ("interior", "capital", "Ribeirão Preto")),
    Highway("BR-376", -23.4200, -51.9300, ("Curitiba", "Maringá", "litoral")),
    Highway("BR-040", -22.1000, -43.2000, ("Rio de Janeiro", "Juiz de Fora", "Brasília")),
    Highway("BR-153", -22.9000, -49.0000, ("interior", "Goiás", "Paraná")),
)

DRIVER_NAMES: tuple[str, ...] = (
    "João Batista Ferreira",
    "Maria Aparecida Souza",
    "Carlos Eduardo Lima",
    "Ana Paula Ribeiro",
    "Pedro Henrique Alves",
    "José Antônio Moreira",
    "Fernanda Cristina Dias",
    "Rafael Nogueira Pinto",
    "Juliana Prado Martins",
    "Bruno Tavares Rocha",
    "Marcos Vinícius Barbosa",
    "Patrícia Gomes Andrade",
    "Luiz Fernando Cardoso",
    "Camila Rodrigues Teixeira",
    "Sérgio Ricardo Melo",
    "Débora Ferreira Lopes",
    "Antônio Carlos Pires",
    "Vanessa Almeida Cruz",
    "Rogério Santana Braga",
    "Simone Batista Freitas",
)

REPORTERS: tuple[str, ...] = (
    "Rádio Frota 12",
    "Central 0800",
    "App Motorista",
    "Torre de Controle",
    "Painel do Veículo",
    "Concessionária Autoban",
    "Polícia Rodoviária Federal",
)

ANALYSTS: tuple[str, ...] = (
    "Ana Paula Ribeiro",
    "Carlos Eduardo Lima",
    "Marina Souza",
    "Rafael Nogueira",
    "Juliana Prado",
    "Bruno Tavares",
)

TITLE_BY_CATEGORY: dict[IncidentCategory, str] = {
    IncidentCategory.ACIDENTE_COM_VEICULO: "Colisão com veículo na pista",
    IncidentCategory.ACIDENTE_COM_VITIMAS: "Acidente com vítimas",
    IncidentCategory.CONDICAO_CLIMATICA_ATIPICA: "Condição climática atípica na pista",
    IncidentCategory.PROBLEMA_MECANICO: "Falha mecânica do veículo",
    IncidentCategory.BLOQUEIO_DE_PISTA: "Bloqueio de pista",
}

DESCRIPTION_BY_CATEGORY: dict[IncidentCategory, str] = {
    IncidentCategory.ACIDENTE_COM_VEICULO: (
        "Colisão entre carreta e veículo de passeio. Veículo permanece na faixa da direita "
        "com sinalização provisória e fluxo reduzido no trecho."
    ),
    IncidentCategory.ACIDENTE_COM_VITIMAS: (
        "Acidente com feridos atendidos no local pelo SAMU. Concessionária acionada para "
        "conter vazamento de combustível e liberar a pista."
    ),
    IncidentCategory.CONDICAO_CLIMATICA_ATIPICA: (
        "Neblina densa e pista molhada reduzem a visibilidade. Motoristas orientados por "
        "painel de mensagens variáveis a reduzir a velocidade."
    ),
    IncidentCategory.PROBLEMA_MECANICO: (
        "Caminhão com falha no sistema de freios. Equipe de manutenção deslocada para "
        "atendimento e possível transbordo de carga."
    ),
    IncidentCategory.BLOQUEIO_DE_PISTA: (
        "Pista interditada por queda de carga na faixa da esquerda. Equipe de sinalização "
        "no local e desvio indicado pelo acostamento."
    ),
}

RESOLUTION_BY_STATUS: dict[IncidentStatus, str] = {
    IncidentStatus.FECHADO: (
        "Caso encerrado após atendimento da concessionária e liberação total da pista, "
        "sem necessidade de nova intervenção."
    ),
    IncidentStatus.INCONCLUSIVO: (
        "Encerrado sem causa determinada: câmeras do trecho indisponíveis e sem registro "
        "de boletim de ocorrência no período."
    ),
}


def _expand_quota[EnumT: StrEnum](quota: tuple[tuple[EnumT, int], ...]) -> list[EnumT]:
    """Expande a cota em uma lista com os valores repetidos."""
    values: list[EnumT] = []
    for value, amount in quota:
        values.extend([value] * amount)
    return values


def _build_incidents(rng: random.Random, *, now: datetime) -> list[Incident]:
    """Monta a lista de incidentes do seed de forma determinística."""
    criticalities = _expand_quota(CRITICALITY_QUOTA)
    statuses = _expand_quota(STATUS_QUOTA)
    rng.shuffle(criticalities)
    rng.shuffle(statuses)

    incidents: list[Incident] = []
    for index in range(1, SEED_COUNT + 1):
        highway = rng.choice(HIGHWAYS)
        direction = rng.choice(highway.directions)
        km = rng.randint(1, 620)
        category = CATEGORY_QUOTA[(index - 1) % len(CATEGORY_QUOTA)]
        criticality = criticalities[index - 1]
        status = statuses[index - 1]

        created_at = now - timedelta(minutes=rng.randint(0, HISTORY_WINDOW_HOURS * 60))
        elapsed = rng.randint(20, 240)
        updated_at = min(created_at + timedelta(minutes=elapsed), now)
        sla_due_at = compute_sla_due_at(criticality, created_at)
        closed_at = (
            updated_at if status in (IncidentStatus.FECHADO, IncidentStatus.INCONCLUSIVO) else None
        )
        location_label = f"{highway.name} km {km}, sentido {direction}"
        has_position = rng.random() > 0.15

        incident = Incident(
            id=uuid4(),
            code=build_code(created_at, index),
            title=f"{TITLE_BY_CATEGORY[category]} - {location_label}"[:120],
            description=DESCRIPTION_BY_CATEGORY[category],
            category=category,
            criticality=criticality,
            status=status,
            latitude=round(highway.latitude + rng.uniform(-1.5, 1.5), 5) if has_position else None,
            longitude=(
                round(highway.longitude + rng.uniform(-1.5, 1.5), 5) if has_position else None
            ),
            location_label=location_label,
            truck_plate=(
                f"{rng.choice('ABCDEFGHIJKLMNOPQRSTUVWXYZ')}"
                f"{rng.choice('ABCDEFGHIJKLMNOPQRSTUVWXYZ')}"
                f"{rng.choice('ABCDEFGHIJKLMNOPQRSTUVWXYZ')}"
                f"{rng.randint(0, 9)}"
                f"{rng.choice('ABCDEFGHIJKLMNOPQRSTUVWXYZ')}"
                f"{rng.randint(0, 9)}{rng.randint(0, 9)}"
            ),
            driver_name=rng.choice(DRIVER_NAMES),
            reported_by=rng.choice(REPORTERS),
            assigned_analyst=(
                rng.choice(ANALYSTS) if status is not IncidentStatus.ABERTO else None
            ),
            resolution_notes=RESOLUTION_BY_STATUS.get(status),
            priority_score=compute_priority_score(
                category=category,
                criticality=criticality,
                created_at=created_at,
                sla_due_at=sla_due_at,
                now=now,
            ),
            sla_due_at=sla_due_at,
            version=rng.randint(INITIAL_VERSION, 4),
            created_at=created_at,
            updated_at=updated_at,
            closed_at=closed_at,
            deleted_at=None,
        )
        incidents.append(incident)
    return incidents


def seed_incidents(session: Session, *, count: int = SEED_COUNT) -> int:
    """Cria os incidentes de demonstração apenas em base vazia (idempotente)."""
    repository = IncidentRepository(session)
    if repository.count() > 0:
        return 0

    rng = random.Random(SEED_RANDOM_STATE)
    now = utcnow()
    incidents = _build_incidents(rng, now=now)[:count]
    session.add_all(incidents)
    session.commit()
    return len(incidents)


def main() -> None:
    """Executa o seed manualmente (`python -m app.infra.seed`)."""
    configure_logging(get_settings().log_level)
    Base.metadata.create_all(bind=get_engine())
    with create_session() as session:
        created = seed_incidents(session)
    logger.info("seed finalizado: %s incidentes criados", created)


if __name__ == "__main__":
    main()
