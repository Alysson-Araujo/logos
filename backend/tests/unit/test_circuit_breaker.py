"""A máquina de estados do disjuntor, com o relógio injetado.

Nenhum teste espera de verdade: o tempo é uma função que o teste controla, então
até o cooldown é verificado sem custo.
"""

from __future__ import annotations

from app.core.circuit_breaker import CircuitBreaker, CircuitBreakerConfig, CircuitState


class Relogio:
    """Relógio controlado pelo teste."""

    def __init__(self) -> None:
        self.agora = 0.0

    def __call__(self) -> float:
        return self.agora

    def avanca(self, segundos: float) -> None:
        self.agora += segundos


def disjuntor(*, limiar: int = 3, cooldown: float = 30.0) -> tuple[CircuitBreaker, Relogio]:
    """Cria o disjuntor com um relógio que o teste move."""
    relogio = Relogio()
    breaker = CircuitBreaker(
        config=CircuitBreakerConfig(failure_threshold=limiar, cooldown_seconds=cooldown),
        clock=relogio,
    )
    return breaker, relogio


# --------------------------------------------------------------------------- #
# Fechado
# --------------------------------------------------------------------------- #
def test_comeca_fechado_e_deixa_passar() -> None:
    breaker, _ = disjuntor()
    assert breaker.state() is CircuitState.CLOSED
    assert breaker.check() is None


def test_abre_no_limiar_e_nao_antes() -> None:
    breaker, _ = disjuntor(limiar=3)
    for _ in range(2):
        breaker.record_failure()
    assert breaker.state() is CircuitState.CLOSED

    breaker.record_failure()

    assert breaker.state() is CircuitState.OPEN
    assert breaker.check() is not None


def test_sucesso_zera_a_contagem() -> None:
    """As falhas precisam ser consecutivas: uma intercalada não acumula."""
    breaker, _ = disjuntor(limiar=3)
    breaker.record_failure()
    breaker.record_failure()
    breaker.record_success()
    breaker.record_failure()
    breaker.record_failure()

    assert breaker.state() is CircuitState.CLOSED
    assert breaker.failures == 2


# --------------------------------------------------------------------------- #
# Aberto
# --------------------------------------------------------------------------- #
def test_aberto_recusa_e_informa_quanto_falta() -> None:
    breaker, relogio = disjuntor(limiar=1, cooldown=30.0)
    breaker.record_failure()
    relogio.avanca(10.0)

    # Faltam 20 s dos 30 do cooldown; é esse número que vira Retry-After.
    assert breaker.check() == 20


def test_retry_after_nunca_e_zero() -> None:
    """`Retry-After: 0` faria o cliente repetir na hora, o oposto do objetivo."""
    breaker, _ = disjuntor(limiar=1, cooldown=0.4)
    breaker.record_failure()

    assert breaker.check() == 1


def test_estado_meio_aberto_aparece_sem_ninguem_consultar() -> None:
    """Observabilidade: o estado não pode depender de alguém perguntar antes."""
    breaker, relogio = disjuntor(limiar=1, cooldown=10.0)
    breaker.record_failure()
    relogio.avanca(10.0)

    assert breaker.state() is CircuitState.HALF_OPEN


# --------------------------------------------------------------------------- #
# Meio-aberto
# --------------------------------------------------------------------------- #
def test_apos_o_cooldown_libera_uma_unica_sondagem() -> None:
    breaker, relogio = disjuntor(limiar=1, cooldown=10.0)
    breaker.record_failure()
    relogio.avanca(10.0)

    assert breaker.check() is None  # esta requisição é a sondagem
    assert breaker.check() is not None  # as demais continuam recusadas


def test_sondagem_bem_sucedida_fecha_o_circuito() -> None:
    breaker, relogio = disjuntor(limiar=1, cooldown=10.0)
    breaker.record_failure()
    relogio.avanca(10.0)
    breaker.check()

    breaker.record_success()

    assert breaker.state() is CircuitState.CLOSED
    assert breaker.check() is None


def test_sondagem_que_falha_reabre_sem_esperar_o_limiar() -> None:
    """O banco já provou que não voltou; contar de novo só atrasaria a proteção."""
    breaker, relogio = disjuntor(limiar=3, cooldown=10.0)
    for _ in range(3):
        breaker.record_failure()
    relogio.avanca(10.0)
    breaker.check()

    breaker.record_failure()

    assert breaker.state() is CircuitState.OPEN
    # E o cooldown foi reiniciado a partir de agora.
    assert breaker.check() == 10


# --------------------------------------------------------------------------- #
# Desligado
# --------------------------------------------------------------------------- #
def test_desligado_deixa_passar_e_nao_conta() -> None:
    breaker = CircuitBreaker(config=CircuitBreakerConfig(enabled=False))

    for _ in range(50):
        breaker.record_failure()

    assert breaker.state() is CircuitState.CLOSED
    assert breaker.check() is None
