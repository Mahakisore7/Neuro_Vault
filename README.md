# NeuroVault

A personal knowledge base whose defining idea is that **notes form a graph**, not just a
tree of folders. Most note apps give you folders and tags — a hierarchy and a set.
NeuroVault's schema also models a third structure: an explicit, typed, directed edge
between any two notes, stored in a self-referencing many-to-many table that PostgreSQL
can traverse recursively.

Built as a DBMS course project. The point isn't a big feature list — it's a schema where
the database does real work: generated columns, a trigger-driven version history, a
tenancy model enforced by composite foreign keys rather than application code, and (once
wired up) a recursive-CTE knowledge graph.

## Contents

- [What's actually built](#whats-actually-built)
- [Architecture](#architecture)
- [Database schema](#database-schema)
- [User flow](#user-flow)
- [API reference](#api-reference)
- [Project structure](#project-structure)
- [Getting started](#getting-started)
- [Documentation](#documentation)

---

## What's actually built

This README describes the system as it exists, not as it was originally scoped — see
[Documentation](#documentation) below for the full design and its history.

**Live — has an API and a UI:**

| Area | What you can do |
|---|---|
| Auth | Sign up / sign in with email+password, or Google / GitHub OAuth. Sessions are Supabase-issued JWTs, verified by the backend via JWKS (no shared secret — [ADR-018](docs/adr/0018-jwt-verification-via-jwks.md)). |
| Profile | Display name, bio, avatar upload (Supabase Storage), sign out. |
| Workspaces & notebooks | Create, rename, color-code, delete. Deleting a workspace cascades; deleting a notebook un-files its notes instead of deleting them. |
| Notes | Rich-text editing (Tiptap: headings, bold/italic/underline/strike, highlight, lists, task lists, quotes, code, links), autosave 1.5s after you stop typing, pin, archive, public/private toggle. |
| Unfiled notes | A dedicated view for notes with no notebook — including any left behind by a notebook delete. |
| Version history | Every real edit is versioned automatically by a database trigger, not application code. Restore any version from the UI; restoring is itself versioned, so you can always undo an undo. |
| Tags | Create, color-code, attach to and remove from notes. |
| Theme | Light / dark / system, persisted. |

**Modeled and migrated, not yet exposed** — the schema, constraints, and indexes exist and
are live in the database; nothing calls them yet:

| Area | What exists |
|---|---|
| Knowledge graph | `knowledge_links` + `relationship_types` — the self-referencing graph this project is named for. Security model (you can only originate a link from a note you own) is designed in [ADR-007](docs/adr/0007-links-originate-from-owned-notes.md). |
| Full-text search | `notes.search_vector`, a `GENERATED`, GIN-indexed `tsvector` — maintained by Postgres on every write, queried by nothing yet. |
| Collections | Ordered, curated note groupings, distinct from a notebook (a note lives in one notebook but many collections). |
| Flashcards | SM-2 spaced-repetition fields, already encoding the algorithm's own bounds as `CHECK` constraints. |
| Resources | Attachments (PDF/link/video/image/audio) — metadata only; the file itself would go straight to object storage. |
| Activity log & notifications | Append-only audit trail and a notification bell, both driven by triggers that don't exist yet. |

---

## Architecture

```mermaid
flowchart TB
    subgraph Browser["Browser — Next.js 16 (App Router, React 19)"]
        UI["TanStack Query (server state)<br/>Tiptap (editor) · shadcn/ui + Tailwind v4<br/>next-themes · react-hook-form + zod"]
    end

    subgraph Supabase["Supabase"]
        Auth["Auth<br/>email/password + Google/GitHub OAuth<br/>issues ES256-signed JWTs"]
        Storage["Storage<br/>'avatars' bucket, RLS-scoped"]
    end

    subgraph Backend["FastAPI — Python 3.12, layered"]
        Route["api/v1/endpoints/*<br/>validate input, map errors to status codes"]
        Service["services/*<br/>authorization + business rules"]
        Repo["repositories/*<br/>SQLAlchemy (async) — nothing else"]
        Route --> Service --> Repo
    end

    PG[("PostgreSQL<br/>15 tables · generated columns<br/>triggers · stored procedures<br/>Alembic-versioned")]

    UI -- "supabase-js: sign in,<br/>session refresh, avatar upload" --> Auth
    UI -- "supabase-js: upload" --> Storage
    UI -- "HTTPS /api/v1/*<br/>Authorization: Bearer &lt;JWT&gt;" --> Route
    Service -. "verify signature via JWKS<br/>(PyJWKClient, cached — ADR-018)" .-> Auth
    Repo -- "asyncpg" --> PG
```

**Why the frontend talks to Supabase directly for identity but to FastAPI for
everything else:** Supabase Auth owns password hashing, OAuth redirects, and token
refresh — all easy to get subtly wrong by hand. FastAPI owns the domain: authorization
rules, the layered Route → Service → Repository structure, and (once built) the recursive
graph queries. The JWT is the handoff between the two: FastAPI never sees a password, and
Supabase never sees a note.

There are deliberately no `/auth/login` or `/auth/signup` routes on the backend. A new
Supabase account is synced into the app's own `users` table by a Postgres trigger
(`AFTER INSERT ON auth.users`, [ADR-017](docs/adr/0017-auth-users-trigger-not-webhook.md)),
not a webhook and not a lazy first-request check — both were tried and replaced.

### Tech stack

| Layer | Choice |
|---|---|
| Frontend | Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS v4 |
| UI components | shadcn/ui + Radix primitives, Tiptap v3 (editor), lucide icons |
| Frontend state | TanStack Query for all server state; local `useState` for UI-only state — no global store |
| Backend | FastAPI, Python 3.12, Pydantic v2, `uv` for packaging |
| Database access | SQLAlchemy 2.0 (async) + `asyncpg`, Alembic migrations |
| Auth | Supabase Auth, verified backend-side via JWKS / ES256 (`PyJWKClient`) |
| Database | PostgreSQL — a Supabase project in this build ([ADR-012](docs/adr/0012-local-postgres-dev-supabase-prod.md), [ADR-014](docs/adr/0014-direct-supabase-dev-solo.md)); `docker-compose.yml` provisions an equivalent local Postgres 16 for an offline dev path |

---

## Database schema

All 15 tables, as actually migrated. `PK` = primary key, `FK` = foreign key, `UK` = unique
constraint. Every relationship into `notes`, `notebooks`, `note_tags`, and
`collection_items` is enforced by a **composite foreign key** that carries an owner or
creator column alongside the "real" reference — cross-tenant writes aren't caught by
application code, they're rows PostgreSQL physically refuses to store
([ADR-001](docs/adr/0001-tenancy-composite-foreign-keys.md)).

```mermaid
erDiagram
    USERS {
        uuid id PK "Supabase JWT sub claim, no DEFAULT"
        citext email UK
        varchar display_name
        text avatar_url
        text bio
        timestamptz last_seen_at
    }
    WORKSPACES {
        uuid id PK
        uuid owner_id FK "-> USERS.id, CASCADE"
        varchar name
        varchar slug UK "unique per owner"
        text description
    }
    NOTEBOOKS {
        uuid id PK
        uuid workspace_id FK "composite w/ owner_id"
        uuid owner_id FK "denormalized on purpose"
        varchar name
        varchar color
    }
    NOTES {
        uuid id PK
        uuid creator_id FK "-> USERS.id, CASCADE"
        uuid notebook_id FK "nullable; composite w/ creator_id"
        varchar title
        text content
        boolean is_public
        boolean pinned
        boolean archived
        integer word_count "GENERATED ALWAYS STORED"
        tsvector search_vector "GENERATED, GIN-indexed"
    }
    NOTE_VERSIONS {
        uuid id PK
        uuid note_id FK "-> NOTES.id, CASCADE"
        integer version_num "UNIQUE with note_id"
        varchar title
        text content
        uuid edited_by FK "-> USERS.id, SET NULL"
    }
    RELATIONSHIP_TYPES {
        smallint id PK
        varchar name UK "seeded vocabulary"
        varchar color
        boolean is_symmetric
    }
    KNOWLEDGE_LINKS {
        uuid id PK
        uuid source_note_id FK "composite w/ created_by"
        uuid target_note_id FK "-> NOTES.id, CASCADE"
        smallint rel_type_id FK "-> RELATIONSHIP_TYPES.id, RESTRICT"
        uuid created_by FK
        smallint strength "CHECK 1-10"
        varchar origin "manual / wiki / ai"
    }
    TAGS {
        integer id PK "IDENTITY, not UUID"
        uuid user_id FK "-> USERS.id, CASCADE"
        varchar name
        varchar slug UK "unique per user"
        varchar color
    }
    NOTE_TAGS {
        uuid note_id PK "also FK, composite -> NOTES"
        integer tag_id PK "also FK, composite -> TAGS"
        uuid owner_id FK "checked on both sides"
    }
    COLLECTIONS {
        uuid id PK
        uuid user_id FK "-> USERS.id, CASCADE"
        varchar name UK "unique per user"
        boolean is_public
    }
    COLLECTION_ITEMS {
        uuid collection_id PK "also FK, composite"
        uuid note_id PK "also FK, composite"
        uuid owner_id FK
        integer position
    }
    FLASHCARDS {
        uuid id PK
        uuid note_id FK "composite w/ owner_id"
        uuid owner_id FK
        text question
        text answer
        numeric ease_factor "SM-2, CHECK 1.30-2.50"
        integer interval_days
        timestamptz due_at
    }
    RESOURCES {
        uuid id PK
        uuid note_id FK "composite w/ owner_id"
        uuid owner_id FK
        varchar resource_type "pdf/link/video/image/audio"
        varchar title
        text url
    }
    ACTIVITY_LOGS {
        bigint id PK "IDENTITY, append-only"
        uuid user_id FK "-> USERS.id, SET NULL"
        varchar action_type
        varchar entity_type
        jsonb metadata
    }
    NOTIFICATIONS {
        bigint id PK "IDENTITY"
        uuid user_id FK "-> USERS.id, CASCADE"
        varchar type
        varchar title
        boolean is_read
    }

    USERS ||--o{ WORKSPACES        : owns
    USERS ||--o{ NOTES             : creates
    USERS ||--o{ TAGS              : owns
    USERS ||--o{ COLLECTIONS       : owns
    USERS ||--o{ ACTIVITY_LOGS     : "acted (SET NULL)"
    USERS ||--o{ NOTIFICATIONS     : receives
    USERS ||--o{ NOTE_VERSIONS     : "edited (SET NULL)"
    WORKSPACES ||--o{ NOTEBOOKS    : "contains (composite FK)"
    NOTEBOOKS  |o--o{ NOTES        : "files (SET NULL notebook_id only)"
    NOTES ||--o{ NOTE_VERSIONS     : "history of (CASCADE)"
    NOTES ||--o{ FLASHCARDS        : "generates (composite FK)"
    NOTES ||--o{ RESOURCES         : "attaches (composite FK)"
    NOTES ||--o{ KNOWLEDGE_LINKS   : "is source of (composite w/ created_by)"
    NOTES ||--o{ KNOWLEDGE_LINKS   : "is target of (plain FK)"
    RELATIONSHIP_TYPES ||--o{ KNOWLEDGE_LINKS : "classifies (RESTRICT)"
    NOTES ||--o{ NOTE_TAGS         : "tagged via (composite FK)"
    TAGS  ||--o{ NOTE_TAGS         : "labels via (composite FK)"
    NOTES ||--o{ COLLECTION_ITEMS  : "grouped via (composite FK)"
    COLLECTIONS ||--o{ COLLECTION_ITEMS : "contains (composite FK)"
```

**The two `NOTES ||--o{ KNOWLEDGE_LINKS` lines together are the whole graph design.**
`knowledge_links` is a self-referencing many-to-many junction on `notes` — two foreign
keys, both ultimately pointing back at the same table, deliberately asymmetric: the
source side is a composite FK requiring `created_by` (you can only originate an edge from
a note you own), the target side is a plain FK (you may point at any note you can read,
including someone else's public one).

**What Postgres does on its own**, live today, that no application code triggers:

- `notes.word_count` and `notes.search_vector` — `GENERATED ALWAYS ... STORED` columns,
  recomputed on every write.
- `fn_create_note_version()` — `BEFORE UPDATE ON notes`, snapshots the *prior* title and
  content into `note_versions` whenever either actually changed.
- `sp_rollback_note_version(...)` — a stored procedure that restores an old version via an
  ordinary `UPDATE`, so the rollback itself fires the versioning trigger too.
- `handle_new_auth_user()` — `AFTER INSERT ON auth.users`, mirrors a new Supabase account
  into `public.users`.

---

## User flow

```mermaid
flowchart TD
    Start(["Visitor"]) --> HasSession{"Signed in?"}
    HasSession -- No --> AuthChoice["/login or /signup"]
    AuthChoice -- "email + password" --> Session
    AuthChoice -- "Google / GitHub" --> Callback["/auth/callback<br/>exchanges the OAuth code"]
    Callback --> Session["Supabase issues a JWT session"]
    Session --> Sync["Trigger mirrors the account<br/>into public.users"]
    HasSession -- Yes --> Workspaces
    Sync --> Workspaces["/workspaces"]

    Workspaces -- "create" --> WsDetail
    Workspaces -- "open" --> WsDetail["notebooks in this workspace"]
    WsDetail -- "create" --> NbDetail
    WsDetail -- "open" --> NbDetail["notes in this notebook"]
    NbDetail -- "create or open" --> Editor["Tiptap editor"]

    Editor --> Autosave["stop typing 1.5s<br/>-> PATCH /notes/{id}"]
    Autosave --> Trigger["trigger snapshots<br/>the prior version"]
    Editor --> History["Version history -> Restore"]
    History --> Trigger
    Editor --> Tags["attach / remove tags"]

    Workspaces -.-> Unfiled["/unfiled<br/>notes with no notebook"]
    Workspaces -.-> TagsPage["/tags<br/>manage tags"]
    Workspaces -.-> Profile["/profile<br/>avatar, bio, theme, sign out"]
```

Deleting a notebook doesn't delete its notes — they fall through to `/unfiled`, reachable
from the sidebar at any time, which is the only reason that page exists.

---

## API reference

All routes are under `/api/v1`, authenticated with `Authorization: Bearer <Supabase JWT>`.
Interactive docs (`/docs`) are available when running outside production.

| Resource | Method | Path | Notes |
|---|---|---|---|
| Users | `GET` | `/users/me` | current user's profile |
| | `PATCH` | `/users/me` | update display name / bio / avatar URL |
| Workspaces | `GET` | `/workspaces` | list your workspaces |
| | `POST` | `/workspaces` | create |
| | `GET` | `/workspaces/{id}` | |
| | `PATCH` | `/workspaces/{id}` | |
| | `DELETE` | `/workspaces/{id}` | cascades to its notebooks and notes |
| Notebooks | `GET` | `/notebooks?workspace_id=` | |
| | `POST` | `/notebooks` | |
| | `GET` | `/notebooks/{id}` | |
| | `PATCH` | `/notebooks/{id}` | |
| | `DELETE` | `/notebooks/{id}` | its notes become unfiled, not deleted |
| Notes | `GET` | `/notes?notebook_id=&unfiled=&archived=` | |
| | `POST` | `/notes` | |
| | `GET` | `/notes/{id}` | |
| | `PATCH` | `/notes/{id}` | a real title/content change is auto-versioned |
| | `DELETE` | `/notes/{id}` | archives; does not hard-delete |
| Note versions | `GET` | `/notes/{id}/versions` | owner-only |
| | `POST` | `/notes/{id}/versions/{version_num}/rollback` | itself creates a new version |
| Note tags | `GET` | `/notes/{id}/tags` | |
| | `POST` | `/notes/{id}/tags/{tag_id}` | attach; idempotent |
| | `DELETE` | `/notes/{id}/tags/{tag_id}` | detach |
| Tags | `GET` | `/tags` | |
| | `POST` | `/tags` | |
| | `PATCH` | `/tags/{id}` | |
| | `DELETE` | `/tags/{id}` | |

---

## Project structure

```
Neuro_Vault/
├── backend/                 FastAPI, Python 3.12, uv
│   ├── app/
│   │   ├── api/v1/endpoints/    routes — validate input, call a service, return a status
│   │   ├── services/            authorization + business rules, no SQLAlchemy
│   │   ├── repositories/        SQLAlchemy queries, nothing else
│   │   ├── models/               ORM models — the 15-table schema
│   │   ├── schemas/              Pydantic request/response shapes
│   │   └── core/                 config, JWT verification, exceptions
│   └── alembic/versions/        every schema/trigger/procedure change, versioned
├── frontend/                Next.js 16, React 19, TypeScript
│   └── src/
│       ├── app/                  App Router pages
│       ├── components/           editor, layout, ui (shadcn), notes
│       └── hooks/                TanStack Query hooks, one per resource
├── docs/
│   ├── adr/                      19 Architecture Decision Records
│   ├── phases/New/               the full original design (architecture, schema, API, viva prep)
│   └── session-log-2026-08-16.md build diary: what broke, why, and how it was fixed
└── docker-compose.yml        local Postgres + migrate + backend, for an offline dev path
```

---

## Getting started

**Prerequisites:** Node 20+, [pnpm](https://pnpm.io), Python 3.12+,
[uv](https://docs.astral.sh/uv/), and a PostgreSQL database — either a
[Supabase](https://supabase.com) project (recommended; this is what the app is built and
tested against) or the local Postgres the included `docker-compose.yml` provisions.

1. **Configure environment variables.**
   ```
   cp .env.example .env
   cp frontend/.env.example frontend/.env.local
   ```
   Fill in your Supabase project's URL, anon key, and a Postgres connection string (root
   `.env`) — see the comments in each `.env.example` for what's sensitive and what isn't.

2. **Run the database migrations.**
   ```
   cd backend
   uv sync
   uv run alembic upgrade head
   ```

3. **Start the backend.**
   ```
   uv run uvicorn app.main:app --reload
   ```
   API at `http://localhost:8000`, interactive docs at `http://localhost:8000/docs`.

4. **Start the frontend**, in a separate terminal:
   ```
   cd frontend
   pnpm install
   pnpm dev
   ```
   App at `http://localhost:3000`.

**Alternative:** `docker compose up` provisions a local Postgres, runs migrations, and
starts the backend in one step (still start the frontend separately with `pnpm dev`).

---

## Documentation

- **[`docs/adr/`](docs/adr/)** — 19 Architecture Decision Records. Each one records a
  problem, the alternatives considered, what was chosen, and the trade-off — the answers
  to "why did you do it that way?"
- **[`docs/phases/New/`](docs/phases/New/)** — the full original design: architecture,
  schema rationale, the SQL layer (triggers/views/procedures), API contract, frontend
  plan, and a schema/ER/user-flow diagram set.
- **[`docs/session-log-2026-08-16.md`](docs/session-log-2026-08-16.md)** — a build diary:
  what got built, what broke, how each bug was actually diagnosed and fixed.

## License

[Apache 2.0](LICENSE)
