# Phase 1 — Foundation

**Goal:** a machine that has never seen this project goes from `git clone` to a running
application in under 15 minutes, with no manual steps and no tribal knowledge.

**Time:** ~3 hours · **Prerequisite:** [`00-ARCHITECTURE.md`](00-ARCHITECTURE.md)

**Done when:**

```
git clone → docker compose up → /health returns 200, /docs loads, localhost:3000 renders
uv run ruff check .   uv run pyright   → clean
pnpm type-check       pnpm lint        → clean
Both GitHub Actions workflows green
```

That last line is not a formality. A CI badge that is red, or worse, green because it
never runs the failing step, is how a project starts lying to you.

---

## 1.1 Why this phase exists

Foundation work feels like overhead when you want to write SQL. It is not. Every hour
here removes a class of problem permanently:

| Without it | With it |
|---|---|
| "Works on my machine" | One container definition, identical everywhere |
| Secrets pasted into Slack | `.env.example` committed, `.env` never |
| "Did you run the migration?" | `docker compose up` runs it |
| Bug found in review | Bug found by `ruff`/`pyright` before the commit exists |
| Config typo crashes production | Config typo crashes startup, locally, with a readable message |

The last row is the important one and it has a name: **fail fast at the boundary.**
A settings object that validates on import turns a 3 a.m. production mystery into a
message on your own screen ten seconds after you typo the variable.

---

## 1.2 Repository layout

```
Neuro-Vault/
├── .github/workflows/
│   ├── backend-ci.yml
│   └── frontend-ci.yml
├── backend/
│   ├── alembic/
│   │   ├── versions/           # migration files — the schema's git history
│   │   ├── env.py
│   │   └── script.py.mako
│   ├── app/
│   │   ├── api/v1/
│   │   │   ├── endpoints/      # one module per resource   (Phase 4)
│   │   │   └── router.py
│   │   ├── core/
│   │   │   ├── config.py       # settings — the only place os.environ is read
│   │   │   ├── dependencies.py # FastAPI dependencies       (Phase 4)
│   │   │   ├── redis.py        # cache client
│   │   │   └── security.py     # JWT verification           (Phase 4)
│   │   ├── db/
│   │   │   ├── base.py         # DeclarativeBase + model imports for Alembic
│   │   │   └── session.py      # engine + get_db()
│   │   ├── models/             # SQLAlchemy models          (Phase 2)
│   │   ├── repositories/       # data access only           (Phase 4)
│   │   ├── schemas/            # Pydantic request/response  (Phase 4)
│   │   ├── services/           # business logic              (Phase 4)
│   │   ├── tests/                                            (Phase 6)
│   │   └── main.py             # FastAPI app
│   ├── scripts/seed.py         # demo data                  (Phase 2)
│   ├── alembic.ini
│   ├── Dockerfile
│   └── pyproject.toml
├── frontend/
│   ├── src/
│   │   ├── app/                # Next.js App Router
│   │   ├── components/
│   │   ├── hooks/
│   │   ├── lib/                # api client, supabase client, utils
│   │   └── types/
│   ├── Dockerfile
│   ├── nginx.conf              # static hosting for the production image
│   └── package.json
├── docs/                       # this doc set
├── .env.example
├── .gitignore
├── .pre-commit-config.yaml
└── docker-compose.yml
```

**Why a monorepo?** Two people, one product, one schema. A schema change and the API
change that depends on it land in **one commit and one review**. Split repos would let
the backend merge a breaking change while the frontend still compiles against the old
shape — the failure appears at runtime, in front of your examiner. Google, Meta, and
Uber all run monorepos for exactly this reason at vastly larger scale.

---

## 1.3 `.gitignore` — the defect that stops the project building

### The bug

The current root `.gitignore` is GitHub's Python template, unmodified. Line 17 is:

```gitignore
lib/
```

In the Python packaging world that means "the `lib/` directory inside a virtualenv."
Git does not know that. Git applies the pattern **at every depth**, so it also matches:

```
frontend/src/lib/          ← every shadcn component imports from here
```

`frontend/src/lib/utils.ts` exists on your disk and is invisible to Git. It is not in
any commit. A teammate cloning this repository gets a frontend that fails type-check
with **15 × `TS2307: Cannot find module '@/lib/utils'`**.

I verified this rather than assuming it — `git archive HEAD` into a clean directory,
`pnpm install`, `tsc --noEmit`, exit code 2.

This is the single most instructive bug in the project, because **it is invisible from
inside the repository.** Your working copy is fine. `git status` is clean. Everything
looks correct until someone else clones it. Copying a config file you have not read is
how it happens.

### The rule

> A `.gitignore` pattern with no `/` in it matches at **every** directory depth.
> `lib/` means "any directory named lib, anywhere." `/backend/lib/` means one exact path.

The same trap is loaded in `build/`, `dist/`, `target/`, `share/`, `var/`, `parts/`,
and `env/` — all present in that template, all generic English words that a
JavaScript, Rust, or Java directory could legitimately be called.

### The fix

Replace the root `.gitignore` entirely. **Anchor every path, scope by language.**

```gitignore
# ─── Secrets ──────────────────────────────────────────────────────────────────
.env
.env.*
!.env.example

# ─── Python (backend/) ────────────────────────────────────────────────────────
__pycache__/
*.py[cod]
/backend/.venv/
/backend/.pytest_cache/
/backend/.ruff_cache/
/backend/.coverage
/backend/coverage.xml
/backend/htmlcov/
/backend/dist/
/backend/*.egg-info/

# ─── Node (frontend/) ─────────────────────────────────────────────────────────
/frontend/node_modules/
/frontend/.next/
/frontend/out/
/frontend/.turbo/
/frontend/coverage/
/frontend/next-env.d.ts

# ─── Editors & OS ─────────────────────────────────────────────────────────────
.vscode/
.idea/
.gemini/
.DS_Store
Thumbs.db

# ─── Logs ─────────────────────────────────────────────────────────────────────
*.log
```

