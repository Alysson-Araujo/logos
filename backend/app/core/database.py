"""Engine SQLAlchemy, sessões e pragmas específicos do SQLite."""

from __future__ import annotations

from collections.abc import Iterator
from threading import Lock
from typing import Final

from sqlalchemy import Engine, create_engine, event, inspect, text
from sqlalchemy.engine.interfaces import DBAPIConnection
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.core.config import Settings, get_settings

SQLITE_BUSY_TIMEOUT_MS = 5000
POSTGRES_POOL_SIZE = 5
POSTGRES_MAX_OVERFLOW = 10
POSTGRES_POOL_RECYCLE_SECONDS = 1800
#: Segundos que o driver espera por uma conexão antes de desistir.
#:
#: O padrão do libpq é 0: esperar para sempre. Com o banco inalcançável, a
#: requisição não falha — fica pendurada —, então nenhuma falha chega ao
#: disjuntor e o circuito nunca abre, que é justamente o cenário em que ele
#: deveria agir. Medido com o container parado: a requisição ficou mais de 12
#: minutos pendurada em vez de devolver 503.
POSTGRES_CONNECT_TIMEOUT_SECONDS = 5

_engine: Engine | None = None
_engine_lock = Lock()

#: Tabela cuja existencia prova que as migracoes foram aplicadas.
REQUIRED_TABLE: Final[str] = "incidents"


def normalize_database_url(url: str) -> str:
    """Garante o driver psycopg 3 quando a URL aponta para PostgreSQL."""
    if url.startswith("postgres://"):
        return url.replace("postgres://", "postgresql+psycopg://", 1)
    if url.startswith("postgresql://"):
        return url.replace("postgresql://", "postgresql+psycopg://", 1)
    return url


def is_sqlite(url: str) -> bool:
    """Indica se a URL aponta para um banco SQLite."""
    return normalize_database_url(url).startswith("sqlite")


def _apply_sqlite_pragmas(dbapi_connection: DBAPIConnection, _record: object) -> None:
    """Ativa WAL, timeout de lock e integridade referencial no SQLite."""
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA journal_mode=WAL")
    cursor.execute(f"PRAGMA busy_timeout={SQLITE_BUSY_TIMEOUT_MS}")
    cursor.execute("PRAGMA foreign_keys=ON")
    cursor.close()


def _server_session_options(settings: Settings) -> str:
    """Opções de sessão que impedem uma consulta de pendurar o worker.

    `statement_timeout` mata a consulta que passa do limite. O erro chega como
    SQLSTATE 57014, que a retentativa já classifica como transitório — então uma
    consulta que apenas **demorou** ganha uma segunda chance, e uma que trava
    sempre acaba abrindo o disjuntor.

    `idle_in_transaction_session_timeout` mata a conexão parada **dentro** de uma
    transação. Sem ele, um worker interrompido no meio deixa a transação aberta
    segurando locks; num pool de tamanho fixo, isso derruba a capacidade de todo
    mundo — e o sintoma aparece longe da causa.

    Vão como opções de sessão do servidor, e não como `SET` depois de conectar,
    porque assim valem desde a primeira consulta: não existe janela em que uma
    conexão recém-aberta ainda esteja sem limite.
    """
    return (
        f"-c statement_timeout={settings.db_statement_timeout_ms}"
        f" -c idle_in_transaction_session_timeout={settings.db_idle_transaction_timeout_ms}"
    )


def _build_engine(url: str, *, echo: bool) -> Engine:
    """Cria o engine com a configuração adequada ao banco alvo."""
    normalized = normalize_database_url(url)
    if normalized.startswith("sqlite"):
        engine = create_engine(
            normalized,
            echo=echo,
            connect_args={"check_same_thread": False},
        )
        event.listen(engine, "connect", _apply_sqlite_pragmas)
        return engine
    settings = get_settings()
    return create_engine(
        normalized,
        echo=echo,
        pool_pre_ping=True,
        pool_size=POSTGRES_POOL_SIZE,
        max_overflow=POSTGRES_MAX_OVERFLOW,
        pool_recycle=POSTGRES_POOL_RECYCLE_SECONDS,
        connect_args={
            # Sem isto o disjuntor não tem o que contar: a requisição nunca falha.
            "connect_timeout": POSTGRES_CONNECT_TIMEOUT_SECONDS,
            "options": _server_session_options(settings),
        },
    )


def get_engine() -> Engine:
    """Devolve o engine único da aplicação, criando-o sob demanda."""
    global _engine
    if _engine is None:
        with _engine_lock:
            if _engine is None:
                settings = get_settings()
                _engine = _build_engine(settings.database_url, echo=settings.sql_echo)
    return _engine


def dispose_engine() -> None:
    """Descarta o engine atual, fechando todas as conexões do pool."""
    global _engine
    with _engine_lock:
        if _engine is not None:
            _engine.dispose()
            _engine = None


def create_session(engine: Engine | None = None) -> Session:
    """Cria uma sessão ORM ligada ao engine informado."""
    return Session(bind=engine if engine is not None else get_engine(), expire_on_commit=False)


def get_session() -> Iterator[Session]:
    """Dependência do FastAPI que entrega uma sessão por requisição."""
    with create_session() as session:
        yield session


def ping_database(session: Session) -> bool:
    """Executa uma consulta trivial para validar a disponibilidade do banco."""
    try:
        session.execute(text("SELECT 1"))
    except SQLAlchemyError:
        session.rollback()
        return False
    return True


def ensure_schema_is_migrated() -> None:
    """Falha cedo, com instrucao acionavel, quando o schema nao foi migrado.

    O schema nao e criado pela aplicacao: quem cria e o Alembic. Sem esta
    checagem, um banco vazio produziria um erro de "tabela inexistente" no meio
    da primeira requisicao; com ela, a API para na subida dizendo exatamente o
    comando que falta rodar.
    """
    tabelas = set(inspect(get_engine()).get_table_names())
    if REQUIRED_TABLE in tabelas:
        return
    raise RuntimeError(
        f"A tabela '{REQUIRED_TABLE}' nao existe em "
        f"{normalize_database_url(get_settings().database_url)}.\n"
        "O schema e criado pelas migracoes do Alembic. Rode antes de subir a API:\n"
        "    cd backend && alembic upgrade head"
    )
