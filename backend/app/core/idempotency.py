"""Idempotência das mutações: reserva atômica da chave e reenvio da resposta.

**O problema.** A rede oscila, o cliente não sabe se a requisição chegou e
reenvia. Sem proteção, o reenvio cria um segundo incidente — numa central de
operação isso é uma ocorrência fantasma na fila, com placa e local repetidos, e
alguém vai ligar para o mesmo motorista duas vezes.

**A solução.** O cliente envia uma `Idempotency-Key` estável por operação
lógica. O servidor reserva a chave **antes** de executar e guarda a resposta
**depois**:

| Situação | Resposta |
| --- | --- |
| Chave nova | executa a mutação e guarda a resposta |
| Mesma chave, mesmo corpo | devolve a resposta original, sem reexecutar |
| Mesma chave, corpo diferente | `409 IDEMPOTENCY_KEY_REUSED` |
| Mesma chave ainda em execução | `409 IDEMPOTENCY_KEY_IN_PROGRESS` |

A terceira linha é a que costuma faltar: reusar a chave para outra operação é
erro de programação do cliente, e responder o resultado antigo esconderia o bug.

**Por que a reserva é uma linha no banco.** A chave é a chave primária da
tabela, então a restrição de unicidade — e não um `if` em Python — garante que
só uma requisição execute. Isso vale com múltiplos workers e múltiplas réplicas,
exatamente como o compare-and-swap do lock otimista.
"""

from __future__ import annotations

import hashlib
import re
from collections.abc import Callable, Coroutine
from contextvars import ContextVar
from typing import Any, Final

from fastapi import Request, Response
from fastapi.routing import APIRoute

from app.core.database import create_session
from app.core.errors import (
    IdempotencyKeyInProgressError,
    IdempotencyKeyReusedError,
    InvalidIdempotencyKeyError,
)
from app.models.idempotency_key import STATUS_COMPLETED
from app.repositories.idempotency_repository import IdempotencyRepository

IDEMPOTENCY_HEADER: Final[str] = "Idempotency-Key"
#: Sinaliza no reenvio que a resposta veio do registro, e não de nova execução.
REPLAYED_HEADER: Final[str] = "Idempotency-Replayed"

MAX_KEY_LENGTH: Final[int] = 120
#: A chave é opaca; recusamos apenas o que o banco não comporta ou o que
#: quebraria o cabeçalho: vazio, com espaço ou acima do limite da coluna.
KEY_PATTERN: Final[re.Pattern[str]] = re.compile(rf"^\S{{1,{MAX_KEY_LENGTH}}}$")

#: Só métodos que mudam estado passam pela idempotência. Uma leitura não paga custo.
MUTATING_METHODS: Final[frozenset[str]] = frozenset({"POST", "PUT", "PATCH", "DELETE"})

#: Cabeçalhos devolvidos no reenvio, para a resposta ficar fiel à original.
#: `Location` e `ETag` fazem parte do contrato: sem eles, um reenvio de criação
#: deixaria o cliente sem saber onde o recurso está nem em que versão ele ficou.
REPLAYED_HEADERS: Final[tuple[str, ...]] = ("ETag", "Location")

#: Marcador de que a requisição atual pode ser repetida com segurança, porque o
#: cliente enviou `Idempotency-Key`.
#:
#: Vive em um `ContextVar` porque quem lê o cabeçalho é o middleware — contexto
#: assíncrono da requisição — e quem decide a retentativa é o serviço, que roda
#: em thread do pool nos endpoints síncronos. O `anyio` copia o contexto para a
#: thread, então o marcador atravessa sem que o serviço precise conhecer HTTP.
_REPLAY_SAFE: ContextVar[bool] = ContextVar("logos_replay_safe", default=False)


def mark_replay_safe() -> None:
    """Marca a requisição atual como segura de repetir."""
    _REPLAY_SAFE.set(True)


def is_replay_safe() -> bool:
    """Indica se a operação atual pode ser repetida automaticamente."""
    return _REPLAY_SAFE.get()


def build_fingerprint(method: str, path: str, body: bytes) -> str:
    """Identifica a operação lógica: método, caminho e corpo."""
    digest = hashlib.sha256()
    digest.update(method.upper().encode("utf-8"))
    digest.update(b"\x00")
    digest.update(path.encode("utf-8"))
    digest.update(b"\x00")
    digest.update(body)
    return digest.hexdigest()