Note `.env.*` followed by `!.env.example`. Order matters — a later negation re-includes
a file an earlier pattern excluded. This ignores `.env.local`, `.env.production`, and
anything else you invent later, while keeping the committed template.

### Recovering the lost file

Ignoring a file is not the same as deleting it. `frontend/src/lib/utils.ts` is on your
disk; it was only ever excluded from tracking. After replacing `.gitignore`:

```bash
git status --short           # frontend/src/lib/utils.ts now appears as untracked
git add frontend/src/lib/
git commit -m "fix: stop .gitignore excluding frontend/src/lib from version control"
```

Then prove it, rather than trusting it:

```bash
git ls-files frontend/src/lib/     # must print utils.ts
```

`git ls-files` reports what is **actually in the index**. `git status` showing nothing
can mean "committed" or "ignored" — those look identical and mean opposite things.

---

## 1.4 External services

Three accounts, all free tier, all created before you write code.

### Supabase — Auth, and the production database

1. [supabase.com](https://supabase.com) → New Project. Region closest to you.
2. Save the database password immediately; it is shown once.
3. **Settings → API** → copy `Project URL`, `anon public`, `service_role`.
4. **Settings → API → JWT Settings** → copy `JWT Secret`.
5. **Settings → Database → Connection string → URI** → copy.

> **The `anon` key is public.** It ships to every browser that loads your site. It is
> not a secret and treating it like one gives you false confidence. What actually
> protects your data is Row Level Security, enforced by PostgreSQL, on every table.
> That is Phase 3, and [ADR-008](00-ARCHITECTURE.md#adr-008) explains why it is not
> optional. The `service_role` key **is** a secret — it bypasses RLS entirely and must
> never appear in frontend code, a `NEXT_PUBLIC_*` variable, or a commit.

#### Which connection string — this matters

Supabase gives you three, and choosing wrong produces failures that look random:

| Port | Mode | Use it for |
|---|---|---|
| 5432 direct | one connection each | Migrations, `psql`, local tooling |
| 5432 pooler | **session** pooling | ✅ **The application** |
| 6543 pooler | **transaction** pooling | Only with the config below |

The transaction pooler (6543) hands your connection to a different backend process
between statements. asyncpg caches **prepared statements** per connection, so a cached
plan gets replayed against a process that never prepared it. The error is
`InvalidSQLStatementNameError: prepared statement "__asyncpg_stmt_1__" does not exist`,
it appears only under concurrency, and it is maddening to debug from a stack trace.

**Use the session pooler on 5432.** If you are ever forced onto 6543:

```python
create_async_engine(
    url,
    poolclass=NullPool,                             # pgbouncer owns pooling, not us
    connect_args={"statement_cache_size": 0},       # disable asyncpg's cache
)
```

This is the kind of infrastructure detail that decides whether a demo survives more
than one person clicking at a time.

### Upstash — Redis

[upstash.com](https://upstash.com) → Create Database → copy the `rediss://` URL.
Free tier is 10,000 commands/day, far beyond what this project needs.

### Sentry — error tracking

[sentry.io](https://sentry.io) → New Project → **FastAPI** → copy the DSN.

Sentry is optional for the app to run — every integration here degrades gracefully when
its variable is absent, which is deliberate. A teammate must be able to run the backend
without signing up for three services first. **Optional dependencies should be optional
in code, not just in the README.**

---

## 1.5 Environment variables

Replace `.env.example` with this. Committed, placeholders only:

```bash
# ─── Database ─────────────────────────────────────────────────────────────────
# Two URLs, same database, different drivers. See ADR-004.
#   DATABASE_URL      → the application (async, asyncpg)
#   DATABASE_URL_SYNC → Alembic and psql (plain — psql cannot parse "+asyncpg")
#
# Local development (docker compose provides this database):
DATABASE_URL=postgresql+asyncpg://neurovault:neurovault@localhost:5432/neurovault
DATABASE_URL_SYNC=postgresql://neurovault:neurovault@localhost:5432/neurovault
#
# Supabase — use the SESSION pooler on port 5432, not 6543. See §1.4.
# DATABASE_URL=postgresql+asyncpg://postgres.PROJECT:PASSWORD@aws-0-REGION.pooler.supabase.com:5432/postgres
# DATABASE_URL_SYNC=postgresql://postgres.PROJECT:PASSWORD@aws-0-REGION.pooler.supabase.com:5432/postgres

# ─── Supabase (Settings → API) ────────────────────────────────────────────────
SUPABASE_URL=https://yourproject.supabase.co
SUPABASE_ANON_KEY=eyJhbGciOi...
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOi...
SUPABASE_JWT_SECRET=your-jwt-secret-at-least-32-characters-long

# ─── Optional integrations (the app runs without these) ───────────────────────
REDIS_URL=
SENTRY_DSN=

# ─── Application ──────────────────────────────────────────────────────────────
ENVIRONMENT=development
DEBUG=true
ALLOWED_ORIGINS=http://localhost:3000
GRAPH_MAX_DEPTH=3
GRAPH_CACHE_TTL=300
```

Setup is `cp .env.example .env`, then fill in the real values.

### Why two database URLs

`psql` is a PostgreSQL client. It speaks libpq connection strings. `postgresql+asyncpg://`
is **not** one — the `+asyncpg` suffix is SQLAlchemy's internal notation for choosing a
Python driver. `psql` fails to parse it.

The previous doc set had a single `DATABASE_URL` with the `+asyncpg` suffix, and then
instructed you to run `psql "$DATABASE_URL"` in roughly twelve places across three
phases. **Not one of those commands can work.** Nobody noticed, which tells you nobody
ran them — the strongest possible evidence that documentation nobody executes is
documentation nobody should trust.

> **Viva question:** *Why does your project have two connection strings for one database?*
>
> "The application uses the async driver so a single process can serve many concurrent
> requests without a thread per connection. Alembic runs migrations synchronously —
> DDL is sequential and there's nothing to overlap — and `psql` needs a standard libpq
> string. Same database, same credentials, different drivers, so the URL prefix differs."

### The `ALLOWED_ORIGINS` bug

`.env.example` currently ships `ALLOWED_ORIGINS=http://localhost:3000` and `config.py`
declares `allowed_origins: list[str]`. Load them together and the backend does not start:

```
pydantic_settings.exceptions.SettingsError: error parsing value for field
"allowed_origins" from source "EnvSettingsSource"
```

pydantic-settings treats any complex type as JSON and calls `json.loads()` on the raw
string **before** validators run. `http://localhost:3000` is not valid JSON.

The reason nobody caught it: backend CI never sets `ALLOWED_ORIGINS`, so the default
list is used and the JSON path is never taken. CI is green and the documented production
deployment — which sets it explicitly — cannot boot. **Your CI is only as good as the
configuration it exercises.**

The fix is in §1.6 and in [ADR-005](00-ARCHITECTURE.md#adr-005). I verified it against
pydantic-settings 2.14.2 rather than reasoning about it.

---

## 1.6 Backend toolchain

### `backend/pyproject.toml`

```toml
[project]
name = "neurovault-backend"
version = "0.1.0"
description = "NeuroVault API — a personal knowledge graph"
requires-python = ">=3.12"

dependencies = [
    "fastapi>=0.141.0",
    "uvicorn[standard]>=0.34.0",
    "sqlalchemy[asyncio]>=2.0.51",
    "asyncpg>=0.30.0",
    "psycopg[binary]>=3.2.0",
    "alembic>=1.14.0",
    "pydantic[email]>=2.13.0",
    "pydantic-settings>=2.14.0",
    "pyjwt>=2.10.0",
    "redis>=5.2.0",
    "httpx>=0.28.0",
    "python-multipart>=0.0.20",
    "sentry-sdk[fastapi]>=2.20.0",
]

[dependency-groups]
dev = [
    "pytest>=8.3.0",
    "pytest-asyncio>=0.25.0",
    "pytest-cov>=6.0.0",
    "ruff>=0.9.0",
    "pyright>=1.1.390",
    "pre-commit>=4.0.0",
]

[tool.uv]
package = false

[tool.ruff]
line-length = 100
target-version = "py312"

[tool.ruff.lint]
select = [
    "E", "W",   # pycodestyle
    "F",        # pyflakes — real errors: unused imports, undefined names
    "I",        # isort — import ordering
    "N",        # pep8-naming
    "UP",       # pyupgrade — modern syntax for the target version
    "B",        # bugbear — likely bugs, not style
    "ASYNC",    # async antipatterns (blocking calls inside async def)
    "S",        # bandit — security
]
ignore = ["E501"]                       # line length is the formatter's job

[tool.ruff.lint.per-file-ignores]
"app/tests/*" = ["S101"]                # assert is the point of a test

[tool.ruff.lint.isort]
known-first-party = ["app"]

[tool.pyright]
pythonVersion = "3.12"
typeCheckingMode = "standard"
include = ["app"]
exclude = ["**/__pycache__", ".venv"]

[tool.pytest.ini_options]
asyncio_mode = "auto"
testpaths = ["app/tests"]
addopts = "-q --strict-markers"

[tool.coverage.run]
source = ["app"]
omit = ["app/tests/*", "alembic/*"]
```

### What changed from the current file, and why

| Change | Reason |
|---|---|
| **Removed** `python-jose` | Unmaintained; last release 2021, open CVEs. See [ADR-006](00-ARCHITECTURE.md#adr-006). |
| **Added** `pyjwt` | Actively maintained, used by Auth0 and Django REST. Same job, 3-line diff. |
| **Removed** `supabase` (Python) | We verify JWTs ourselves with a shared secret — no network call, no client library. File uploads go **browser → Supabase Storage directly**, so bytes never transit our API. Removing it drops ~15 transitive dependencies. |
| **Added** `psycopg[binary]` | Alembic's sync driver. `[binary]` means no C compiler needed. |
| **Added** `sqlalchemy[asyncio]` | Pulls `greenlet`. Async SQLAlchemy fails at runtime without it, with an error that does not mention greenlet. |
| `optional-dependencies` → `dependency-groups` | PEP 735. `uv sync` includes dev by default; `--no-dev` for production images. Dev tools are not optional *features* of the app. |
| **Added** `[tool.uv] package = false` | The API is an application, not a library. Nothing to build or publish. |
| **Added** ruff `B`, `ASYNC`, `S` | `ASYNC` catches a blocking call inside `async def` — the highest-impact FastAPI bug, and invisible in review. |
| Versions floored at installed | `>=0.136` on a codebase running 0.141 documents a version nobody tested. |

```bash
cd backend
uv sync          # resolves, writes uv.lock, creates .venv
uv run ruff check .
```

> **Why `uv` and not `pip`?** `uv` resolves and installs 10–100× faster, and — the part
> that matters — it writes a **lockfile with hashes**. `requirements.txt` records what
> you asked for; `uv.lock` records what you got, exactly, transitively. That is the
> difference between a build that is reproducible and one that merely usually works.
> Commit `uv.lock`.

### `backend/app/core/config.py`

```python
from functools import lru_cache
from typing import Annotated, Literal

from pydantic import Field, field_validator, model_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict


class Settings(BaseSettings):
    """Application configuration, validated once at import time.

    Every environment variable the application reads is declared here. Nothing else
    in the codebase touches os.environ — a variable that is not on this class does
    not exist, and a malformed one stops the process instead of surfacing as a
    confusing failure three layers deep.
    """

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # ── Application ───────────────────────────────────────────────────────────
    app_name: str = "NeuroVault API"
    version: str = "0.1.0"
    environment: Literal["development", "test", "production"] = "development"
    debug: bool = True

    # ── Database (ADR-004: two URLs, one database) ────────────────────────────
    database_url: str          # async  — the application
    database_url_sync: str     # sync   — Alembic and psql

    # ── Supabase ──────────────────────────────────────────────────────────────
    supabase_url: str
    supabase_anon_key: str
    supabase_service_role_key: str
    supabase_jwt_secret: str = Field(min_length=32)

    # ── Optional integrations — absent means "disabled", not "broken" ─────────
    redis_url: str | None = None
    sentry_dsn: str | None = None

    # ── Tuning ────────────────────────────────────────────────────────────────
    graph_max_depth: int = Field(default=3, ge=1, le=6)
    graph_cache_ttl: int = Field(default=300, ge=0)

    # ADR-005: NoDecode opts out of pydantic-settings' JSON pre-parsing so the
    # validator below sees the raw string instead of a JSONDecodeError.
    allowed_origins: Annotated[list[str], NoDecode] = ["http://localhost:3000"]

    @field_validator("allowed_origins", mode="before")
    @classmethod
    def _split_origins(cls, v: str | list[str]) -> list[str]:
        if isinstance(v, str):
            return [origin.strip() for origin in v.split(",") if origin.strip()]
        return v

    @field_validator("database_url")
    @classmethod
    def _require_async_driver(cls, v: str) -> str:
        if not v.startswith("postgresql+asyncpg://"):
            raise ValueError(
                "DATABASE_URL must use the postgresql+asyncpg:// driver. "
                "Plain postgresql:// belongs in DATABASE_URL_SYNC."
            )
        return v

    @field_validator("database_url_sync")
    @classmethod
    def _require_sync_driver(cls, v: str) -> str:
        if not v.startswith("postgresql://"):
            raise ValueError(
                "DATABASE_URL_SYNC must be a plain postgresql:// URL so that psql "
                "and Alembic can both consume it."
            )
        return v

    @model_validator(mode="after")
    def _production_safety(self) -> "Settings":
        """Make the unsafe development defaults impossible to ship."""
        if self.environment == "production":
            if self.debug:
                raise ValueError("DEBUG must be false when ENVIRONMENT=production")
            if "*" in self.allowed_origins:
                raise ValueError("ALLOWED_ORIGINS must not contain '*' in production")
        return self

    @property
    def is_production(self) -> bool:
        return self.environment == "production"


@lru_cache
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]  # values come from env, not arguments


settings = get_settings()
```

**Read `_production_safety` again.** It cannot be forgotten during a deploy, because it
is not a checklist item — it is a startup condition. A production process with
`DEBUG=true` leaks stack traces containing SQL and connection strings to anyone who
triggers a 500. Making that state *unrepresentable* is the same instinct as the
composite foreign keys in [ADR-001](00-ARCHITECTURE.md#adr-001), applied to config
instead of data. It is the recurring idea in this project:

> **Do not document a rule you can make the machine enforce.**

### `backend/app/db/session.py`

```python
from collections.abc import AsyncGenerator

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.config import settings

engine = create_async_engine(
    settings.database_url,
    echo=settings.debug,        # log every statement in development
    pool_size=5,                # steady-state connections
    max_overflow=10,            # burst capacity — 15 total ceiling
    pool_pre_ping=True,         # validate before use; Supabase drops idle connections
    pool_recycle=1800,          # recycle at 30 min, under any proxy idle timeout
)

AsyncSessionLocal = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,     # keep attributes readable after commit
)


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    """Request-scoped session. One transaction per request.

    Commits if the route returns normally, rolls back if it raises. This is what
    makes database triggers observable: they fire inside this commit, so by the time
    the response is serialized the version row and activity log already exist.
    """
    async with AsyncSessionLocal() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
```

**`expire_on_commit=False` is load-bearing.** SQLAlchemy's default expires every
attribute after commit, so the next attribute access issues a fresh SELECT. In async
code that lazy SELECT happens *after* the session closes, and you get
`MissingGreenlet` — an error whose message explains nothing about the actual cause.

**`pool_pre_ping=True` costs one round-trip per checkout** and eliminates the entire
class of "first request after idle fails, retry works." Supabase's pooler closes idle
connections; without pre-ping your pool hands out a dead socket.

### `backend/app/db/base.py`

```python
from datetime import datetime
from typing import Any

from sqlalchemy import DateTime, MetaData, func
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

# Explicit naming convention for every constraint and index.
#
# Without this, PostgreSQL invents names ("notes_creator_id_fkey") and Alembic
# autogenerate cannot reliably drop or alter them later — it does not know what the
# database called something it never named. Set this on day one; retrofitting it
# means renaming every constraint in a production database.
NAMING_CONVENTION = {
    "ix": "ix_%(table_name)s_%(column_0_N_name)s",
    "uq": "uq_%(table_name)s_%(column_0_N_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_N_name)s",
    "pk": "pk_%(table_name)s",
}


class Base(DeclarativeBase):
    metadata = MetaData(naming_convention=NAMING_CONVENTION)

    type_annotation_map: dict[Any, Any] = {}


class TimestampMixin:
    """created_at / updated_at maintained by the database, not by Python.

    server_default=func.now() means the value comes from PostgreSQL. If a row is
    inserted by the seed script, by psql, or by a future service in another
    language, it still gets a correct timestamp. A Python-side default only works
    for rows this application happens to write.
    """

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )
```

> **Viva question:** *Why `TIMESTAMPTZ` and not `TIMESTAMP`?*
>
> "`TIMESTAMP` stores a wall-clock reading with no timezone, so the same value means
> different instants depending on who reads it. `TIMESTAMPTZ` stores an absolute
> instant — PostgreSQL converts to UTC on write and to the client's timezone on read.
> Version history has to be strictly ordered, and ordering wall-clock readings from
> different timezones is meaningless. It also survives daylight-saving transitions,
> where `TIMESTAMP` produces one duplicated and one missing hour every year."

### `backend/app/core/redis.py`

```python
import json
from typing import Any

from redis.asyncio import Redis

from app.core.config import settings

_redis: Redis | None = None


def get_redis() -> Redis | None:
    """Lazily create the client. Returns None when REDIS_URL is unset."""
    global _redis
    if settings.redis_url is None:
        return None
    if _redis is None:
        _redis = Redis.from_url(settings.redis_url, decode_responses=True)
    return _redis


async def cache_get(key: str) -> Any | None:
    client = get_redis()
    if client is None:
        return None
    try:
        raw = await client.get(key)
    except Exception:
        return None          # a cache outage must not become an API outage
    return json.loads(raw) if raw else None


async def cache_set(key: str, value: Any, ttl: int | None = None) -> None:
    client = get_redis()
    if client is None:
        return
    try:
        await client.setex(key, ttl or settings.graph_cache_ttl, json.dumps(value))
    except Exception:
        return


async def cache_delete_pattern(pattern: str) -> None:
    """Invalidate by pattern, e.g. graph:{user_id}:*  — used when an edge changes."""
    client = get_redis()
    if client is None:
        return
    try:
        async for key in client.scan_iter(match=pattern, count=100):
            await client.delete(key)
    except Exception:
        return
```

**Every operation swallows its exception and degrades to a miss.** A cache is an
optimisation. If Upstash is unreachable, the correct behaviour is a slower correct
answer, not a 500. This is the *decorator* / *circuit-breaker* instinct in its simplest
form, and it is why the app runs with `REDIS_URL` empty.

**`scan_iter`, never `KEYS`.** `KEYS` is O(N) over the entire keyspace and blocks
Redis — single-threaded — for the whole scan. It is a documented way to take down
production. `SCAN` is incremental and cursor-based.

### `backend/app/main.py`

```python
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import settings


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    if settings.sentry_dsn:
        import sentry_sdk

        sentry_sdk.init(
            dsn=settings.sentry_dsn,
            environment=settings.environment,
            traces_sample_rate=0.1,
            send_default_pii=False,
        )
    yield
    from app.db.session import engine

    await engine.dispose()


app = FastAPI(
    title=settings.app_name,
    version=settings.version,
    debug=settings.debug,
    lifespan=lifespan,
    docs_url=None if settings.is_production else "/docs",
    redoc_url=None,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)


@app.get("/health", tags=["health"])
async def health() -> dict[str, str]:
    return {"status": "ok", "version": settings.version}


# Phase 4 adds:
# from app.api.v1.router import api_router
# app.include_router(api_router, prefix="/api/v1")
```

Three deliberate changes from the current file:

- **`await engine.dispose()` on shutdown.** Without it, connections are closed by the
  OS when the process dies. Under a rolling deploy that leaves sockets in Supabase's
  pool until they time out, and the free tier's connection limit is small enough to
  notice.
- **`allow_methods` / `allow_headers` enumerated.** `["*"]` with
  `allow_credentials=True` is contradictory — the CORS spec forbids the wildcard when
  credentials are allowed, so browsers reject it. Listing them is both correct and
  honest about the API's surface.
- **`send_default_pii=False`.** Sentry defaults to attaching request bodies and
  headers. Note content is the user's private writing; it should not leave your
  infrastructure because an unrelated exception fired.

---

## 1.7 Frontend toolchain

### `package.json` — three changes

**1. Add the `packageManager` field.** This is why frontend CI fails today:

```json
{
  "name": "frontend",
  "version": "0.1.0",
  "private": true,
  "packageManager": "pnpm@10.20.0",
  ...
}
```

`pnpm/action-setup@v4` installs no pnpm unless it is told which version — either by a
`version:` input or by this field. With neither, the workflow fails at
`pnpm install` with `Unable to find pnpm`. Do not hand-write the version; let corepack
record the one you actually run:

```bash
cd frontend
corepack use pnpm@latest-10        # writes packageManager with an integrity hash
```

This also pins the version for *both* of you. Two developers on different pnpm majors
produce different lockfile shapes, and the diff churn is indistinguishable from a real
dependency change.

**2. Remove the archived Supabase auth packages:**

```bash
pnpm remove @supabase/auth-ui-react @supabase/auth-ui-shared
```

Supabase archived both. They pull a legacy styling system, and their peer range does
not cover React 19. Phase 5 builds the auth forms on `@supabase/supabase-js` directly —
`signInWithPassword` is one call, and you end up with less code than configuring the
widget required.

**3. Move `shadcn` to devDependencies:**

```bash
pnpm remove shadcn && pnpm add -D shadcn
```

It is a code generator you run occasionally, not a runtime import. In the production
bundle it is dead weight.

### `frontend/.env.local`

```bash
NEXT_PUBLIC_SUPABASE_URL=https://yourproject.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOi...
NEXT_PUBLIC_API_URL=http://localhost:8000
```

> **`NEXT_PUBLIC_` means "compiled into the JavaScript bundle and visible to anyone
> who opens DevTools."** Not "available to the frontend." There is no such thing as a
> frontend secret. Only the `anon` key belongs here — never `service_role`.

### `frontend/next.config.ts`

```ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "export",          // ADR-010 — static HTML/CSS/JS, no Node server
  images: { unoptimized: true },   // required: the optimizer needs a running server
  reactStrictMode: true,
};

export default nextConfig;
```

`output: "export"` is what makes the frontend deployable as static files. The
consequence — no server components, no route handlers, no middleware — is a real
constraint, and [ADR-010](00-ARCHITECTURE.md#adr-010) states plainly what it costs:
**the client-side auth guard is a UX affordance, not a security boundary.** Every
protected resource is protected by the backend checking the JWT and by RLS, never by
a redirect in a `useEffect`.

---

## 1.8 Docker

### `backend/Dockerfile`

Referenced by `docker-compose.yml` today, and does not exist. `docker compose up`
fails immediately.

```dockerfile
# syntax=docker/dockerfile:1

# ── base ──────────────────────────────────────────────────────────────────────
FROM python:3.12-slim AS base
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_COMPILE_BYTECODE=1
COPY --from=ghcr.io/astral-sh/uv:0.5 /uv /usr/local/bin/uv
WORKDIR /app

# ── deps: dependencies only, so this layer caches across code changes ─────────
FROM base AS deps
COPY pyproject.toml uv.lock ./
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-dev

# ── dev: hot reload, dev dependencies present ─────────────────────────────────
FROM base AS dev
COPY pyproject.toml uv.lock ./
RUN --mount=type=cache,target=/root/.cache/uv uv sync --frozen
COPY . .
EXPOSE 8000
CMD ["uv", "run", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--reload"]

# ── runtime: production ───────────────────────────────────────────────────────
FROM base AS runtime
RUN useradd --create-home --uid 1000 appuser
COPY --from=deps /app/.venv /app/.venv
COPY --chown=appuser:appuser . .
ENV PATH="/app/.venv/bin:$PATH"
USER appuser
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health')"
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
```

**Why the stages are ordered this way.** Docker caches per instruction and invalidates
everything downstream of a changed file. Dependencies change monthly; your code changes
every few minutes. Copying `pyproject.toml` + `uv.lock` *before* the source means a
one-character edit to a route reuses the cached dependency layer. Reverse the order and
every build reinstalls everything — the single most common Dockerfile mistake, and it
costs minutes on every push forever.

**`USER appuser` is not paperwork.** Containers run as root by default. A container
escape from a root process is a root process on the host. Every production base image
guide — Google's distroless, Chainguard, the Docker docs — says the same thing.

**`--no-dev` in the runtime stage** keeps `pytest`, `ruff`, and `pyright` out of the
production image. Smaller image, smaller attack surface, faster pulls.

### `frontend/Dockerfile`

```dockerfile
# syntax=docker/dockerfile:1

FROM node:22-alpine AS base
RUN corepack enable
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

FROM base AS dev
COPY --from=deps /app/node_modules ./node_modules
COPY . .
EXPOSE 3000
CMD ["pnpm", "dev"]

# Static export. NEXT_PUBLIC_* are inlined at build time, so they must be
# present as build arguments — not runtime environment variables.
FROM base AS build
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL \
    NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY \
    NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm build

FROM nginx:1.27-alpine AS runtime
COPY --from=build /app/out /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
```

**`ARG`, not runtime `ENV`.** `NEXT_PUBLIC_*` variables are substituted into the
JavaScript during `pnpm build`. Setting them when the container starts changes nothing —
the strings are already baked into files on disk. This surprises people repeatedly;
the practical consequence is that **staging and production need separate image builds.**

### `frontend/nginx.conf`

```nginx
server {
    listen 80;
    server_name _;
    root /usr/share/nginx/html;

    # Static export writes /dashboard/index.html for the /dashboard route.
    location / {
        try_files $uri $uri.html $uri/index.html /index.html;
    }

    # Hashed asset filenames are immutable — cache them aggressively.
    location /_next/static/ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    gzip on;
    gzip_types text/css application/javascript application/json image/svg+xml;
}
```

---

## 1.9 `docker-compose.yml`

The current file has a real problem: **there is no database service.** It expects both
of you to develop against one shared Supabase instance. That means:

- `alembic downgrade base`, which you *will* run while iterating on the schema, destroys
  your teammate's data.
- Your migrations collide in the same `alembic_version` row.
- Supabase's free tier pauses after 7 days idle — your project stops working the week
  before submission for reasons unrelated to your code.
- Every query pays ~200 ms of network latency instead of under 1 ms.

**Develop against local PostgreSQL; deploy to Supabase.** This works because
`users.id` is a *mirror* of the Supabase `sub` claim, not a foreign key into Supabase's
`auth.users` — so Auth stays remote while the data lives wherever you point it. That
decoupling is recorded as [ADR-013](00-ARCHITECTURE.md#adr-013).

```yaml
name: neurovault

services:
  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: neurovault
      POSTGRES_PASSWORD: neurovault
      POSTGRES_DB: neurovault
    ports: ["5432:5432"]
    volumes: ["pgdata:/var/lib/postgresql/data"]
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U neurovault -d neurovault"]
      interval: 5s
      timeout: 5s
      retries: 10

  migrate:
    build: { context: ./backend, target: dev }
    command: uv run alembic upgrade head
    env_file: .env
    environment:
      DATABASE_URL: postgresql+asyncpg://neurovault:neurovault@db:5432/neurovault
      DATABASE_URL_SYNC: postgresql://neurovault:neurovault@db:5432/neurovault
    depends_on:
      db: { condition: service_healthy }

  backend:
    build: { context: ./backend, target: dev }
    env_file: .env
    environment:
      DATABASE_URL: postgresql+asyncpg://neurovault:neurovault@db:5432/neurovault
      DATABASE_URL_SYNC: postgresql://neurovault:neurovault@db:5432/neurovault
      ALLOWED_ORIGINS: http://localhost:3000
    volumes:
      - ./backend:/app        # live reload
      - /app/.venv            # keep the image's venv — see below
    ports: ["8000:8000"]
    depends_on:
      migrate: { condition: service_completed_successfully }
    restart: unless-stopped

  frontend:
    build: { context: ./frontend, target: dev }
    environment:
      NEXT_PUBLIC_SUPABASE_URL: ${SUPABASE_URL}
      NEXT_PUBLIC_SUPABASE_ANON_KEY: ${SUPABASE_ANON_KEY}
      NEXT_PUBLIC_API_URL: http://localhost:8000
    volumes:
      - ./frontend:/app
      - /app/node_modules
      - /app/.next
    ports: ["3000:3000"]
    depends_on: [backend]
    restart: unless-stopped

volumes:
  pgdata:
```

**The `- /app/.venv` line is not a typo.** Bind-mounting `./backend` over `/app`
replaces the entire directory, including the `.venv` that `uv sync` created during the
build. The container then starts with no dependencies installed. Listing `/app/.venv`
as an anonymous volume re-exposes the image's copy on top of the bind mount. The same
trick protects `node_modules` and `.next` on the frontend — which is why the existing
frontend service already has it, and why the backend service breaking without it is
easy to miss.

**`depends_on: { condition: service_completed_successfully }`** means the API does not
start until migrations finish. Plain `depends_on: [db]` waits only for the *container*
to exist, not for PostgreSQL to accept connections — which is why the healthcheck is
there. This is the containerised form of "the schema is a prerequisite, not a race."

```bash
docker compose up --build          # first run
docker compose down -v             # stop and destroy the database volume
docker compose exec db psql -U neurovault -d neurovault
```

---

## 1.10 Alembic

```bash
cd backend
uv run alembic init -t async alembic
```

The `-t async` template matters: it scaffolds an `env.py` that drives an async engine.
Then edit three things.

### `backend/alembic.ini`

Delete the `sqlalchemy.url` line entirely. The URL comes from settings — one source of
truth, and no credentials in a committed file.

```ini
[alembic]
script_location = alembic
prepend_sys_path = .
file_template = %%(year)d%%(month).2d%%(day).2d_%%(hour).2d%%(minute).2d_%%(slug)s
```

`file_template` gives you `20260806_1432_add_flashcards.py` instead of a bare hash.
Migration files sort chronologically in the directory listing, and a reviewer can see
what a migration does without opening it.

`prepend_sys_path = .` is what lets `env.py` do `from app.db.base import Base` — the
reason `[tool.uv] package = false` is safe.

### `backend/alembic/env.py`

```python
import asyncio
from logging.config import fileConfig

from alembic import context
from sqlalchemy import pool
from sqlalchemy.engine import Connection
from sqlalchemy.engine.url import make_url
from sqlalchemy.ext.asyncio import async_engine_from_config

from app.core.config import settings
from app.db.base import Base  # noqa: F401 — imports every model; see below

config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata


def _sync_url() -> str:
    """DATABASE_URL_SYNC is plain postgresql:// so psql can use the same string.

    SQLAlchemy maps a bare postgresql:// to psycopg2, which we do not install, so
    name psycopg (v3) explicitly. make_url avoids string surgery on a URL that
    contains a password with arbitrary characters in it.
    """
    return make_url(settings.database_url_sync).set(drivername="postgresql+psycopg").render_as_string(
        hide_password=False
    )


def run_migrations_offline() -> None:
    """Emit SQL to stdout without connecting — for review, or a DBA-gated deploy."""
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
        compare_type=True,          # detect VARCHAR(50) → VARCHAR(100)
        compare_server_default=True,
    )
    with context.begin_transaction():
        context.run_migrations()


async def run_async_migrations() -> None:
    config.set_main_option("sqlalchemy.url", settings.database_url)
    connectable = async_engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    async with connectable.connect() as connection:
        await connection.run_sync(do_run_migrations)
    await connectable.dispose()


if context.is_offline_mode():
    run_migrations_offline()
else:
    asyncio.run(run_async_migrations())
```

> **`from app.db.base import Base` is the whole game.** Alembic autogenerate compares
> `Base.metadata` against the live database. A model class only registers itself in
> that metadata when its module is *imported*. Import nothing, and autogenerate
> cheerfully produces an empty migration — or, worse, one that drops the tables it
> cannot see. Phase 2 makes `app/db/base.py` import all 15 models for this reason,
> with a `# noqa: F401` because they look unused to a linter and are not.

### The commands

```bash
uv run alembic revision --autogenerate -m "create core schema"   # generate
uv run alembic upgrade head                                       # apply
uv run alembic downgrade -1                                       # undo one
uv run alembic current                                            # what's applied
uv run alembic history --verbose                                  # the full chain
```

> **Always read the generated file before applying it.** Autogenerate is a diffing
> heuristic, not an oracle. It cannot see triggers, views, functions, RLS policies, or
> `CHECK` constraints written in raw SQL — and it renders a column *rename* as
> `drop_column` + `add_column`, which is data loss that passes review because the
> migration "looks right." Treat the output as a draft you are responsible for.

---

## 1.11 Pre-commit

```yaml
repos:
  - repo: https://github.com/pre-commit/pre-commit-hooks
    rev: v5.0.0
    hooks:
      - id: trailing-whitespace
      - id: end-of-file-fixer
      - id: check-yaml
      - id: check-toml
      - id: check-merge-conflict
      - id: check-added-large-files
        args: [--maxkb=1024]
      - id: detect-private-key

  - repo: https://github.com/astral-sh/ruff-pre-commit
    rev: v0.9.6
    hooks:
      - id: ruff
        args: [--fix]
        files: ^backend/
      - id: ruff-format
        files: ^backend/

  - repo: https://github.com/rbubley/mirrors-prettier
    rev: v3.4.2
    hooks:
      - id: prettier
        files: ^frontend/src/
```

```bash
uv run pre-commit install
uv run pre-commit run --all-files      # once, to normalise the existing tree
```

Two fixes to the current config. The **hook list must be a list of mappings**, not
bare strings — `hooks: [trailing-whitespace, ...]` fails to parse. And
`pre-commit/mirrors-prettier` is **archived**; `rbubley/mirrors-prettier` is the
maintained fork.

`detect-private-key` and `check-added-large-files` are the two that earn their place.
The first stops a `.pem` reaching a public repository; the second stops a 200 MB file
entering history, where it stays forever even after deletion.

---

## 1.12 Continuous integration

### `.github/workflows/backend-ci.yml`

```yaml
name: Backend CI

on:
  push: { paths: ["backend/**", ".github/workflows/backend-ci.yml"] }
  pull_request: { paths: ["backend/**", ".github/workflows/backend-ci.yml"] }

concurrency:
  group: backend-${{ github.ref }}
  cancel-in-progress: true

jobs:
  test:
    runs-on: ubuntu-latest

    services:
      postgres:
        image: postgres:16-alpine
        env:
          POSTGRES_USER: neurovault
          POSTGRES_PASSWORD: testpassword
          POSTGRES_DB: neurovault_test
        ports: ["5432:5432"]
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5

    env:
      DATABASE_URL: postgresql+asyncpg://neurovault:testpassword@localhost:5432/neurovault_test
      DATABASE_URL_SYNC: postgresql://neurovault:testpassword@localhost:5432/neurovault_test
      SUPABASE_URL: https://test.supabase.co
      SUPABASE_ANON_KEY: test-anon-key
      SUPABASE_SERVICE_ROLE_KEY: test-service-role-key
      SUPABASE_JWT_SECRET: test-jwt-secret-that-is-at-least-32-chars-long
      ALLOWED_ORIGINS: http://localhost:3000,https://neurovault.example.com
      ENVIRONMENT: test
      DEBUG: "false"

    defaults:
      run:
        working-directory: backend

    steps:
      - uses: actions/checkout@v4

      - uses: astral-sh/setup-uv@v5
        with:
          enable-cache: true
          cache-dependency-glob: backend/uv.lock

      - run: uv sync --frozen

      - name: Lint
        run: uv run ruff check .

      - name: Format check
        run: uv run ruff format --check .

      - name: Type check
        run: uv run pyright

      - name: Migrations apply cleanly
        run: uv run alembic upgrade head

      - name: Migrations reverse cleanly
        run: uv run alembic downgrade base

      - name: Re-apply for tests
        run: uv run alembic upgrade head

      - name: Tests
        run: uv run pytest --cov=app --cov-report=term-missing
```

Six things here that the current workflow does not do:

1. **`ALLOWED_ORIGINS` is set, with two comma-separated values.** The bug in §1.5 was
   invisible precisely because CI never set this variable. A CI environment that
   differs from production in the exact variable that breaks production is worse than
   no CI, because it manufactures confidence. **Test the config, not just the code.**
2. **`downgrade base` then `upgrade head`.** This proves every migration is reversible.
   A `downgrade()` that has never run is a `downgrade()` that does not work, and you
   discover that at the moment you most need to roll back.
3. **`defaults.run.working-directory`** — declared once instead of on all nine steps.
4. **`env` at job level** — declared once instead of duplicated per step, where the two
   copies drift.
5. **`concurrency` with `cancel-in-progress`** — a new push cancels the stale run.
6. **`ruff format --check`** — formatting is verified, not merely fixable locally.

### `.github/workflows/frontend-ci.yml`

```yaml
name: Frontend CI

on:
  push: { paths: ["frontend/**", ".github/workflows/frontend-ci.yml"] }
  pull_request: { paths: ["frontend/**", ".github/workflows/frontend-ci.yml"] }

concurrency:
  group: frontend-${{ github.ref }}
  cancel-in-progress: true

jobs:
  test:
    runs-on: ubuntu-latest

    defaults:
      run:
        working-directory: frontend

    steps:
      - uses: actions/checkout@v4

      # Reads the version from package.json "packageManager". Without that field
      # this step installs nothing and `pnpm install` fails with "pnpm not found".
      - uses: pnpm/action-setup@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
          cache-dependency-path: frontend/pnpm-lock.yaml

      - run: pnpm install --frozen-lockfile

      - name: Type check
        run: pnpm type-check

      - name: Lint
        run: pnpm lint

      - name: Tests
        run: pnpm test

      - name: Build
        run: pnpm build
        env:
          NEXT_PUBLIC_SUPABASE_URL: https://test.supabase.co
          NEXT_PUBLIC_SUPABASE_ANON_KEY: test-anon-key
          NEXT_PUBLIC_API_URL: http://localhost:8000
```

`--frozen-lockfile` fails the build if `package.json` and `pnpm-lock.yaml` disagree,
rather than silently resolving to something nobody tested. That is what makes a
lockfile mean anything.

---

## 1.13 Verification

Do not tick these off by reading. Run them.

```bash
# ── The .gitignore fix actually took effect ───────────────────────────────────
git ls-files frontend/src/lib/          # must list utils.ts
git check-ignore -v frontend/src/lib/utils.ts   # must exit 1 (not ignored)

# ── A clean clone builds — the test that catches what a working copy hides ────
git archive HEAD | (mkdir -p /tmp/nv-clean && tar -x -C /tmp/nv-clean)
cd /tmp/nv-clean/frontend && pnpm install && pnpm type-check   # must exit 0

# ── Backend ───────────────────────────────────────────────────────────────────
cd backend
uv sync
uv run ruff check . && uv run ruff format --check .
uv run pyright
uv run python -c "from app.core.config import settings; print(settings.allowed_origins)"
#   → ['http://localhost:3000']   (a crash here means the ALLOWED_ORIGINS fix is wrong)

# ── The whole thing ───────────────────────────────────────────────────────────
docker compose up --build
curl -fsS http://localhost:8000/health     # {"status":"ok","version":"0.1.0"}
open http://localhost:8000/docs
open http://localhost:3000

# ── psql works with the documented string ─────────────────────────────────────
docker compose exec db psql -U neurovault -d neurovault -c '\conninfo'
```

**The `git archive` step is the one to keep.** It is the only check that catches
"works on my machine" *from* your machine, and it is how the `lib/` bug was found.
Run it before every submission.

---

## 1.14 What to know for the viva

**Q: Why Docker for a college project?**

"Reproducibility. The database version, the Python version, and the extensions are
declared in a file rather than installed by hand, so my teammate's environment and the
CI runner's are the same as mine. It also makes the demo safe — I bring the container,
not a list of prerequisites for a machine I have never seen."

**Q: What does `docker compose up` actually do here?**

"It starts PostgreSQL, waits for the healthcheck to report the server is accepting
connections, runs `alembic upgrade head` to completion, and only then starts the API.
The dependency is on the *migration finishing*, not on the container existing, so the
API can never start against a schema that is not there yet."

**Q: Why not commit the `.env` file — nobody can see the repository anyway.**

"Two reasons. Repository visibility changes with one click, and history is permanent —
a secret committed once stays in every clone even after it is deleted, so rotation is
the only real remedy. And `.env.example` documents the *shape* of the configuration,
which is what a new developer actually needs; the values are theirs, not mine."

**Q: Your CI passed while the application could not start. How?**

"CI never set `ALLOWED_ORIGINS`, so the code path that crashed was never executed. It
is the clearest lesson in the project: a green pipeline means the things you tested
work, and nothing more. I fixed it by setting every production variable in CI, with a
comma-separated value, so the parsing path production uses is the path CI exercises."

---

**Next:** [`02-DATABASE.md`](02-DATABASE.md) — the 15 tables, the normalization proofs,
and the first migration.
