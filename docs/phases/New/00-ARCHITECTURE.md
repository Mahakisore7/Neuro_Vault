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
is a real boundary and not a formality — see [ADR-008](../../adr/0008-row-level-security.md).

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

Every ADR referenced in this document set lives in [`docs/adr/`](../../adr/README.md),
one file per decision, added as they come up during the build rather than written all
upfront. Start there — it lists all sixteen with a one-line summary each.
