"""Cache da listagem com TTL curto e revalidação adiada.

**O problema.** Durante uma degradação do banco, a tela de triagem esvazia: o
analista perde a lista justamente quando precisa dela. Só que, para triagem, um
dado de trinta segundos atrás é **utilizável** — o que não é utilizável é a tela
de erro.

**A solução.** A listagem fica em cache por um TTL curto, com o estado exposto no
cabeçalho `X-Cache-Status`:

- `MISS`: não havia cópia, a resposta veio do banco;
- `HIT`: cópia dentro do TTL, resposta imediata;
- `REVALIDATED`: cópia vencida e banco respondendo — busca, atualiza e responde
  com o dado novo;
- `STALE`: cópia vencida e banco indisponível — serve a cópia, marcada.

**Onde entra o "em segundo plano".** A revalidação não roda em thread própria:
ela é **adiada para a próxima requisição**. Quando o banco está fora, a resposta
sai na hora com a cópia antiga, e quem revalida é a primeira requisição que
encontrar o banco de volta. O efeito para quem usa é o mesmo — a tela nunca
espera por uma revalidação que provavelmente vai falhar —, sem o custo de
gerenciar threads, filas e erros que ninguém observa. É a mesma escolha do
disjuntor: não gastar recurso com trabalho condenado.

**Por que a chave é o pedido inteiro.** Filtros, ordenação e cursor entram na
chave. Servir a página de um filtro para outro entregaria dado errado com
aparência de certo — o pior tipo de erro de cache, porque não parece erro.

**Limite honesto.** O cache vive na memória do processo, como o limitador de taxa
e o disjuntor. Com N workers há N caches, então cada worker aquece o seu e a taxa
de acerto cai. Trocar por Redis é substituir o dicionário; a política de estados
não muda.
"""

from __future__ import annotations

import json
import time
from collections.abc import Callable
from dataclasses import asdict, dataclass, is_dataclass
from enum import StrEnum
from functools import lru_cache
from threading import Lock
from typing import Final

from app.core.config import get_settings

#: Cabeçalho que expõe o estado do cache, para o comportamento ser observável em
#: desenvolvimento, nos logs e na interface (que mostra o aviso de instabilidade).
CACHE_STATUS_HEADER: Final[str] = "X-Cache-Status"


class CacheStatus(StrEnum):
    """Estados possíveis de uma resposta da listagem."""

    #: Não havia cópia guardada; a resposta veio do banco.
    MISS = "MISS"
    #: Cópia dentro do TTL.
    HIT = "HIT"
    #: Cópia vencida e banco respondeu: dado novo.
    REVALIDATED = "REVALIDATED"
    #: Cópia vencida e banco indisponível: a cópia foi servida, marcada.
    STALE = "STALE"


@dataclass(frozen=True, slots=True)
class CacheEntry:
    """Cópia guardada de uma resposta, com o instante em que foi obtida.

    O valor é `object` porque o cache não conhece o schema da resposta — quem
    guarda e quem lê é que sabem o tipo, e a conversão acontece lá.
    """

    value: object
    stored_at: float


class ListingCache:
    """Guarda a última resposta de cada combinação de filtros.

    Seguro para uso entre threads: os endpoints rodam em threads do pool e
    compartilham a mesma instância.
    """

    def __init__(
        self,
        *,
        ttl_seconds: float = 30.0,
        max_entries: int = 256,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        """Configura o TTL, o teto de entradas e a fonte de tempo (injetável)."""
        self._ttl = ttl_seconds
        self._max_entries = max_entries
        self._clock = clock
        self._entries: dict[str, CacheEntry] = {}
        self._lock = Lock()

    @property
    def ttl_seconds(self) -> float:
        """TTL configurado."""
        return self._ttl

    def get(self, key: str) -> CacheEntry | None:
        """Devolve a cópia guardada, vencida ou não, ou `None` se não houver."""
        with self._lock:
            return self._entries.get(key)

    def is_fresh(self, entry: CacheEntry) -> bool:
        """Indica se a cópia ainda está dentro do TTL."""
        return self._clock() - entry.stored_at < self._ttl

    def put(self, key: str, value: object) -> CacheEntry:
        """Guarda a resposta e devolve a entrada criada."""
        entry = CacheEntry(value=value, stored_at=self._clock())
        with self._lock:
            self._entries[key] = entry
            self._evict_locked()
        return entry

    def clear(self) -> None:
        """Esvazia o cache (usado em teste e em mutação que invalida a listagem)."""
        with self._lock:
            self._entries.clear()

    def _evict_locked(self) -> None:
        """Descarta as cópias mais antigas quando o cache passa do teto.

        Sem teto, um cliente que varia filtros sem parar encheria a memória do
        processo — o cache viraria o vazamento.
        """
        excesso = len(self._entries) - self._max_entries
        if excesso <= 0:
            return
        mais_antigas = sorted(self._entries.items(), key=lambda item: item[1].stored_at)[:excesso]
        for key, _ in mais_antigas:
            del self._entries[key]

    def __len__(self) -> int:
        """Quantas cópias estão guardadas (diagnóstico e teste)."""
        with self._lock:
            return len(self._entries)


def cache_key(filters: object) -> str:
    """Monta a chave estável a partir do pedido inteiro.

    O JSON com chaves ordenadas é o que evita duas entradas para o mesmo pedido
    quando os campos chegam em ordem diferente.
    """
    base = asdict(filters) if is_dataclass(filters) and not isinstance(filters, type) else filters
    return json.dumps(base, sort_keys=True, default=str)


@lru_cache(maxsize=1)
def get_listing_cache() -> ListingCache:
    """Cria, uma única vez, o cache do processo, a partir da configuração."""
    return ListingCache(ttl_seconds=get_settings().cache_ttl_seconds)


def reset_listing_cache() -> None:
    """Descarta o cache; usado em teste e ao recarregar a configuração."""
    get_listing_cache.cache_clear()
