"""Configuração do engine — em especial o que faz o disjuntor ter o que contar.

Este teste existe por causa de um achado medido: sem `connect_timeout`, uma
requisição contra um banco inalcançável **não falha**, fica pendurada. O
disjuntor nunca conta falha nenhuma e o circuito nunca abre — exatamente no
cenário em que ele deveria agir. O teste trava a configuração para que ela não
seja removida por engano numa refatoração.
"""

from __future__ import annotations

from typing import Any

from app.core.database import (
    POSTGRES_CONNECT_TIMEOUT_SECONDS,
    POSTGRES_POOL_SIZE,
    _build_engine,
)


def test_engine_postgres_configura_timeout_de_conexao(monkeypatch: Any) -> None:
    capturado: dict[str, Any] = {}

    def create_engine_falso(url: str, **kwargs: Any) -> object:
        capturado["url"] = url
        capturado.update(kwargs)
        return object()

    monkeypatch.setattr("app.core.database.create_engine", create_engine_falso)

    _build_engine("postgresql://logos:logos@localhost:5433/logos", echo=False)

    assert capturado["connect_args"]["connect_timeout"] == POSTGRES_CONNECT_TIMEOUT_SECONDS
    # E o timeout precisa ser finito: zero significa "esperar para sempre".
    assert POSTGRES_CONNECT_TIMEOUT_SECONDS > 0


def test_engine_postgres_mantem_pre_ping_e_pool(monkeypatch: Any) -> None:
    """O pre-ping descarta conexão morta antes de usá-la; sem ele o erro é na query."""
    capturado: dict[str, Any] = {}

    def create_engine_falso(url: str, **kwargs: Any) -> object:
        capturado.update(kwargs)
        return object()

    monkeypatch.setattr("app.core.database.create_engine", create_engine_falso)

    _build_engine("postgresql://logos:logos@localhost:5433/logos", echo=False)

    assert capturado["pool_pre_ping"] is True
    assert capturado["pool_size"] == POSTGRES_POOL_SIZE


def test_engine_sqlite_nao_recebe_opcoes_de_postgres(monkeypatch: Any) -> None:
    """Passar `connect_timeout` para o SQLite quebraria a conexão."""
    capturado: dict[str, Any] = {}

    def create_engine_falso(url: str, **kwargs: Any) -> object:
        capturado.update(kwargs)
        return object()

    monkeypatch.setattr("app.core.database.create_engine", create_engine_falso)
    monkeypatch.setattr("app.core.database.event.listen", lambda *a, **k: None)

    _build_engine("sqlite:///./logos.db", echo=False)

    assert "connect_timeout" not in capturado.get("connect_args", {})
    assert "pool_pre_ping" not in capturado
