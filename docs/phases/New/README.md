# NeuroVault — Build Guide

**A Personal Knowledge Graph Database.**
22AIE303 DBMS · Amrita Vishwa Vidyapeetham · Team of 2

> Notes are **nodes**. Connections between notes are **typed, weighted, directed edges**
> stored in a self-referencing many-to-many table. The graph is traversed in PostgreSQL
> with `WITH RECURSIVE` CTEs and rendered as an interactive canvas.

---

## Read this first

This document set **replaces** `docs/phases/`. The old set was written across three
generations (original design → Supabase retrofit → bug-fix layer) and the earlier
layers were never rewritten, so it contradicted itself in ~10 places and contained
4 defects that stopped the project from running at all.

This set has **one generation**. When something changes, the doc that describes it
changes — no patch files, no "Phase 12B fixes Phase 3" chains.

**Rules for this doc set:**

1. **One source of truth per fact.** If two docs would say it, one doc says it and the other links.
2. **All code here is runnable as written.** No pseudo-code, no "same pattern as above".
3. **Every non-obvious decision has a recorded reason** in [`00-ARCHITECTURE.md`](00-ARCHITECTURE.md) → Decision Records.
4. **Don't skip a phase.** Each builds on the one before.

---

## Tech stack (verified against installed versions)

```
Frontend    Next.js 16.2.12 · React 19.2.4 · TypeScript strict
            Tailwind CSS v4 · shadcn/ui · TanStack Query v5 · Zustand
            React Hook Form + Zod · Tiptap v3 · Cytoscape.js · pnpm

Backend     FastAPI 0.141 · Python 3.12 · uv
            SQLAlchemy 2.0.51 async · asyncpg · Alembic
            Pydantic 2.13 · pydantic-settings 2.14 · PyJWT
            Ruff · pyright · pytest-asyncio

Database    PostgreSQL 16 (Supabase managed)
            15 tables · 4 views · 3 triggers · 3 procedures
            10 indexes (incl. GIN full-text) · WITH RECURSIVE traversal
            Everything versioned in Alembic migrations

Infra       Docker + Docker Compose · GitHub Actions
            Supabase (DB + Auth + Storage) · Upstash Redis · Sentry
            Render (deploy)
```

---

## The database at a glance — 15 tables

```
HIERARCHY          users → workspaces → notebooks → NOTES ← the centre
                   (tenancy enforced by composite foreign keys, see ADR-001)

THE GRAPH          notes ←── knowledge_links ──→ notes      (self-referencing M:N)
                                   ↓
                          relationship_types                (lookup)

NOTE ATTACHMENTS   notes → note_versions   (append-only history, trigger-written)
                   notes → flashcards      (Q&A cards)
                   notes → resources       (PDF / link / video)

M:N JUNCTIONS      notes ←── note_tags ──────→ tags
                   notes ←── collection_items → collections

AUDIT              users → activity_logs   (trigger-written)
                   users → notifications   (trigger-written)
```

**Not in the core build** — these are Feature Improvements, specified in
[`09-ROADMAP.md`](09-ROADMAP.md) with their schema deltas, built after the core ships:
collaborative editing (`note_editing_sessions` + lock columns), AI features
(`ai_link_suggestions`), desktop app (SQLite variant).

**Dropped from the original design:** `projects` — it had no relationships to any
other table, no API routes, no UI, and appeared in no query. See ADR-009.

---

## Build order

Each phase has a single doc. Do them in order.

| # | Doc | What you build | Hours |
|---|---|---|---|
| 0 | [`00-ARCHITECTURE.md`](00-ARCHITECTURE.md) | Understand the system + every decision | 1 |
| 1 | [`01-FOUNDATION.md`](01-FOUNDATION.md) | Repo, tooling, env, Docker, CI | 3 |
| 2 | [`02-DATABASE.md`](02-DATABASE.md) | 15 models, Alembic, seed data | 5 |
| 3 | [`03-SQL-LAYER.md`](03-SQL-LAYER.md) | Indexes, views, triggers, procedures, CTE, 15 queries | 6 |
| 4 | [`04-API.md`](04-API.md) | Schemas → repositories → services → routes | 6 |
| 5 | [`05-FRONTEND.md`](05-FRONTEND.md) | Auth, editor, graph canvas, all screens | 8 |
| 6 | [`06-QUALITY.md`](06-QUALITY.md) | pytest + Vitest + green CI | 4 |
| 7 | [`07-DEPLOY.md`](07-DEPLOY.md) | Live on a public URL | 3 |
| 8 | [`08-VIVA.md`](08-VIVA.md) | CO1–CO5 map, spoken answers, demo script | 2 |
| — | [`09-ROADMAP.md`](09-ROADMAP.md) | Feature improvements, after the core | — |
| — | [`SCHEMA-DIAGRAMS.md`](SCHEMA-DIAGRAMS.md) | ER diagram, physical schema diagram, user flow diagrams | — |

