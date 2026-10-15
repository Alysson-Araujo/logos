"""Testes da máquina de estados do ciclo de vida."""

from __future__ import annotations

from itertools import product

import pytest

from app.core.errors import InvalidStatusTransitionError, ResolutionNotesRequiredError
from app.domain.enums import IncidentStatus
from app.domain.rules import (
    ALLOWED_TRANSITIONS,
    RESOLUTION_NOTES_MIN_LENGTH,
    allowed_transitions,
    assert_transition_allowed,
    can_transition,
    is_terminal,
    predecessors_of,
    requires_resolution_notes,
    validate_resolution_notes,
)

ALL_STATUSES = list(IncidentStatus)
VALID_PAIRS = [
    (source, target)
    for source, targets in ALLOWED_TRANSITIONS.items()
    for target in sorted(targets, key=lambda status: status.value)
]
INVALID_PAIRS = [
    (source, target)
    for source, target in product(ALL_STATUSES, ALL_STATUSES)
    if target not in ALLOWED_TRANSITIONS[source]
]


def test_grafo_tem_exatamente_oito_transicoes_validas() -> None:
    # ABERTO -> 3, EM_INVESTIGACAO -> 3, INCONCLUSIVO -> 2, FECHADO -> 0.
    assert len(VALID_PAIRS) == 8


@pytest.mark.parametrize(("current", "target"), VALID_PAIRS)
def test_transicoes_validas_sao_permitidas(current: IncidentStatus, target: IncidentStatus) -> None:
    assert can_transition(current, target)
    assert target in allowed_transitions(current)
    assert_transition_allowed(current, target)


@pytest.mark.parametrize(("current", "target"), INVALID_PAIRS)
def test_transicoes_invalidas_sao_rejeitadas(
    current: IncidentStatus, target: IncidentStatus
) -> None:
    assert not can_transition(current, target)

    with pytest.raises(InvalidStatusTransitionError) as excinfo:
        assert_transition_allowed(current, target)

    error = excinfo.value
    assert error.code == "INVALID_STATUS_TRANSITION"
    assert error.status_code == 422
    assert error.details is not None
    assert error.details["from"] == current.value
    assert error.details["to"] == target.value
    assert error.details["allowed"] == [status.value for status in allowed_transitions(current)]


def test_fechado_e_terminal_e_nao_permite_saida() -> None:
    assert is_terminal(IncidentStatus.FECHADO)
    assert allowed_transitions(IncidentStatus.FECHADO) == []
    for target in ALL_STATUSES:
        assert not can_transition(IncidentStatus.FECHADO, target)


def test_status_nao_terminais() -> None:
    nao_terminais = (
        IncidentStatus.ABERTO,
        IncidentStatus.EM_INVESTIGACAO,
        IncidentStatus.INCONCLUSIVO,
    )
    for status in nao_terminais:
        assert not is_terminal(status)
        assert allowed_transitions(status)


def test_predecessores_derivam_do_mesmo_grafo() -> None:
    assert predecessors_of(IncidentStatus.EM_INVESTIGACAO) == [
        IncidentStatus.ABERTO,
        IncidentStatus.INCONCLUSIVO,
    ]
    assert predecessors_of(IncidentStatus.ABERTO) == [IncidentStatus.EM_INVESTIGACAO]
    assert predecessors_of(IncidentStatus.FECHADO) == [
        IncidentStatus.ABERTO,
        IncidentStatus.EM_INVESTIGACAO,
        IncidentStatus.INCONCLUSIVO,
    ]
    assert predecessors_of(IncidentStatus.INCONCLUSIVO) == [
        IncidentStatus.ABERTO,
        IncidentStatus.EM_INVESTIGACAO,
    ]
    for source, targets in ALLOWED_TRANSITIONS.items():
        for target in targets:
            assert source in predecessors_of(target)


def test_validacao_de_transicao_permite_origem_igual_ao_alvo_invalido() -> None:
    with pytest.raises(InvalidStatusTransitionError):
        assert_transition_allowed(IncidentStatus.ABERTO, IncidentStatus.ABERTO)


@pytest.mark.parametrize("status", [IncidentStatus.FECHADO, IncidentStatus.INCONCLUSIVO])
def test_status_de_encerramento_exigem_justificativa(status: IncidentStatus) -> None:
    assert requires_resolution_notes(status)
    with pytest.raises(ResolutionNotesRequiredError) as excinfo:
        validate_resolution_notes(status, None)
    assert excinfo.value.code == "RESOLUTION_NOTES_REQUIRED"
    assert excinfo.value.status_code == 422

    with pytest.raises(ResolutionNotesRequiredError):
        validate_resolution_notes(status, "curto")


@pytest.mark.parametrize("status", [IncidentStatus.ABERTO, IncidentStatus.EM_INVESTIGACAO])
def test_status_de_operacao_nao_exigem_justificativa(status: IncidentStatus) -> None:
    assert not requires_resolution_notes(status)
    validate_resolution_notes(status, None)


def test_justificativa_valida_e_aceita() -> None:
    notes = "x" * RESOLUTION_NOTES_MIN_LENGTH
    validate_resolution_notes(IncidentStatus.FECHADO, notes)
    validate_resolution_notes(IncidentStatus.INCONCLUSIVO, "  caso encerrado sem laudo  ")
