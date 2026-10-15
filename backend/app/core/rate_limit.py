"""Limitação de taxa por cliente, com janela deslizante.

**O problema.** Sem teto, um cliente em laço — integração mal configurada, retry
sem backoff — ocupa a API inteira. Numa central de resposta a incidentes isso é
grave: o sistema fica indisponível justamente durante a ocorrência que ele
existe para tratar.

**Por que janela deslizante e não janela fixa.** Com janela fixa, o cliente pode
gastar o teto nos últimos segundos de uma janela e de novo nos primeiros da
seguinte, passando o dobro do limite em um instante curto. A janela deslizante
conta os últimos N segundos a cada requisição, então o teto vale a qualquer
momento — e o `Retry-After` sai exato, e não "até o fim da janela".

**Por que leitura e escrita têm tetos diferentes.** A tela de triagem lista a
cada trinta segundos e o analista abre detalhes o tempo todo; a mutação, por
outro lado, é deliberada e mais cara. Um teto único ou sobra para uma ou falta
para a outra.

**Limite honesto desta implementação.** O histórico vive na memória do processo.
Isso é exato com uma instância e passa a valer *por worker* quando houver
vários, o que na prática multiplica o teto pelo número de workers. Trocar por um
store compartilhado (Redis) é substituir a classe que guarda o histórico: o
middleware e o contrato com o cliente não mudam.
"""

from __future__ import annotations

import math
import time
from collections import deque
from functools import lru_cache
from threading import Lock
from typing import Final

from fastapi import Request, Response
from fastapi.responses import JSONResponse
from starlette.middleware.base import RequestResponseEndpoint

from app.core.config import get_settings
from app.core.errors import RateLimitExceededError, build_error_payload, resolve_request_id
from app.core.security import client_ip

WINDOW_SECONDS: Final[float] = 60.0
#: De quanto em quanto tempo o histórico de chaves inativas é descartado.
PRUNE_INTERVAL_SECONDS: Final[float] = 60.0
#: Métodos contados no teto de leitura.
READ_METHODS: Final[frozenset[str]] = frozenset({"GET", "HEAD"})
#: Rotas isentas. O healthcheck da plataforma não pode consumir cota: recusá-lo
#: faz o provedor marcar o serviço como doente e reiniciar o deploy.
EXEMPT_PREFIXES: Final[tuple[str, ...]] = ("/api/v1/health",)


class SlidingWindowLimiter:
    """Conta requisições por chave em uma janela deslizante de tempo."""

    def __init__(self, *, limit: int, window_seconds: float = WINDOW_SECONDS) -> None:
        """Configura o teto e o tamanho da janela."""
        self._limit = limit
        self._window = window_seconds
        self._history: dict[str, deque[float]] = {}
        self._lock = Lock()
        self._last_prune = 0.0

    @property
    def limit(self) -> int:
        """Teto de requisições por janela."""
        return self._limit

    def check(self, key: str, *, now: float | None = None) -> float | None:
        """Registra uma requisição da chave informada.

        Devolve `None` quando ela cabe no teto, ou os segundos que faltam para a
        requisição mais antiga sair da janela — que é exatamente o `Retry-After`
        a informar ao cliente.
        """
        instante = time.monotonic() if now is None else now
        with self._lock:
            self._prune_if_due(instante)
            marks = self._history.setdefault(key, deque())
            floor = instante - self._window
            while marks and marks[0] <= floor:
                marks.popleft()
            if len(marks) >= self._limit:
                return round(self._window - (instante - marks[0]), 3)
            marks.append(instante)
            return None

    def _prune_if_due(self, instante: float) -> None:
        """Descarta as chaves cuja última requisição já saiu da janela.

        É o que impede o histórico de crescer sem limite com clientes que
        apareceram uma vez só. Roda dentro do lock, no máximo uma vez por
        intervalo — nunca a cada requisição.
        """
        if instante - self._last_prune < PRUNE_INTERVAL_SECONDS:
            return
        self._last_prune = instante
        floor = instante - self._window
        for key in [k for k, marks in self._history.items() if not marks or marks[-1] <= floor]:
            del self._history[key]

    def tracked_keys(self) -> int:
        """Quantas chaves estão no histórico (diagnóstico e teste)."""
        with self._lock:
            return len(self._history)


@lru_cache(maxsize=1)
def get_rate_limiters() -> tuple[SlidingWindowLimiter, SlidingWindowLimiter]:
    """Cria, uma única vez, os limitadores de leitura e de escrita."""
    settings = get_settings()
    return (
        SlidingWindowLimiter(limit=settings.rate_limit_read_per_minute),
        SlidingWindowLimiter(limit=settings.rate_limit_write_per_minute),
    )


def reset_rate_limiters() -> None:
    """Descarta os limitadores; usado em teste e ao recarregar a configuração."""
    get_rate_limiters.cache_clear()


def is_exempt(path: str, method: str) -> bool:
    """Indica se a requisição não deve ser contada.

    Preflight de CORS não é trabalho da API, e health não pode ser recusado.
    """
    if method == "OPTIONS":
        return True
    return path.startswith(EXEMPT_PREFIXES)


async def rate_limit_middleware(request: Request, call_next: RequestResponseEndpoint) -> Response:
    """Recusa com 429 quando o cliente passa do teto daquele tipo de operação.

    A resposta é montada aqui, e não levantando exceção, porque middleware fica
    fora do `ExceptionMiddleware` do Starlette: uma exceção levantada neste ponto
    viraria 500 em vez de passar pelos handlers globais.
    """
    settings = get_settings()
    if not settings.rate_limit_enabled or is_exempt(request.url.path, request.method):
        return await call_next(request)

    read_limiter, write_limiter = get_rate_limiters()
    limiter = read_limiter if request.method in READ_METHODS else write_limiter
    wait = limiter.check(client_ip(request))
    if wait is None:
        return await call_next(request)

    return JSONResponse(
        status_code=RateLimitExceededError.status_code,
        content=build_error_payload(
            RateLimitExceededError.code,
            RateLimitExceededError.default_message,
            details={"retryAfterSeconds": wait, "limitPerMinute": limiter.limit},
            request_id=resolve_request_id(request),
        ),
        headers={"Retry-After": str(max(1, math.ceil(wait)))},
    )
