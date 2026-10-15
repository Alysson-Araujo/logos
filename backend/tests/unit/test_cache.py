"""Cache da listagem: frescor, teto de entradas e chave.

Testado sem HTTP e sem banco: o TTL é verificado com o relógio injetado, então
nenhum teste dorme.
"""

from __future__ import annotations

from dataclasses import dataclass

from app.core.cache import ListingCache, cache_key


class Relogio:
    """Relógio controlado pelo teste."""

    def __init__(self) -> None:
        self.agora = 0.0

    def __call__(self) -> float:
        return self.agora

    def avanca(self, segundos: float) -> None:
        self.agora += segundos


@dataclass(frozen=True)
class Filtros:
    """Filtros de exemplo, no formato do pedido real."""

    status: str | None = None
    limit: int = 50


@dataclass(frozen=True)
class FiltrosOrdemTrocada:
    """Os mesmos campos, declarados em outra ordem."""

    limit: int = 50
    status: str | None = None


def cache(*, ttl: float = 30.0, max_entries: int = 256) -> tuple[ListingCache, Relogio]:
    """Cria o cache com um relógio que o teste move."""
    relogio = Relogio()
    return ListingCache(ttl_seconds=ttl, max_entries=max_entries, clock=relogio), relogio


# --------------------------------------------------------------------------- #
# Guardar e ler
# --------------------------------------------------------------------------- #
def test_guarda_e_devolve_o_valor() -> None:
    guardado, _ = cache()
    assert guardado.get("chave") is None

    guardado.put("chave", {"items": [1, 2]})

    entrada = guardado.get("chave")
    assert entrada is not None
    assert entrada.value == {"items": [1, 2]}


def test_chaves_distintas_nao_se_misturam() -> None:
    """Servir a página de um filtro para outro é o pior erro de cache."""
    guardado, _ = cache()
    guardado.put("sem-filtro", ["tudo"])
    guardado.put("filtrado", ["so-um"])

    assert guardado.get("sem-filtro").value == ["tudo"]  # type: ignore[union-attr]
    assert guardado.get("filtrado").value == ["so-um"]  # type: ignore[union-attr]


def test_clear_esvazia() -> None:
    guardado, _ = cache()
    guardado.put("chave", 1)

    guardado.clear()

    assert len(guardado) == 0
    assert guardado.get("chave") is None


# --------------------------------------------------------------------------- #
# TTL
# --------------------------------------------------------------------------- #
def test_fresco_dentro_do_ttl_e_vencido_depois() -> None:
    guardado, relogio = cache(ttl=30.0)
    entrada = guardado.put("chave", "valor")

    assert guardado.is_fresh(entrada)

    relogio.avanca(29.9)
    assert guardado.is_fresh(entrada)

    relogio.avanca(0.2)
    assert not guardado.is_fresh(entrada)


def test_ttl_zero_nunca_esta_fresco() -> None:
    """TTL zero é o modo "sempre revalidar", usado para observar a revalidação."""
    guardado, _ = cache(ttl=0.0)

    assert not guardado.is_fresh(guardado.put("chave", "valor"))


# --------------------------------------------------------------------------- #
# Teto de entradas
# --------------------------------------------------------------------------- #
def test_descarta_as_mais_antigas_acima_do_teto() -> None:
    """Sem teto, um cliente variando filtros encheria a memória do processo."""
    guardado, relogio = cache(max_entries=3)

    for indice in range(4):
        guardado.put(f"chave-{indice}", indice)
        relogio.avanca(1.0)

    assert len(guardado) == 3
    assert guardado.get("chave-0") is None  # a mais antiga saiu
    assert guardado.get("chave-3") is not None


# --------------------------------------------------------------------------- #
# Chave
# --------------------------------------------------------------------------- #
def test_chave_e_estavel_e_distingue_pedidos() -> None:
    assert cache_key(Filtros()) == cache_key(Filtros())
    assert cache_key(Filtros()) != cache_key(Filtros(limit=10))
    assert cache_key(Filtros()) != cache_key(Filtros(status="ABERTO"))


def test_chave_nao_depende_da_ordem_dos_campos() -> None:
    """Duas ordens do mesmo pedido não podem virar duas entradas no cache."""
    assert cache_key(Filtros(status="ABERTO", limit=10)) == cache_key(
        FiltrosOrdemTrocada(limit=10, status="ABERTO")
    )