**~38 hours of focused work, split across two people.**

---

## What each phase actually does

### Phase 1 — Foundation

Get from `git clone` to a running app in under 15 minutes, on a machine that has
never seen this project.

You create the monorepo layout, a `.gitignore` that doesn't silently eat source
files, both `Dockerfile`s, `docker-compose.yml`, the `uv` and `pnpm` toolchains,
pre-commit hooks, and two GitHub Actions workflows that actually pass.

You also set up the three external accounts — Supabase (database + auth + storage),
Upstash (Redis), Sentry (errors) — and wire their credentials through a settings
object that fails loudly at startup if anything is missing or malformed.

**Two env vars, not one:** `DATABASE_URL` uses the `postgresql+asyncpg://` driver
for the application; `DATABASE_URL_SYNC` uses plain `postgresql://` for Alembic and
`psql`. Conflating them was a defect in the previous doc set — `psql` cannot parse
the `+asyncpg` suffix, so every schema command failed.

**Done when:** a fresh clone runs `docker compose up` successfully, `/health`
returns 200, `/docs` loads, `localhost:3000` renders, and both CI workflows are green.

### Phase 2 — Database schema

The 15 SQLAlchemy 2.0 models, the first Alembic migration, and seed data.

This is where the DBMS content starts, and it's the phase your grade depends on most.
Every table gets: why it exists, its keys, its constraints, and a **normalization
proof you can defend out loud** — including the two places we deliberately break 3NF
and why that is the right call.

The structural ideas you implement here:

- **Composite foreign keys carry tenancy down the hierarchy.** `notes` references
  `notebooks(id, owner_id)` as a *pair*, so "put my note in your notebook" is not a
  bug the application must prevent — it is a row the database refuses to store.
- **Generated columns replace derived-data triggers.** `word_count` and
  `search_vector` are `GENERATED ALWAYS AS ... STORED`, so they are correct on
  `INSERT` and `UPDATE` with one definition instead of a trigger plus a duplicate
  copy in Python.
- **Every Pydantic rule has a matching `CHECK`.** Pydantic gives the user a good
  error message; the constraint guarantees correctness against `psql`, the seed
  script, and any future client.

**Done when:** `alembic upgrade head` creates 15 tables + `alembic_version` on a
clean database, `alembic downgrade base` removes them cleanly, and the seed script
loads a demo graph.

### Phase 3 — SQL layer

The advanced SQL. All of it lives **inside Alembic migrations** via `op.execute()`,
not in loose `.sql` files run by hand — so it is versioned, reversible, present in
every test database automatically, and applied by one command.

You build:

- **10 indexes** — a GIN index on the generated `search_vector` column, partial
  indexes for unread notifications and active notes, and the three indexes on
  `knowledge_links` that make recursive traversal and wiki-link reconciliation fast
  instead of sequential. Each one gets an `EXPLAIN ANALYZE` before/after so you can
  *show* the plan change.
- **4 views** — per-note graph statistics, ranked search, user dashboard, orphan notes.
- **3 triggers** — auto-versioning on content change, notification when someone
  links your public note, and an activity log across INSERT/UPDATE/DELETE.
- **3 procedures/functions** — version rollback, maximum reachable graph depth,
  shortest path between two notes.
- **The recursive CTE**, with cycle prevention and depth limiting, traced iteration
  by iteration.
- **15 complex queries (Q1–Q15)** covering every CO1 construct — joins, aggregation,
  `HAVING`, scalar and correlated subqueries, `EXISTS`, `CASE`, non-recursive CTE,
  four window functions, `FILTER`, self-join, JSONB operators, and full-text ranking.

