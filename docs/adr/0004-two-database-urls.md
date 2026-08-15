# ADR-004 — Two database URLs

**Problem.** The application needs an async driver. Alembic and `psql` need a sync one.

**Chosen.**

```bash
DATABASE_URL=postgresql+asyncpg://...     # application (asyncpg, non-blocking)
DATABASE_URL_SYNC=postgresql://...        # alembic, psql, one-off scripts
```

`config.py` validates that `DATABASE_URL` starts with `postgresql+asyncpg://` and
that `DATABASE_URL_SYNC` does not.

**Why the async driver matters.** FastAPI runs on an event loop. A synchronous driver
blocks the entire loop for the duration of every query, so concurrent requests queue
behind each other. This is a correctness issue under load, not a micro-optimisation.
