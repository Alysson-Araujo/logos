"""Máquina de estados do ciclo de vida do incidente (regras puras)."""

from __future__ import annotations

from typing import Final

from app.core.errors import InvalidStatusTransitionError, ResolutionNotesRequiredError
from app.domain.enums import IncidentStatus

#: Status considerados terminais — não aceitam nenhuma transição de saída.
TERMINAL_STATUSES: Final[frozenset[IncidentStatus]] = frozenset({IncidentStatus.FECHADO})

#: Grafo de transições permitidas, origem -> destinos possíveis.
ALLOWED_TRANSITIONS: Final[dict[IncidentStatus, frozenset[IncidentStatus]]] = {
    IncidentStatus.ABERTO: frozenset(
        {
            IncidentStatus.EM_INVESTIGACAO,
            IncidentStatus.INCONCLUSIVO,
            IncidentStatus.FECHADO,
        }
    ),
    IncidentStatus.EM_INVESTIGACAO: frozenset(
        {
            IncidentStatus.FECHADO,
            IncidentStatus.INCONCLUSIVO,
            IncidentStatus.ABERTO,
        }
    ),
    IncidentStatus.INCONCLUSIVO: frozenset(
        {
            IncidentStatus.EM_INVESTIGACAO,
            IncidentStatus.FECHADO,
        }
    ),
    IncidentStatus.FECHADO: frozenset(),
}

#: Status que exigem justificativa registrada ao serem assumidos.
RESOLUTION_REQUIRED_STATUSES: Final[frozenset[IncidentStatus]] = frozenset(
    {IncidentStatus.FECHADO, IncidentStatus.INCONCLUSIVO}
)

RESOLUTION_NOTES_MIN_LENGTH: Final[int] = 10


def allowed_transitions(current: IncidentStatus) -> list[IncidentStatus]:
    """Lista os destinos válidos a partir do status atual."""
    return sorted(ALLOWED_TRANSITIONS[current], key=lambda status: status.value)


def can_transition(current: IncidentStatus, target: IncidentStatus) -> bool:
    """Indica se a transição é permitida pela máquina de estados."""
    return target in ALLOWED_TRANSITIONS[current]


def predecessors_of(target: IncidentStatus) -> list[IncidentStatus]:
    """Lista os status de origem capazes de alcançar o status alvo.

    É a fonte única usada para restringir o compare-and-swap no banco.
    """
    return sorted(
        (source for source, targets in ALLOWED_TRANSITIONS.items() if target in targets),
        key=lambda status: status.value,
    )


def assert_transition_allowed(current: IncidentStatus, target: IncidentStatus) -> None:
    """Levanta erro de domínio quando a transição não é permitida."""
    if can_transition(current, target):
        return
    raise InvalidStatusTransitionError(
        f"Não é possível ir de {current.value} para {target.value}.",
        details={
            "from": current.value,
            "to": target.value,
            "allowed": [status.value for status in allowed_transitions(current)],
        },
    )


def is_terminal(status: IncidentStatus) -> bool:
    """Indica se o status encerra o ciclo de vida do incidente."""
    return status in TERMINAL_STATUSES


def requires_resolution_notes(target: IncidentStatus) -> bool:
    """Indica se o status alvo exige justificativa registrada."""
    return target in RESOLUTION_REQUIRED_STATUSES


def validate_resolution_notes(target: IncidentStatus, notes: str | None) -> None:
    """Valida a justificativa exigida por FECHADO e INCONCLUSIVO."""
    if not requires_resolution_notes(target):
        return
    normalized = (notes or "").strip()
    if len(normalized) >= RESOLUTION_NOTES_MIN_LENGTH:
        return
    raise ResolutionNotesRequiredError(
        f"{target.value} exige resolutionNotes com ao menos "
        f"{RESOLUTION_NOTES_MIN_LENGTH} caracteres.",
        details={
            "status": target.value,
            "minLength": RESOLUTION_NOTES_MIN_LENGTH,
            "received": len(normalized),
        },
    )
