"""Disjuntor para falhas transitórias de banco (padrão *circuit breaker*).

**O problema.** Quando o banco fica lento, cada requisição espera o timeout
inteiro antes de falhar. Com o pool ocupado por requisições condenadas, o serviço
inteiro trava — inclusive rotas que nem dependem do banco. É a falha em cascata:
o banco degradado derruba a API, e a API sobrecarregada impede o banco de se
recuperar. E a retentativa do #27, sem interruptor, trabalha contra: três
tentativas por requisição multiplicam a carga justamente quando o banco está
pior.

**A solução.** Depois de N falhas transitórias consecutivas, o disjuntor abre e
as requisições seguintes falham **na hora**, com `503` e `Retry-After`, sem tocar
no banco. O pool esvazia e o banco ganha espaço para voltar. Passado o cooldown,
o disjuntor entra em `HALF_OPEN` e deixa passar **uma** requisição de sondagem:
se ela funcionar, o circuito fecha; se falhar, reabre com o cooldown reiniciado.

Uma sonda de cada vez é o ponto central. Liberar tráfego em massa para um banco
que ainda não voltou o derrubaria de novo — que é exatamente o que o disjuntor
existe para evitar.

**O que conta como falha.** A unidade de trabalho inteira, e não cada tentativa
interna: cinco requisições que falharam, e não as quinze tentativas de cinco
requisições. Assim o limiar não muda de significado quando alguém ajusta a
política de retentativa.

**O que NÃO conta como falha.** Erro de negócio e violação de constraint provam
que o banco respondeu. Um `404` que chega rápido é sinal de saúde, não de
doença — então esses casos zeram o contador em vez de alimentá-lo.

**Limite honesto.** O estado vive na memória do processo. Com N workers há N
disjuntores, e cada um abre por conta própria: o banco precisa de N vezes mais
falhas para que todos abram. É uma limitação aceitável — guardar o estado em
Redis adicionaria uma dependência que cai junto com o banco, e o disjuntor existe
justamente para o momento em que as coisas caem.
"""

from __future__ import annotations

import math
import threading
import time
from collections.abc import Callable
from dataclasses import dataclass
from enum import StrEnum
from functools import lru_cache

from app.core.config import get_settings


class CircuitState(StrEnum):
    """Os três estados do disjuntor."""

    #: Tudo normal: as requisições passam.
    CLOSED = "closed"
    #: Falhando rápido, sem tocar no banco.
    OPEN = "open"
    #: Cooldown vencido: uma sondagem autorizada.
    HALF_OPEN = "half_open"


@dataclass(frozen=True, slots=True)
class CircuitBreakerConfig:
    """Quando abrir, quanto esperar e se o disjuntor está ligado."""

    failure_threshold: int = 5
    cooldown_seconds: float = 30.0
    enabled: bool = True


class CircuitBreaker:
    """Máquina de estados do disjuntor, segura para uso entre threads.

    O estado é compartilhado pelos endpoints, que rodam em threads do pool —
    por isso todo acesso passa pelo mesmo lock.
    """

    def __init__(
        self,
        *,
        config: CircuitBreakerConfig | None = None,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        """Recebe a configuração e a fonte de tempo (injetável nos testes)."""
        self._config = config or CircuitBreakerConfig()
        self._clock = clock
        self._lock = threading.Lock()
        self._state = CircuitState.CLOSED
        self._opened_at = 0.0
        self._failures = 0
        self._probe_in_flight = False

    @property
    def config(self) -> CircuitBreakerConfig:
        """Configuração em uso."""
        return self._config

    @property
    def failures(self) -> int:
        """Falhas consecutivas contadas desde o último sucesso."""
        with self._lock:
            return self._failures

    def state(self) -> CircuitState:
        """Estado observável do circuito, já considerando o cooldown vencido."""
        with self._lock:
            if self._state is CircuitState.OPEN and self._cooldown_over():
                return CircuitState.HALF_OPEN
            return self._state

    def check(self) -> int | None:
        """Autoriza a requisição, ou diz quantos segundos esperar.

        Devolve `None` quando pode seguir. Quando devolve um número, o chamador
        deve recusar com `503` e aquele `Retry-After` — o valor vem junto, e não
        de uma segunda consulta, para não haver janela em que o estado mude entre
        decidir e responder.
        """
        if not self._config.enabled:
            return None

        with self._lock:
            if self._state is CircuitState.CLOSED:
                return None

            if self._state is CircuitState.OPEN:
                if not self._cooldown_over():
                    return self._seconds_remaining()
                # Cooldown vencido: esta requisição vira a sondagem.
                self._state = CircuitState.HALF_OPEN
                self._probe_in_flight = True
                return None

            # HALF_OPEN: uma sondagem de cada vez. As demais continuam recusando,
            # porque liberar tráfego em massa derrubaria o banco de novo.
            if self._probe_in_flight:
                return self._seconds_remaining()
            self._probe_in_flight = True
            return None

    def record_success(self) -> None:
        """A operação chegou ao banco e voltou: fecha o circuito."""
        if not self._config.enabled:
            return
        with self._lock:
            self._state = CircuitState.CLOSED
            self._failures = 0
            self._probe_in_flight = False

    def record_failure(self) -> None:
        """A operação falhou por motivo de infraestrutura."""
        if not self._config.enabled:
            return
        with self._lock:
            # Sonda que falhou reabre na hora, sem esperar o limiar de novo: o
            # banco já provou que não voltou.
            if self._state is CircuitState.HALF_OPEN:
                self._trip()
                return

            self._probe_in_flight = False
            if self._state is CircuitState.OPEN:
                # Já está aberto; novas falhas não mudam a decisão.
                return

            self._failures += 1
            if self._failures >= self._config.failure_threshold:
                self._trip()

    def _trip(self) -> None:
        """Abre o circuito e reinicia a contagem do cooldown."""
        self._state = CircuitState.OPEN
        self._opened_at = self._clock()
        self._failures = 0
        self._probe_in_flight = False

    def _cooldown_over(self) -> bool:
        """Indica se já se passou tempo suficiente para sondar."""
        return self._clock() - self._opened_at >= self._config.cooldown_seconds

    def _seconds_remaining(self) -> int:
        """Segundos até a próxima sondagem, nunca zero.

        `Retry-After: 0` faria o cliente repetir imediatamente — o oposto do que
        o disjuntor quer.
        """
        restante = self._config.cooldown_seconds - (self._clock() - self._opened_at)
        return max(1, math.ceil(restante))


@lru_cache(maxsize=1)
def get_circuit_breaker() -> CircuitBreaker:
    """Cria, uma única vez, o disjuntor do processo, a partir da configuração."""
    settings = get_settings()
    return CircuitBreaker(
        config=CircuitBreakerConfig(
            failure_threshold=settings.circuit_breaker_failure_threshold,
            cooldown_seconds=settings.circuit_breaker_cooldown_seconds,
            enabled=settings.circuit_breaker_enabled,
        )
    )


def reset_circuit_breaker() -> None:
    """Descarta o disjuntor; usado em teste e ao recarregar a configuração."""
    get_circuit_breaker.cache_clear()