def validate_key(raw: str) -> str:
    """Normaliza e valida a chave recebida no cabeçalho."""
    key = raw.strip()
    if not KEY_PATTERN.match(key):
        raise InvalidIdempotencyKeyError(
            "Idempotency-Key deve ter de 1 a 120 caracteres, sem espaços "
            "(recomendado: um UUID v4).",
            details={"received": raw[:64], "maxLength": MAX_KEY_LENGTH},
        )
    return key


class IdempotentRoute(APIRoute):
    """Rota que torna a mutação segura para reenvio.

    Só age quando o cliente envia o cabeçalho e o método muda estado, então
    nenhuma requisição existente passa a pagar custo por causa desta classe.
    """

    def get_route_handler(self) -> Callable[[Request], Coroutine[Any, Any, Response]]:
        """Envolve o handler original com a reserva e o registro da resposta."""
        original = super().get_route_handler()

        async def handler(request: Request) -> Response:
            raw_key = request.headers.get(IDEMPOTENCY_HEADER)
            if raw_key is None or request.method.upper() not in MUTATING_METHODS:
                return await original(request)

            key = validate_key(raw_key)
            # A partir daqui a operação é reenviável: o cliente declarou isso ao
            # enviar a chave, e é essa declaração que autoriza a retentativa
            # interna de uma escrita (ver app/infra/retry.py).
            mark_replay_safe()
            # O corpo é lido aqui e continua disponível para o handler original:
            # o Starlette guarda o resultado em cache.
            fingerprint = build_fingerprint(request.method, request.url.path, await request.body())

            with create_session() as session:
                repository = IdempotencyRepository(session)
                repository.purge_expired()

                replay = _replay_or_none(repository, key, fingerprint)
                if replay is not None:
                    return replay

                if not repository.reserve(key, fingerprint):
                    # Outra requisição reservou entre a leitura e a inserção.
                    replay = _replay_or_none(repository, key, fingerprint)
                    if replay is not None:
                        return replay
                    raise IdempotencyKeyInProgressError()

                try:
                    response = await original(request)
                except BaseException:
                    # Erros de domínio e de validação sobem como exceção e viram
                    # 4xx/5xx pelos handlers globais, então `_record` não roda.
                    # Como nenhuma resposta foi produzida, a chave precisa voltar
                    # a ficar livre — do contrário o cliente que corrigiu o
                    # pedido esbarraria na própria reserva até ela expirar.
                    repository.release(key)
                    raise
                _record(repository, key, response)
                return response

        return handler


def _replay_or_none(
    repository: IdempotencyRepository, key: str, fingerprint: str
) -> Response | None:
    """Devolve a resposta guardada, ou `None` quando a chave ainda é nova."""
    registro = repository.get(key)
    if registro is None:
        return None

    if registro.request_hash != fingerprint:
        raise IdempotencyKeyReusedError(
            "Esta Idempotency-Key já foi usada nesta operação com um corpo "
            "diferente. Use uma chave nova para uma operação nova.",
            details={"key": key},
        )

    if registro.status != STATUS_COMPLETED or registro.response_status is None:
        raise IdempotencyKeyInProgressError()

    headers: dict[str, Any] = dict(registro.response_headers or {})
    headers[REPLAYED_HEADER] = "true"
    body = registro.response_body
    return Response(
        content=body,
        status_code=registro.response_status,
        media_type="application/json" if body else None,
        headers=headers,
    )


def _record(repository: IdempotencyRepository, key: str, response: Response) -> None:
    """Guarda a resposta quando ela é reaproveitável.

    Só respostas de sucesso são guardadas. Um `5xx` precisa poder ser tentado de
    novo, e um `4xx` é determinístico: repetir devolve o mesmo resultado sem
    custo, e liberar a chave permite ao cliente corrigir o pedido usando a mesma
    chave.
    """
    if not 200 <= response.status_code < 300:
        repository.release(key)
        return

    raw = getattr(response, "body", None)
    body: str | None = None
    if raw:
        body = raw.decode("utf-8") if isinstance(raw, bytes) else str(raw)

    headers = {
        nome: response.headers[nome] for nome in REPLAYED_HEADERS if nome in response.headers
    }
    repository.complete(
        key,
        status_code=response.status_code,
        body=body,
        headers=headers or None,
    )
