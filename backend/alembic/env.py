"""Ambiente de execucao das migracoes do Alembic.

Duas decisoes concentram o valor deste arquivo:

1. A URL do banco vem de `app.core.config.Settings`, a mesma fonte que a API
   usa. Nao existe um segundo lugar onde a URL fica escrita, entao e impossivel
   rodar a migracao contra um banco diferente do que a aplicacao vai usar.

2. O alvo das migracoes e o `metadata` dos modelos. Toda tabela ou indice novo
   aparece no `autogenerate`, e a checagem `alembic check` acusa qualquer
   divergencia entre o que o codigo declara e o que as migracoes criam.
"""

from __future__ import annotations

from logging.config import fileConfig

from sqlalchemy import engine_from_config, pool

from alembic import context
from app.core.config import get_settings
from app.core.database import normalize_database_url
from app.models import Base

config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata


def database_url() -> str:
    """URL do banco configurada, normalizada para o driver psycopg 3."""
    return normalize_database_url(get_settings().database_url)


def run_migrations_offline() -> None:
    """Gera o SQL das migracoes sem abrir conexao (`alembic upgrade --sql`)."""
    context.configure(
        url=database_url(),
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        compare_type=True,
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    """Aplica as migracoes conectando no banco configurado."""
    section = config.get_section(config.config_ini_section, {})
    section["sqlalchemy.url"] = database_url()

    connectable = engine_from_config(
        section,
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )

    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            compare_type=True,
        )
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
