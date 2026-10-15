"""Enums de domínio do Logos — contrato fechado consumido por toda a API."""

from __future__ import annotations

from enum import StrEnum


class IncidentCategory(StrEnum):
    """Categorias de incidente aceitas pela central."""

    ACIDENTE_COM_VEICULO = "ACIDENTE_COM_VEICULO"
    ACIDENTE_COM_VITIMAS = "ACIDENTE_COM_VITIMAS"
    CONDICAO_CLIMATICA_ATIPICA = "CONDICAO_CLIMATICA_ATIPICA"
    PROBLEMA_MECANICO = "PROBLEMA_MECANICO"
    BLOQUEIO_DE_PISTA = "BLOQUEIO_DE_PISTA"


class IncidentCriticality(StrEnum):
    """Níveis de criticidade usados na priorização."""

    ALTA = "ALTA"
    MEDIA = "MEDIA"
    BAIXA = "BAIXA"


class IncidentStatus(StrEnum):
    """Status do ciclo de vida de um incidente."""

    ABERTO = "ABERTO"
    EM_INVESTIGACAO = "EM_INVESTIGACAO"
    FECHADO = "FECHADO"
    INCONCLUSIVO = "INCONCLUSIVO"


class SortOption(StrEnum):
    """Ordenações aceitas na listagem de incidentes."""

    PRIORITY_DESC = "priority_desc"
    CREATED_DESC = "created_desc"
    CREATED_ASC = "created_asc"
    CRITICALITY_DESC = "criticality_desc"
