import asyncio
from logging.config import fileConfig

from sqlalchemy import pool
from sqlalchemy.engine import Connection
from sqlalchemy.engine.url import make_url
from sqlalchemy.ext.asyncio import create_async_engine

import app.models  # noqa: F401 — the model registry; see app/models/__init__.py
from alembic import context
from app.core.config import settings
from app.db.base import Base

config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# THE reason `import app.models` is at the top of this file: Base.metadata
# is Alembic's source of truth for "what should the schema look like". A
# model only registers itself in that metadata when its module has been
# imported somewhere — app/models/__init__.py's import block IS that
# somewhere. Skip that import and target_metadata would be empty, and
# `--autogenerate` would cheerfully generate a migration that DROPS every
# table it can't see.
target_metadata = Base.metadata


def _sync_url() -> str:
    """DATABASE_URL_SYNC is plain postgresql://, which SQLAlchemy maps to
    psycopg2 by default — we don't install that, we installed psycopg (v3),
    so name the driver explicitly. make_url + set() avoids doing string
    surgery on a URL that may contain a password with special characters.
    """
    return (
        make_url(settings.database_url_sync)
        .set(drivername="postgresql+psycopg")
        .render_as_string(hide_password=False)
    )


def run_migrations_offline() -> None:
    """Print the SQL instead of running it — no live connection needed.
    Useful for reviewing exactly what a migration will do before it touches
    a real database (Phase 7 uses this before the first production deploy).
    """
    context.configure(
        url=_sync_url(),
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        compare_type=True,
    )
    with context.begin_transaction():
        context.run_migrations()


def do_run_migrations(connection: Connection) -> None:
    context.configure(
        connection=connection,
        target_metadata=target_metadata,
        compare_type=True,  # detect column type changes, e.g. VARCHAR(50) -> VARCHAR(100)
        compare_server_default=True,
    )
    with context.begin_transaction():
        context.run_migrations()


async def run_async_migrations() -> None:
    """Build the engine directly from DATABASE_URL (asyncpg), not via _sync_url().

    Two independent problems ruled out psycopg here. First: config.set_main_option()
    round-trips the URL through configparser, which treats a bare '%' as the start of
    "%(name)s" interpolation syntax — a password containing a percent-encoded
    character (e.g. '%40' for a literal '@') trips it with "invalid interpolation
    syntax" even though the URL itself is valid. Building the engine straight from a
    Python string sidesteps configparser entirely. Second, and the reason this uses
    asyncpg specifically rather than just fixing that: psycopg3's async mode refuses
    to run on Windows' default ProactorEventLoop ("Psycopg cannot use the
    'ProactorEventLoop' to run in async mode") — asyncpg has no such restriction, so
    migrations run on the same driver the application already uses at runtime.
    """
    connectable = create_async_engine(settings.database_url, poolclass=pool.NullPool)
    async with connectable.connect() as connection:
        await connection.run_sync(do_run_migrations)
    await connectable.dispose()


if context.is_offline_mode():
    run_migrations_offline()
else:
    asyncio.run(run_async_migrations())
