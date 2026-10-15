"""Engine SQLAlchemy, sessões e pragmas específicos do SQLite."""

from __future__ import annotations

from collections.abc import Iterator
from threading import Lock

from sqlalchemy import Engine, create_engine, event, text
from sqlalchemy.engine.interfaces import DBAPIConnection
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.core.config import get_settings

SQLITE_BUSY_TIMEOUT_MS = 5000
POSTGRES_POOL_SIZE = 5
POSTGRES_MAX_OVERFLOW = 10
POSTGRES_POOL_RECYCLE_SECONDS = 1800

_engine: Engine | None = None
_engine_lock = Lock()


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
    return create_engine(
        normalized,
        echo=echo,
        pool_pre_ping=True,
        pool_size=POSTGRES_POOL_SIZE,
        max_overflow=POSTGRES_MAX_OVERFLOW,
        pool_recycle=POSTGRES_POOL_RECYCLE_SECONDS,
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
