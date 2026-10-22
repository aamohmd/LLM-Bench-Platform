from __future__ import annotations

from logging.config import fileConfig

from alembic import context
from sqlalchemy import engine_from_config, pool

from backend.app.repositories.history_store import Base


config = context.config
if config.config_file_name is not None:
    fileConfig(config.config_file_name, disable_existing_loggers=False)

target_metadata = Base.metadata
_RETAINED_LEGACY_TABLES = {"benchmark_analyses", "fleet_analyses"}


def include_object(object_, name, type_, reflected, compare_to):
    """Exclude only intentionally retained legacy tables from autogenerate."""
    if type_ == "table" and reflected and name in _RETAINED_LEGACY_TABLES:
        return False
    return True


def run_migrations_offline() -> None:
    import os
    override_url = config.attributes.get("override_url")
    if override_url:
        url = override_url
    else:
        url = os.environ.get("DATABASE_URL", config.get_main_option("sqlalchemy.url"))
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        include_object=include_object,
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    import os
    supplied_connection = config.attributes.get("connection")
    if supplied_connection is not None:
        context.configure(connection=supplied_connection, target_metadata=target_metadata, include_object=include_object)
        with context.begin_transaction():
            context.run_migrations()
        return

    override_url = config.attributes.get("override_url")
    if override_url:
        url = override_url
    else:
        url = os.environ.get("DATABASE_URL") or config.get_main_option("sqlalchemy.url")
    if url:
        if url.startswith("postgresql://"):
            url = url.replace("postgresql://", "postgresql+psycopg://", 1)
        config.set_main_option("sqlalchemy.url", url.replace("%", "%%"))
        
    connectable = engine_from_config(config.get_section(config.config_ini_section, {}), prefix="sqlalchemy.", poolclass=pool.NullPool)
    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            include_object=include_object,
        )
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
