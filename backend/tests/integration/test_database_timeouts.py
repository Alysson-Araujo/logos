"""Os limites de tempo do servidor, verificados contra PostgreSQL de verdade.

Estes testes precisam de um PostgreSQL: `statement_timeout` não existe no SQLite,
que tem mecanismo próprio (`PRAGMA busy_timeout`). No job de SQLite do CI eles
são pulados; no job de PostgreSQL, rodam — é a mesma lógica do `conftest`, que
respeita `TEST_DATABASE_URL` em vez de forçar SQLite em todo lugar.
"""

from __future__ import annotations

import time

import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError

from app.core.config import get_settings
from app.core.database import get_engine, is_sqlite
from app.infra.retry import is_transient

pytestmark = pytest.mark.skipif(
    is_sqlite(get_settings().database_url),
    reason="statement_timeout é do PostgreSQL; no SQLite o limite é o PRAGMA busy_timeout",
)

#: Limite curto, para o teste não esperar os 5 s da configuração.
LIMITE_CURTO_MS = 200


def test_sessao_recebe_o_timeout_configurado() -> None:
    """Garante que a opção de sessão chegou ao servidor, e não só ao connect_args."""
    with get_engine().connect() as conexao:
        declaracao = conexao.execute(
            text("SELECT setting FROM pg_settings WHERE name = 'statement_timeout'")
        ).scalar()
        ociosa = conexao.execute(
            text(
                "SELECT setting FROM pg_settings WHERE name = 'idle_in_transaction_session_timeout'"
            )
        ).scalar()

    configuracao = get_settings()
    assert int(declaracao) == configuracao.db_statement_timeout_ms
    assert int(ociosa) == configuracao.db_idle_transaction_timeout_ms


def test_consulta_que_estoura_e_cancelada_e_conta_como_transitoria() -> None:
    """O ponto da issue: uma consulta lenta não pode consumir o worker sem fim."""
    engine = get_engine()
    inicio = time.monotonic()

    with pytest.raises(DBAPIError) as capturado, engine.begin() as conexao:
        # SET LOCAL vale só nesta transação, então não vaza para o pool.
        conexao.execute(text(f"SET LOCAL statement_timeout = {LIMITE_CURTO_MS}"))
        conexao.execute(text("SELECT pg_sleep(5)"))

    decorrido = time.monotonic() - inicio
    assert decorrido < 3, f"deveria ser cancelada em ~0,2 s e levou {decorrido:.2f} s"
    assert getattr(capturado.value.orig, "sqlstate", None) == "57014"
    # 57014 é transitório para a retentativa: a consulta que apenas demorou ganha
    # uma segunda chance, e a que trava sempre acaba abrindo o disjuntor.
    assert is_transient(capturado.value)


def test_limite_local_nao_vaza_para_a_conexao_do_pool() -> None:
    """Se vazasse, uma requisição envenenaria as seguintes que reusassem a conexão."""
    engine = get_engine()

    with pytest.raises(DBAPIError), engine.begin() as conexao:
        conexao.execute(text("SET LOCAL statement_timeout = 50"))
        conexao.execute(text("SELECT pg_sleep(5)"))

    with engine.connect() as conexao:
        valor = conexao.execute(
            text("SELECT setting FROM pg_settings WHERE name = 'statement_timeout'")
        ).scalar()

    assert int(valor) == get_settings().db_statement_timeout_ms
