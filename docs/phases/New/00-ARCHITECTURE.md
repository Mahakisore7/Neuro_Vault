# Phase 0 — Architecture & Decision Records

> Read this before writing any code. Every decision in every later phase traces back here.

---

## 0.1 What we are building

NeuroVault is a personal knowledge base whose defining idea is that **notes form a graph**.

Most note apps give you folders and tags — a tree and a set. NeuroVault adds the
third structure: an explicit, typed, directed edge between any two notes. "Linear
Algebra is a *prerequisite of* Machine Learning, strength 9." Those edges live in a
self-referencing many-to-many table, and PostgreSQL traverses them recursively.

That single design choice is what makes this a real DBMS project rather than CRUD
with extra steps.

---

## 0.2 System architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│ BROWSER — Next.js 16 (App Router, static export)                     │
│   TanStack Query (server state) · Zustand (UI state only)            │
│   Tiptap (editor) · Cytoscape.js (graph canvas) · shadcn/ui          │
└───────────┬──────────────────────────────────┬───────────────────────┘
            │ supabase-js                      │ HTTPS  /api/v1/*
            │ (login, storage)                 │ Authorization: Bearer <JWT>
            ▼                                  ▼
┌───────────────────────┐    ┌─────────────────────────────────────────┐
│ Supabase Auth         │    │ FastAPI 0.141 · Python 3.12 · Uvicorn   │
│ issues the JWT ───────┼───▶│   Route → Service → Repository → DB     │
│ Supabase Storage      │    │   CORS · JWT verify · request logging   │
└───────────────────────┘    └────┬─────────────────┬──────────────────┘
                                  │ asyncpg         │ redis
                                  ▼                 ▼
                    ┌──────────────────────┐  ┌──────────────┐
                    │ Supabase PostgreSQL  │  │ Upstash Redis│
                    │ 15 tables · 4 views  │  │ graph cache  │
                    │ 3 triggers · 10 idx  │  └──────────────┘
                    │ 3 routines · CTE     │
                    │ Alembic-versioned    │
                    └──────────────────────┘
```

**Why the frontend talks to Supabase directly for auth but to FastAPI for data:**
Supabase Auth owns identity — it handles password hashing, email verification, OAuth
redirects, and token refresh, all of which are easy to get subtly wrong. FastAPI owns
the domain, because that is where the graph logic, the authorization rules, and the
recursive queries live. The JWT is the handoff between them.

---

## 0.3 The layering rule

```
HTTP request
  │
  ▼
api/v1/endpoints/*.py    validate input, call a service, return a status code
  │                      NEVER: SQLAlchemy, business rules
  ▼
services/*.py            business logic, authorization, orchestration
  │                      NEVER: SQLAlchemy, HTTPException-free logic is preferred
  ▼
repositories/*.py        SQLAlchemy queries — and nothing else
  │
  ▼
PostgreSQL
```

This is not decoration. It is what makes the project testable: a service can be
tested with a fake repository, a repository can be tested against a real database,
and a route can be tested with both mocked. When a route reaches past the service
into SQLAlchemy, all three of those become impossible at once.

---

## 0.4 Request lifecycle — what happens when a user edits a note

Worth reading closely; it is the most likely viva question about the system as a whole.

1. The editor debounces 1.5 s after the last keystroke, then sends
   `PATCH /api/v1/notes/{id}` with the new content.
2. The Axios interceptor attaches the current Supabase access token.
3. FastAPI's `get_current_user` dependency verifies the JWT signature, extracts the
   `sub` claim, and loads (or auto-creates) the matching row in `users`.
4. `NoteService.update` loads the note, checks `note.creator_id == user.id`, and
   assigns the new content to the SQLAlchemy object. Nothing has been written yet.
5. The route returns. The `get_db` dependency calls `session.commit()`.
6. **Inside that commit**, PostgreSQL fires `trg_note_versioning` (BEFORE UPDATE):
   it sees `OLD.content IS DISTINCT FROM NEW.content`, computes the next version
   number, and inserts the *old* content into `note_versions`.
7. `trg_note_activity` (AFTER UPDATE) writes an `EDIT_NOTE` row into `activity_logs`.
8. The `word_count` and `search_vector` generated columns recompute automatically.
9. All of it is one transaction. If any trigger raises, the user's edit rolls back
   too — there is no state where the note changed but its history did not.

---

## 0.5 Authentication flow

```
1. User signs in through supabase-js in the browser
2. Supabase Auth returns an access token (JWT) + refresh token
3. Every API call carries  Authorization: Bearer <access_token>
4. FastAPI verifies the signature and the `authenticated` audience
5. The `sub` claim IS our users.id — the same UUID, not a mapping
6. First request from a new user auto-creates their row (IntegrityError-guarded
   for the case where two requests race)
```

There are deliberately **no** `/auth/signup` or `/auth/login` routes on the backend.
Rolling your own password storage when a managed provider is already in the stack is
a liability, not a feature.

**Storage note.** Because the browser holds the Supabase anon key, Row Level Security
is a real boundary and not a formality — see ADR-008.

---

## 0.6 Caching strategy

Only one thing is worth caching: the recursive graph traversal. It is the single
expensive query in the system; everything else is an indexed point lookup.

```
key    graph:{user_id}:{note_id}:{depth}
TTL    600 seconds
bust   on link create/delete, and on note archive, for BOTH endpoints of the edge
```

Two rules that the previous design got wrong and that you must not repeat:

1. **The user ID is part of the key.** A cache keyed only on note ID hands one user's
   data to another.
2. **Authorization runs before the cache read, not after the cache miss.** Putting the
   ownership check only on the miss path means a cache hit skips it entirely.

---

## 0.7 API contract

```
BASE   /api/v1          AUTH   Authorization: Bearer <supabase_jwt>

USERS           GET    /users/me
WORKSPACES      GET    /workspaces              POST   /workspaces
                PATCH  /workspaces/{id}         DELETE /workspaces/{id}
NOTEBOOKS       GET    /notebooks?workspace_id= POST   /notebooks
                DELETE /notebooks/{id}
NOTES           GET    /notes                   POST   /notes
                GET    /notes/{id}              PATCH  /notes/{id}
                DELETE /notes/{id}                     (archive, not hard delete)
                GET    /notes/{id}/versions
                POST   /notes/{id}/rollback?version=N
GRAPH           GET    /notes/{id}/graph?depth=      (Redis-cached)
                POST   /links                   DELETE /links/{id}
                GET    /notes/{id}/links
SEARCH          GET    /search?q=
TAGS            GET    /tags                    POST   /notes/{id}/tags
                DELETE /notes/{id}/tags/{tag_id}
COLLECTIONS     GET    /collections             POST   /collections
                POST   /collections/{cid}/notes/{nid}
                DELETE /collections/{cid}/notes/{nid}
FLASHCARDS      GET    /flashcards              POST   /flashcards
                POST   /flashcards/{id}/review   DELETE /flashcards/{id}
RESOURCES       GET    /notes/{id}/resources    POST   /notes/{id}/resources
                DELETE /resources/{id}
NOTIFICATIONS   GET    /notifications           PATCH  /notifications/{id}/read
                PATCH  /notifications/read-all
DASHBOARD       GET    /dashboard                      (reads v_user_dashboard)
```

There is no `POST /uploads/image` route. File bytes go **browser → Supabase Storage
directly** ([`07-DEPLOY.md`](07-DEPLOY.md) §7.5) — the backend never proxies them, so
there is nothing for the API to expose here; a client posts the resulting URL to
`POST /notes/{id}/resources` once the upload completes. The previous doc set listed a
proxy upload route here and never built it, which is exactly the kind of contract/code
drift this document set exists to prevent — see [`04-API.md`](04-API.md) §4.10 for the
route table kept in sync with the actual router.

`GET /users/me` — one path, used consistently in code and docs. The previous set had
the contract saying `/users/me` and the implementation using `/auth/me`.

---

# Decision Records

Each records the problem, what else we considered, what we chose, and what it costs.
These are the answers to "why did you do it that way?" — in a viva, in a code review,
and in six months when you have forgotten.

---

## ADR-001 — Tenancy enforced by composite foreign keys

**Problem.** A user must never be able to attach their note to another user's
notebook, tag it with another user's tag, or add it to another user's collection.

**Alternatives considered.**

| Option | Why not |
|---|---|
| Ownership check in each service method | Must be written correctly in *every* endpoint forever. The previous design shipped four endpoints with no check at all — this failure mode is not hypothetical. |
| A `BEFORE INSERT` trigger per junction table | Works, but it is imperative logic scattered across many triggers, and it costs a query per write. |
| PostgreSQL Row Level Security only | Right for direct client access (we use it too, ADR-008), but our backend connects as an owner role that bypasses RLS, so it protects the wrong path. |

**Chosen.** Carry `owner_id` down the hierarchy and constrain on the pair.

```sql
workspaces  UNIQUE (id, owner_id)
notebooks   FOREIGN KEY (workspace_id, owner_id) REFERENCES workspaces (id, owner_id)
notes       FOREIGN KEY (notebook_id, creator_id) REFERENCES notebooks (id, owner_id)
note_tags   FOREIGN KEY (note_id, owner_id) REFERENCES notes (id, creator_id)
            FOREIGN KEY (tag_id,  owner_id) REFERENCES tags  (id, user_id)
```

**Trade-offs.** One redundant column per level, and `notebooks` is no longer in 3NF
(`owner_id` is transitively determined through `workspace_id`). We accept that
knowingly: the redundancy is maintained *by the database*, so it cannot diverge —
unlike a rule maintained by application code, which diverges the first time someone
forgets. Service-layer checks remain, for good error messages; the constraint is what
makes them unnecessary for correctness.

**Industry practice.** Standard multi-tenant integrity pattern in PostgreSQL. Pushing
the tenant key down and constraining on it is how Stripe- and Shopify-scale systems
avoid relying on every code path being correct.

**Learning note.** The general principle: *prefer making bad states unrepresentable
over detecting them.* A check you can forget to write is weaker than a shape that
cannot hold the bad value.

---

## ADR-002 — `word_count` and `search_vector` as generated columns

**Problem.** Both are derived from `content`. Derived data must stay in sync.

**Alternatives considered.**

| Option | Why not |
|---|---|
| Compute on every read | `array_length(regexp_split_to_array(...))` across thousands of rows per dashboard load. |
| Keep in sync with a trigger | This is what the previous design did — and because the trigger only fired on `UPDATE`, the `INSERT` path needed a *second* implementation in Python. The two drifted the moment HTML content arrived, and a later doc had to patch both. |

**Chosen.** `GENERATED ALWAYS AS (...) STORED`, computed by PostgreSQL on every write.

```sql
word_count    INTEGER  GENERATED ALWAYS AS (...) STORED
search_vector tsvector GENERATED ALWAYS AS (
    setweight(to_tsvector('english', COALESCE(title,'')), 'A') ||
    setweight(to_tsvector('english',
        COALESCE(regexp_replace(content,'<[^>]+>',' ','g'),'')), 'B')) STORED
```

Legal because every function involved (`to_tsvector(regconfig,text)`, `setweight`,
`regexp_replace`, `||`) is `IMMUTABLE`, which generated columns require.

**Trade-offs.** Recomputed on every write, and a generated column cannot be updated
directly. For a note app — human-speed writes, hot reads — that is the right side of
the trade.

**This also eliminates a whole defect class.** The GIN index is built on
`search_vector`; the search query filters on `search_vector`. Because both name the
same column, they cannot drift apart. In the previous design the index expression and
the query expression were different, so the index was never used and nobody noticed.

**Learning note.** When you find yourself fixing the same bug in two places, the bug
is that there are two places.

---

## ADR-003 — All SQL objects live in Alembic migrations

**Problem.** Triggers, views, and stored procedures need to exist in every database:
local, CI, and production.

**Alternatives considered.** Loose `.sql` files applied by hand with `psql` — the
previous design's approach. It produced three separate failures: the files were
unversioned and unreversible; test databases created by `Base.metadata.create_all`
had no triggers, so the trigger test could not pass; and the documented command
(`psql "$DATABASE_URL"`) could not run at all, because `DATABASE_URL` carries the
`+asyncpg` driver suffix that `psql` cannot parse.

**Chosen.** Every SQL object is created inside a migration and dropped in `downgrade()`.

```python
def upgrade() -> None:
    op.create_table("notes", ...)
    op.execute("""CREATE OR REPLACE FUNCTION fn_save_note_version() ...""")
    op.execute("""CREATE TRIGGER trg_note_versioning ...""")

def downgrade() -> None:
    op.execute("DROP TRIGGER IF EXISTS trg_note_versioning ON notes")
    op.execute("DROP FUNCTION IF EXISTS fn_save_note_version()")
    op.drop_table("notes")
```

**Trade-offs.** `--autogenerate` does not detect triggers, views, or functions, so
those are hand-written into the migration. That is a real cost, and it is the correct
one: it makes the schema a single versioned artifact.

**Learning note.** A trigger *is* schema. Anything that changes how the database
behaves belongs in the same version history as the tables.

---

## ADR-004 — Two database URLs

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

---

## ADR-005 — `ALLOWED_ORIGINS` parsing

**Problem.** pydantic-settings JSON-decodes complex types from environment variables
*before* validators run. `ALLOWED_ORIGINS=http://localhost:3000` therefore raises
`SettingsError` at import time and the backend never starts. The previous doc set
shipped exactly that value in `.env.example` and instructed you to set it in
production too.

**Chosen.** Opt out of the JSON decoding, then split on commas.

```python
from typing import Annotated
from pydantic_settings import NoDecode

allowed_origins: Annotated[list[str], NoDecode] = ["http://localhost:3000"]

@field_validator("allowed_origins", mode="before")
@classmethod
def _split_origins(cls, v: str | list[str]) -> list[str]:
    if isinstance(v, str):
        return [o.strip() for o in v.split(",") if o.strip()]
    return v
```

Verified against pydantic-settings 2.14.2.

**Learning note.** Configuration bugs are the ones that reach production, because
config is the part that differs between environments and therefore the part your
tests do not cover. Parse and validate it at startup so failure is loud and early.

---

## ADR-006 — PyJWT instead of python-jose

**Problem.** Verify Supabase-issued JWTs.

**Chosen.** `PyJWT`. `python-jose` is effectively unmaintained and has a history of
algorithm-confusion CVEs. PyJWT is actively maintained and is what the Supabase Python
ecosystem uses.

**Note on the verification method.** We verify with the shared HS256 secret today
because that is what our Supabase project issues. Supabase is moving to asymmetric
signing keys with JWKS; when we migrate, only `core/security.py` changes. The previous
doc set *claimed* JWKS verification while the code used the shared secret — the claim
and the code are kept in sync here.

---

## ADR-007 — Links originate from notes you own

**Problem.** Who may create an edge, and between whose notes?

**Chosen.** The source note must belong to you; the target may be your note or a
public note.

```sql
CONSTRAINT fk_kl_source FOREIGN KEY (source_note_id, created_by)
    REFERENCES notes (id, creator_id) ON DELETE CASCADE
```

**Why this shape.** It makes the notification trigger *mean* something — "someone
linked your public note" is a real event worth a notification. In the previous design
there was no sharing model at all, so the notification trigger fired on a scenario the
application could not produce.

**Reversible.** If you decide the graph should be strictly single-user, drop the
public-target case and remove `trg_link_notification`. Recorded here so the choice is
visible rather than implied.

---

## ADR-008 — Row Level Security is a real boundary

**Problem.** The browser holds `NEXT_PUBLIC_SUPABASE_ANON_KEY`. Anyone can open the
console and query Supabase directly, bypassing FastAPI entirely.

**Chosen.** RLS enabled on every table with a deny-by-default policy, plus explicit
policies for the Storage bucket. The backend connects with a role that bypasses RLS,
so server-side queries are unaffected.

This gets real SQL in [`03-SQL-LAYER.md`](03-SQL-LAYER.md), not a paragraph of prose.
It is the single most important security control in a Supabase architecture, and the
previous doc set gave it four sentences and no code.

---

## ADR-009 — Dropping `projects`

**Problem.** The original design had 16 tables. `projects` had no foreign keys to
anything but `users`, no API routes, no UI, and appeared in no query.

**Chosen.** Drop it. 15 tables you can each explain beats 16 where one has no answer
to "what does this do?"

**Reversible.** If projects are a feature you want, they should be designed properly:
a project groups notes across notebooks toward a deliverable, which means a
`project_notes` junction and a status workflow. That is a real feature, not a table.

---

## ADR-010 — Static export for the frontend

**Problem.** How to serve Next.js.

**Chosen.** `output: "export"` — pure HTML/CSS/JS on a CDN.

**Why it is safe here.** Every page is behind auth and every byte of data comes from
the API, so there is nothing to server-render. It removes a running Node process from
the deployment, and it is what a desktop build would need later.

**What it costs, stated plainly.** No middleware, so the auth guard is client-side
only — there is a brief moment before redirect where an unauthenticated user sees the
app shell. That is acceptable **only because the shell contains no data**: every
request that returns real data is authorized by FastAPI. The client-side guard is a
UX affordance, not a security boundary. Do not let that distinction blur.

---

## ADR-011 — Why PostgreSQL and not a graph database

**Problem.** The application has a graph at its centre. Neo4j exists.

**Chosen.** PostgreSQL, with `WITH RECURSIVE`.

**Reasoning.** The graph is one relationship among fifteen tables. Users, workspaces,
notebooks, versions, tags, and flashcards are all conventionally relational and need
foreign-key integrity. Recursive CTEs handle traversal at this scale in one system,
one transaction, one backup, one thing to operate.

**When the answer flips.** If traversal *were* the application — social graphs, fraud
rings, recommendation over billions of edges, ten-hop queries as the primary access
pattern — a native graph database's index-free adjacency wins decisively. Our graphs
are thousands of edges, bounded to depth 5.

**Industry precedent.** No personal-knowledge-graph product runs a native graph
database, and it is worth being specific about why. Obsidian and LogSeq are local-first
with no server database at all — the graph is recomputed from markdown files on open.
Roam Research is built on Datomic, a Datalog store, not a property-graph engine like
Neo4j. Notion — by far the largest of these — runs on sharded Postgres, publicly
documented on their own engineering blog. Every one of them treats the graph as *one
relationship inside a relational product*, not as the product's storage model. That is
exactly this project's shape: fifteen tables, one of which happens to be self-joining.

**Learning note.** "Which database?" is answered by the access pattern, not by which
noun appears in the product description.

---

## ADR-012 — Local PostgreSQL for development, Supabase for production

**Problem.** Where does the database live while two people are building the schema?

**Alternatives considered.**

- *One shared Supabase project.* What the previous doc set assumed. It is the default
  because it is one fewer thing to install, and it fails in four specific ways below.
- *One Supabase project each.* Doubles the setup, doubles the drift, and the two
  schemas diverge the first time one of you forgets to run a migration.
- *Local PostgreSQL in Docker, Supabase for production.* Chosen.

**Chosen.** `docker compose` runs `postgres:16-alpine`. Supabase is the production
database and — in every environment — the auth provider.

**Reasoning.** Schema work is destructive by nature. You will run
`alembic downgrade base` many times while getting the 15 tables right. Against a shared
database that is your teammate's data. Beyond that: two developers share one
`alembic_version` row, so your migrations collide; the free tier pauses after 7 days
idle, which lands the week before submission; and every query in development pays
~200 ms of round-trip instead of under 1 ms.

**What makes it possible.** `users.id` mirrors the Supabase `sub` claim rather than
referencing `auth.users` — see ADR-013. Nothing in our schema is bound to Supabase's,
so the data can live anywhere while Auth stays remote. JWT verification is a local
HMAC check against a shared secret, not a network call, so authentication works
identically against a local database.

**Trade-off.** Development is not byte-identical to production. Supabase adds RLS,
connection pooling, and its own extensions. We close that gap deliberately: RLS
policies are written in migrations (ADR-003), so they exist locally too, and Phase 7
runs the same migrations against Supabase before the first deploy.

**Industry practice.** Standard. Production data does not belong in a development loop,
and every team that has restored a backup because someone ran a migration against the
wrong `DATABASE_URL` learns this once.

**Learning note.** "Use the managed service everywhere" sounds simpler and is not. The
question to ask is *what happens when I run the most destructive command in my
workflow* — if the answer involves someone else's data, the environments are wrong.

---

## ADR-013 — `users` mirrors Supabase Auth; it does not reference it

**Problem.** Supabase Auth owns identity in its own `auth.users` table. Our schema needs
a user to hang workspaces, notes, and tags off. Do we foreign-key into `auth.users`, or
keep our own row?

**Alternatives considered.**

- *`FOREIGN KEY REFERENCES auth.users(id)`.* Referential integrity guaranteed by the
  database, deletion cascades for free. It also welds our schema to Supabase's internal
  layout, makes local development impossible, and puts a table we do not control and
  cannot migrate in the middle of our dependency graph.
- *No `users` table; store the JWT `sub` as a bare UUID column everywhere.* No join to
  get a display name; profile data has nowhere to live.
- *A local `users` table whose primary key is the `sub` claim.* Chosen.

**Chosen.**

```sql
CREATE TABLE users (
    id    UUID PRIMARY KEY,        -- NO DEFAULT: the value is the JWT "sub" claim
    email CITEXT NOT NULL UNIQUE,
    ...
);
```

The missing `DEFAULT gen_random_uuid()` is the entire decision, in one line. This table
does not mint identities — it records ones that already exist. A row is created on first
authenticated request, from verified claims, with an `IntegrityError` guard for the case
where two concurrent requests both find nothing.

**Trade-offs.** We accept that a user deleted in Supabase leaves a row here until a
cleanup job removes it. That is a real cost, and it is small: the row is inert without a
valid token, and it keeps foreign keys from every other table pointing at something that
exists. The alternative — a hard FK — trades that small inconsistency for a hard
coupling to a schema we do not own.

**Industry practice.** This is the standard shape for any application using an external
identity provider — Auth0, Clerk, Cognito, Okta. The IdP owns authentication; your
database owns *your* domain's concept of a user. The `sub` claim is the join key.

**Learning note.** It is the same instinct as not foreign-keying into a third-party API.
A foreign key is a promise the database enforces forever; only make it across a boundary
you control.