**Done when:** `\dv` shows 4 views, `\df` shows 6 routines (3 trigger functions +
3 callable procedures/functions), `\di` shows 10 indexes,
the trigger test proves a version row appears after an edit, and `EXPLAIN ANALYZE`
shows index scans rather than sequential scans.

### Phase 4 — Backend API

Route → Service → Repository → Database, with the boundary between each layer
enforced, not merely suggested.

- **Schemas** (Pydantic): the HTTP shape, separate from the database shape.
- **Repositories**: SQLAlchemy queries and nothing else. A generic
  `BaseRepository[T: Base]` gives you CRUD once and reuses it 15 times.
- **Services**: business logic, authorization, orchestration. No SQLAlchemy, no HTTP.
- **Routes**: validate, delegate, return status codes.

Auth verifies the Supabase-issued JWT and maps it to a local user row, auto-creating
on first login with a race guard. **Every endpoint is authorized** — the previous
doc set shipped four with no ownership check at all.

Redis caches the expensive recursive traversal. **Cache keys include the user ID**,
and authorization runs *before* the cache read — the previous design returned cached
notes to anyone who knew a UUID.

Notes also support `[[wiki-link]]` syntax — type `[[BCNF]]` and an edge to the note
titled "BCNF" is created with no dialog. This is what makes the graph worth looking at:
a manual-only linking flow produces a handful of edges nobody bothered to draw. The
reconciler that maintains these edges is origin-aware, so it never touches a
hand-created link to the same target.

**Done when:** every route in the contract returns the right status code for owner,
non-owner, and anonymous callers; `/docs` lists them all.

### Phase 5 — Frontend

Next.js App Router, all client-side, talking to the real backend.

Auth screens built on `supabase-js` directly (the `@supabase/auth-ui-react` package
the old docs used is archived by Supabase). A note editor with debounced auto-save
that visibly demonstrates the versioning trigger, plus `[[title]]` autocomplete for
building graph edges while writing instead of through a separate dialog. A Cytoscape.js
graph canvas driven by the recursive CTE. Search, workspaces, notebooks, collections,
flashcards, and a notification bell — every backend feature reachable from the UI.

**Done when:** login → create → edit → history → rollback → graph → search all work
end to end against the deployed backend.

### Phase 6 — Quality

pytest-asyncio against a real PostgreSQL container (triggers, CTEs, and GIN indexes
do not exist in SQLite, so the tests must use the real thing), Vitest for the
frontend, and CI that runs both on every push.

The most important test in the project: `test_update_creates_version` — proving a
database trigger fires by observing its side effect through the API.

**Done when:** `uv run pytest` and `pnpm test` both pass locally and in CI.

### Phase 7 — Deploy

Multi-stage Docker build, backend on Render, static frontend on Render, migrations
as a pre-deploy step. Production configuration differs from development in seven
specific ways, all listed.

**Done when:** the full flow works on a public URL and both teammates can use it.

### Phase 8 — Viva

The exam sheet. Every CO1–CO5 concept mapped to the exact file and line that
demonstrates it, the questions most likely to be asked with answers you can say out
loud, and a demo script that shows the interesting parts in the right order.

---

## Conventions

**Git.** Feature branches → PR → review → merge. Never commit to `main` directly.
Commit messages describe what the commit actually does — a message like
`feat: implement signup and login pages` for three one-line stubs is worse than no
message, because it makes the log untrustworthy.

**Migrations.** Never `ALTER TABLE` by hand. `alembic revision --autogenerate -m "..."`,
read the generated file, then `alembic upgrade head`. Autogenerate does not detect
triggers, views, or functions — write those into the migration with `op.execute()`
and their inverse in `downgrade()`.

**Secrets.** `.env.example` is committed with placeholder values. `.env` is never
committed. Production secrets live in the Render dashboard.

**Types.** `pyright` on the backend, `tsc --noEmit` on the frontend, both in CI.

---

## Definition of done — the whole project

```
Fresh clone → docker compose up → working app, no manual steps
15 tables + 4 views + 3 triggers + 3 routines + 10 indexes, all from `alembic upgrade head`
Recursive CTE returns the correct connected subgraph, using an index scan
Editing a note creates a version row without the application asking
Every endpoint authorized for owner / non-owner / anonymous
Both CI workflows green
Live on a public URL
Every claim in 08-VIVA.md resolves to real code
```
