# ADR-015 — Alembic's async engine is built directly, not via `configparser`

**Problem.** Both `alembic revision --autogenerate` and `alembic upgrade head` failed
against a real Supabase connection string, with two unrelated errors — neither visible
until the migration ran against a live database with real credentials, on Windows.

**What happened.**

1. The async template's default pattern —
   `config.set_main_option("sqlalchemy.url", url)` then
   `async_engine_from_config(config.get_section(...))` — round-trips the URL through
   Python's `configparser`, which treats a bare `%` as the start of `%(name)s`
   interpolation syntax. Our Supabase password contains a literal `@`, which has to be
   percent-encoded (`%40`) for the URL to parse at all — and that `%` then broke
   `configparser` with `invalid interpolation syntax in ... at position 61`.
2. Building the engine from `_sync_url()` (the `postgresql+psycopg` driver, matching
   `DATABASE_URL_SYNC`) sidesteps `configparser` — but psycopg3's async mode refuses to
   run under Windows' default `ProactorEventLoop`: `psycopg.InterfaceError: Psycopg
   cannot use the 'ProactorEventLoop' to run in async mode`.

**Alternatives considered.**

- Escape the `%` for `configparser` (double it to `%%`) and keep psycopg. Fixes error 1,
  walks straight into error 2 on this machine.
- Force a `SelectorEventLoop` policy just for Alembic, and keep psycopg. Works, but adds
  a Windows-only special case to carry forward indefinitely.
- Build the async engine directly from `settings.database_url` (asyncpg), bypassing
  `configparser` entirely. Chosen.

**Chosen.**

```python
async def run_async_migrations() -> None:
    connectable = create_async_engine(settings.database_url, poolclass=pool.NullPool)
    async with connectable.connect() as connection:
        await connection.run_sync(do_run_migrations)
    await connectable.dispose()
```

**Reasoning.** `asyncpg` has no event-loop restriction and needs no text-based
round-trip — the engine is built straight from a Python string, so nothing about the
credentials (including a `%` from percent-encoding) has to survive `configparser`'s
interpolation rules. It is also the same driver the running application already uses, so
migrations exercise the same code path as production traffic.

**Trade-off.** `run_migrations_offline()` (the SQL-preview mode that never opens a
connection) still uses `_sync_url()` / psycopg — that path never connects, so it never
hits either bug, and it's what keeps `DATABASE_URL_SYNC` actually exercised somewhere.

**Industry practice.** The `ProactorEventLoop` restriction is documented psycopg3
behaviour, not a project bug — a well-known trap for FastAPI+Alembic developed on
Windows rather than inside a Linux container, where the default loop never surfaces it.

**Learning note.** A password containing `@` is a legitimate credential, not an edge
case — proof that "works inside `docker compose`'s Linux container" and "works on the
developer's actual machine" are two different claims. Neither bug was visible from
reading the code; both only exist because the real command ran, with the real driver, on
the real OS, against the real database.
