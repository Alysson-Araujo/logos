"""Schemas do endpoint de metadados e catálogo visual dos enums."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Final

from app.domain.enums import IncidentCategory, IncidentCriticality, IncidentStatus
from app.domain.priority import (
    CATEGORY_IMPACT,
    CRITICALITY_URGENCY,
    SLA_HOURS_BY_CRITICALITY,
)
from app.domain.rules import allowed_transitions, is_terminal
from app.schemas.common import CamelModel


@dataclass(frozen=True, slots=True)
class OptionMetadata:
    """Rótulo PT-BR e metadados visuais de uma opção de enum."""

    label: str
    color: str
    color_dark: str
    icon: str
    description: str


CATEGORY_METADATA: Final[dict[IncidentCategory, OptionMetadata]] = {
    IncidentCategory.ACIDENTE_COM_VEICULO: OptionMetadata(
        label="Acidente com Veículo",
        color="#D97706",
        color_dark="#FBBF24",
        icon="▣",
        description="Colisão, abalroamento ou saída de pista envolvendo veículo.",
    ),
    IncidentCategory.ACIDENTE_COM_VITIMAS: OptionMetadata(
        label="Acidente com Vítimas",
        color="#DC2626",
        color_dark="#F87171",
        icon="✚",
        description="Acidente com feridos ou óbitos — acionamento imediato.",
    ),
    IncidentCategory.CONDICAO_CLIMATICA_ATIPICA: OptionMetadata(
        label="Condição Climática Atípica na Pista",
        color="#2563EB",
        color_dark="#60A5FA",
        icon="☂",
        description="Neblina, chuva forte, granizo ou pista escorregadia.",
    ),
    IncidentCategory.PROBLEMA_MECANICO: OptionMetadata(
        label="Problema Mecânico",
        color="#64748B",
        color_dark="#94A3B8",
        icon="⚙",
        description="Falha do veículo que interrompe ou degrada a viagem.",
    ),
    IncidentCategory.BLOQUEIO_DE_PISTA: OptionMetadata(
        label="Bloqueio de Pista",
        color="#EA580C",
        color_dark="#FB923C",
        icon="▬",
        description="Pista total ou parcialmente interditada.",
    ),
}

CRITICALITY_METADATA: Final[dict[IncidentCriticality, OptionMetadata]] = {
    IncidentCriticality.ALTA: OptionMetadata(
        label="Alta",
        color="#DC2626",
        color_dark="#F87171",
        icon="▲",
        description="Risco iminente à vida ou à operação.",
    ),
    IncidentCriticality.MEDIA: OptionMetadata(
        label="Média",
        color="#D97706",
        color_dark="#FBBF24",
        icon="◆",
        description="Impacto operacional relevante, sem risco iminente.",
    ),
    IncidentCriticality.BAIXA: OptionMetadata(
        label="Baixa",
        color="#2563EB",
        color_dark="#60A5FA",
        icon="●",
        description="Acompanhamento de rotina, sem urgência.",
    ),
}

CRITICALITY_SHAPE: Final[dict[IncidentCriticality, str]] = {
    IncidentCriticality.ALTA: "triangle",
    IncidentCriticality.MEDIA: "diamond",
    IncidentCriticality.BAIXA: "circle",
}

STATUS_METADATA: Final[dict[IncidentStatus, OptionMetadata]] = {
    IncidentStatus.ABERTO: OptionMetadata(
        label="Aberto",
        color="#D97706",
        color_dark="#FBBF24",
        icon="●",
        description="Aguardando triagem ou primeiro atendimento.",
    ),
    IncidentStatus.EM_INVESTIGACAO: OptionMetadata(
        label="Em Investigação",
        color="#2563EB",
        color_dark="#60A5FA",
        icon="◐",
        description="Caso assumido por um analista.",
    ),
    IncidentStatus.FECHADO: OptionMetadata(
        label="Fechado",
        color="#16A34A",
        color_dark="#4ADE80",
        icon="✓",
        description="Encerrado com laudo registrado. Estado terminal.",
    ),
    IncidentStatus.INCONCLUSIVO: OptionMetadata(
        label="Inconclusivo",
        color="#6B7280",
        color_dark="#9CA3AF",
        icon="?",
        description="Encerrado sem causa determinada, com justificativa.",
    ),
}


class EnumOption(CamelModel):
    """Opção de enum com rótulo PT-BR e metadados de cor/ícone."""

    value: str
    label: str
    color: str
    color_dark: str
    icon: str
    description: str


class CategoryOption(EnumOption):
    """Categoria com o peso de impacto usado no priority score."""

    impact: int


class CriticalityOption(EnumOption):
    """Criticidade com forma, urgência e prazo de SLA."""

    shape: str
    urgency: int
    sla_hours: int


class StatusOption(EnumOption):
    """Status com terminalidade e transições permitidas."""

    terminal: bool
    allowed_transitions: list[str]


class EnumsResponse(CamelModel):
    """Catálogo completo de enums do domínio."""

    categories: list[CategoryOption]
    criticalities: list[CriticalityOption]
    statuses: list[StatusOption]


def build_enums_response() -> EnumsResponse:
    """Monta o catálogo de enums a partir das fontes únicas do domínio."""
    categories = [
        CategoryOption(
            value=category.value,
            label=metadata.label,
            color=metadata.color,
            color_dark=metadata.color_dark,
            icon=metadata.icon,
            description=metadata.description,
            impact=CATEGORY_IMPACT[category],
        )
        for category, metadata in CATEGORY_METADATA.items()
    ]
    criticalities = [
        CriticalityOption(
            value=criticality.value,
            label=metadata.label,
            color=metadata.color,
            color_dark=metadata.color_dark,
            icon=metadata.icon,
            description=metadata.description,
            shape=CRITICALITY_SHAPE[criticality],
            urgency=CRITICALITY_URGENCY[criticality],
            sla_hours=SLA_HOURS_BY_CRITICALITY[criticality],
        )
        for criticality, metadata in CRITICALITY_METADATA.items()
    ]
    statuses = [
        StatusOption(
            value=status.value,
            label=metadata.label,
            color=metadata.color,
            color_dark=metadata.color_dark,
            icon=metadata.icon,
            description=metadata.description,
            terminal=is_terminal(status),
            allowed_transitions=[item.value for item in allowed_transitions(status)],
        )
        for status, metadata in STATUS_METADATA.items()
    ]
    return EnumsResponse(categories=categories, criticalities=criticalities, statuses=statuses)
