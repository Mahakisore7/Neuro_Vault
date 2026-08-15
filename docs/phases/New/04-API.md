# Phase 4 — The Backend API

**Goal:** every endpoint authorized, every layer with one job, and a cache that cannot
leak another user's data.

**Time:** ~6 hours · **Prerequisite:** [`03-SQL-LAYER.md`](03-SQL-LAYER.md)

**Done when:**

```
Every route returns the right status for owner / non-owner / anonymous
/docs lists the full contract
No service imports HTTPException; no route imports SQLAlchemy
uv run pyright → clean
```

---

## 4.1 The layering rule

```
HTTP request
    ↓
Route        validate input, call one service, return a status code
    ↓        ── may not import sqlalchemy ──
Service      business logic, AUTHORIZATION, orchestration, caching
    ↓        ── may not import fastapi ──
Repository   SQLAlchemy queries and nothing else
    ↓
Database
```

Two import bans define the whole architecture, and they are checkable mechanically:

| Layer | Must not import | Because |
|---|---|---|
| Route | `sqlalchemy` | A route that writes queries has swallowed the service layer |
| Service | `fastapi` | A service that raises `HTTPException` can never be reused by a CLI, a background job, or a test that isn't going through HTTP |

The second one is the one the previous doc set violated everywhere — services raised
`HTTPException(403)` directly. It works, and it quietly welds your business logic to the
web framework. §4.7 shows the alternative, which costs about fifteen lines.

> **Why bother, on a project this size?** Because the layer boundary is where you put
> the thing that must never be forgotten. Authorization lives in exactly one layer, so
> "is every endpoint authorized?" is answerable by reading one directory instead of
> auditing every route. The previous doc set shipped **four endpoints with no ownership
> check at all** — precisely because the check had no home.

---

## 4.2 Schemas — the HTTP shape

`app/schemas/` — Pydantic models. Deliberately **not** the same as the database models.

```python
# app/schemas/note.py
from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class NoteCreate(BaseModel):
    """What a client may send. Note what is ABSENT: creator_id, word_count, id.

    Those are set by the server or the database. A field that is not on this model
    cannot be injected by a client, no matter what JSON they post — which is why
    the request schema is separate from the ORM model rather than derived from it.
    """

    title: str = Field(min_length=1, max_length=255)
    content: str | None = None
    notebook_id: UUID | None = None
    is_public: bool = False


class NoteUpdate(BaseModel):
    """Every field optional — this is a PATCH.

    `exclude_unset=True` at the call site distinguishes "not mentioned" from
    "explicitly set to null", which a schema with defaults cannot express.
    """

    title: str | None = Field(default=None, min_length=1, max_length=255)
    content: str | None = None
    notebook_id: UUID | None = None
    is_public: bool | None = None
    pinned: bool | None = None
    archived: bool | None = None


class NoteResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    creator_id: UUID
    notebook_id: UUID | None
    title: str
    content: str | None
    is_public: bool
    pinned: bool
    archived: bool
    word_count: int          # generated column — readable, never writable
    created_at: datetime
    updated_at: datetime


class NoteSummary(BaseModel):
    """List responses omit `content`. A 200-note list would otherwise ship
    megabytes of HTML the list view never renders."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    title: str
    is_public: bool
    pinned: bool
    word_count: int
    updated_at: datetime
```

> **Viva question:** *Why not return the SQLAlchemy model directly?*
>
> "Three reasons. It couples the API contract to the table layout, so renaming a column
> silently breaks every client. It leaks fields that should not be public — internal
> flags, other users' IDs, soft-delete markers. And it makes the OpenAPI schema
> unreliable, because the ORM model has relationships that may or may not be loaded.
> Separate response models mean the contract is declared, not inferred."

**`from_attributes=True`** lets Pydantic read from ORM objects rather than dicts. It
was `orm_mode` in Pydantic v1; the rename is a common source of stale tutorials.

### The graph response

```python
# app/schemas/graph.py
class GraphNode(BaseModel):
    id: UUID
    title: str
    depth: int
    is_public: bool
    is_owned: bool


class GraphEdge(BaseModel):
    id: UUID
    source: UUID
    target: UUID
    rel_type: str
    color: str
    strength: int
    is_symmetric: bool


class GraphResponse(BaseModel):
    root_id: UUID
    depth: int
    nodes: list[GraphNode]
    edges: list[GraphEdge]
```

Shaped for Cytoscape.js, which wants nodes and edges as separate arrays. **The shape a
consumer needs is a legitimate reason to design a response** — it is not "leaking the
frontend into the backend", it is knowing your contract's consumer.

---

## 4.3 Repositories

### The generic base

```python
# app/repositories/base.py
from typing import Any, Sequence

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.base import Base


class BaseRepository[ModelT: Base]:
    """CRUD written once, reused fifteen times.

    PEP 695 generics (Python 3.12): `[ModelT: Base]` declares a type parameter
    bound to Base, so pyright knows `get()` returns the concrete model type on
    each subclass — NoteRepository.get() is typed Note | None, not Base | None.
    """

    model: type[ModelT]

    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def get(self, id_: Any) -> ModelT | None:
        return await self.db.get(self.model, id_)

    async def list(self, *, limit: int = 50, offset: int = 0, **filters: Any) -> Sequence[ModelT]:
        stmt = select(self.model).limit(limit).offset(offset)
        for field, value in filters.items():
            stmt = stmt.where(getattr(self.model, field) == value)
        result = await self.db.execute(stmt)
        return result.scalars().all()

    async def create(self, **values: Any) -> ModelT:
        obj = self.model(**values)
        self.db.add(obj)
        await self.db.flush()      # assigns PK and fires DB defaults
        await self.db.refresh(obj) # loads generated columns (word_count, search_vector)
        return obj

    async def delete(self, obj: ModelT) -> None:
        await self.db.delete(obj)
        await self.db.flush()
```

**`flush()`, not `commit()`.** The repository does not decide when the transaction ends —
`get_db()` does, at the end of the request (§1.6). `flush()` sends the SQL so the
database assigns the primary key and fires defaults, while leaving the transaction open
so a later failure still rolls the whole request back atomically.

**`refresh()` after create is required here specifically.** `word_count` and
`search_vector` are `GENERATED ALWAYS AS ... STORED`; their values exist only after
PostgreSQL computes them. Without the refresh, `note.word_count` raises or returns
`None`, and the response schema fails validation.

### A concrete repository

```python
# app/repositories/note.py
from uuid import UUID
from typing import Sequence

from sqlalchemy import Select, or_, select, text
from sqlalchemy.orm import selectinload

from app.models.note import Note, NoteVersion
from app.repositories.base import BaseRepository


class NoteRepository(BaseRepository[Note]):
    model = Note

    async def list_for_user(
        self,
        user_id: UUID,
        *,
        notebook_id: UUID | None = None,
        archived: bool = False,
        limit: int = 50,
        offset: int = 0,
    ) -> Sequence[Note]:
        stmt = (
            select(Note)
            .where(Note.creator_id == user_id, Note.archived == archived)
            .order_by(Note.pinned.desc(), Note.updated_at.desc())
            .limit(limit)
            .offset(offset)
        )
        if notebook_id is not None:
            stmt = stmt.where(Note.notebook_id == notebook_id)
        return (await self.db.execute(stmt)).scalars().all()

    async def search(self, user_id: UUID, term: str, limit: int = 20) -> Sequence[dict]:
        """Q15. The authorization predicate is IN the SQL, not applied afterwards.

        Filtering in Python after the LIMIT would return fewer than `limit` rows
        and leak the existence of other users' notes through the shortfall.
        """
        stmt = text("""
            SELECT n.id, n.title,
                   ts_rank_cd(n.search_vector, q.query) AS rank,
                   ts_headline('english',
                       regexp_replace(COALESCE(n.content, ''), '<[^>]+>', ' ', 'g'),
                       q.query,
                       'StartSel=<mark>, StopSel=</mark>, MaxWords=30, MinWords=15'
                   ) AS snippet
            FROM notes n, websearch_to_tsquery('english', :term) AS q(query)
            WHERE n.search_vector @@ q.query
              AND n.archived = FALSE
              AND (n.creator_id = :user_id OR n.is_public = TRUE)
            ORDER BY rank DESC
            LIMIT :limit
        """)
        result = await self.db.execute(
            stmt, {"term": term, "user_id": user_id, "limit": limit}
        )
        return [dict(row) for row in result.mappings()]

    async def get_with_versions(self, note_id: UUID) -> Note | None:
        """selectinload issues ONE extra query for all versions.

        Without it, `lazy="raise_on_sql"` (Phase 2) raises rather than silently
        emitting a query per note — which is the N+1 problem made loud instead
        of invisible.
        """
        stmt = (
            select(Note)
            .where(Note.id == note_id)
            .options(selectinload(Note.versions))
        )
        return (await self.db.execute(stmt)).scalar_one_or_none()
```

> **Viva question:** *What is the N+1 query problem?*
>
> "You fetch N rows, then access a relationship on each one, and the ORM issues one
> additional query per row — N+1 queries for what should be two. It is invisible in
> development with ten rows and catastrophic in production with ten thousand. I prevent
> it structurally: every relationship is declared `lazy='raise_on_sql'`, so an
> unloaded access raises immediately instead of quietly issuing SQL. Then
> `selectinload()` fetches the related rows in a single additional query using an
> `IN` clause."

### The repository the previous doc set forgot

`app/core/dependencies.py` imported `UserRepository`, which did not exist anywhere in
the codebase — the backend could not start. It is four lines:

```python
# app/repositories/user.py
from app.models.user import User
from app.repositories.base import BaseRepository


class UserRepository(BaseRepository[User]):
    model = User
```

---

## 4.4 Authentication

### Verifying the token

```python
# app/core/security.py
import jwt
from jwt import PyJWKClient
from jwt.exceptions import InvalidTokenError, PyJWKClientError

from app.core.config import settings


class TokenError(Exception):
    """Raised for any invalid token. Deliberately carries no detail."""


# Fetches {supabase_url}/auth/v1/.well-known/jwks.json lazily and caches it.
_jwks_client = PyJWKClient(f"{settings.supabase_url}/auth/v1/.well-known/jwks.json")


def decode_access_token(token: str) -> dict:
    """Verify a Supabase-issued JWT against its published public signing key.

    `algorithms=["ES256"]` is not optional and not a default. If the accepted
    algorithms come from the token's own header, an attacker sets alg to "none"
    and forges any identity they like — the classic JWT algorithm-confusion
    attack. The verifier, not the token, decides what is acceptable.
    """
    try:
        signing_key = _jwks_client.get_signing_key_from_jwt(token)
        return jwt.decode(
            token,
            signing_key.key,
            algorithms=["ES256"],
            audience="authenticated",
            options={"require": ["exp", "sub"]},
        )
    except (InvalidTokenError, PyJWKClientError) as exc:
        raise TokenError("Invalid or expired token") from exc
```

**The error message never says why.** "Expired" versus "bad signature" versus "wrong
audience" tells an attacker which part of their forgery to fix. One opaque message for
every failure.

> **Viva question:** *Why PyJWT and not python-jose?*
>
> "python-jose has been effectively unmaintained since 2021 and carries open CVEs.
> PyJWT is actively maintained and is what Auth0 and Django REST Framework use. The
> API surface I need is one function, so the migration was a three-line change — there
> was no reason to keep a dependency with known vulnerabilities."
>
> See [ADR-006](../../adr/0006-pyjwt-instead-of-python-jose.md).

### Resolving the token to a user

```python
# app/core/dependencies.py
from typing import Annotated
from uuid import UUID

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import TokenError, decode_access_token
from app.db.session import get_db
from app.models.user import User

bearer_scheme = HTTPBearer(auto_error=True)


async def get_current_user(
    credentials: Annotated[HTTPAuthorizationCredentials, Depends(bearer_scheme)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> User:
    """Verify the JWT and return the local user row, creating it on first login."""
    try:
        payload = decode_access_token(credentials.credentials)
        user_id = UUID(payload["sub"])
    except (TokenError, KeyError, ValueError):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authentication credentials",
            headers={"WWW-Authenticate": "Bearer"},
        ) from None

    user = await db.get(User, user_id)
    if user is not None:
        return user

    # First login. Create from VERIFIED claims — never from the request body.
    email = payload.get("email") or f"{user_id}@placeholder.local"
    display_name = (
        payload.get("user_metadata", {}).get("full_name")
        or email.split("@")[0]
    )[:100]

    try:
        # begin_nested() is a SAVEPOINT. Two concurrent first requests from the
        # same new user both find nothing and both insert; one loses on the
        # unique constraint. Rolling back the SAVEPOINT discards only the failed
        # INSERT — a bare db.rollback() would abort the whole request transaction.
        async with db.begin_nested():
            user = User(id=user_id, email=email, display_name=display_name)
            db.add(user)
    except IntegrityError:
        user = await db.get(User, user_id)
        if user is None:
            raise

    return user


CurrentUser = Annotated[User, Depends(get_current_user)]
DbSession = Annotated[AsyncSession, Depends(get_db)]
```

**The race is real and it happens.** A user signs up, the frontend fires three requests
at once, all three find no row, all three insert. Without the guard, two get a 500 on
their very first interaction with the product.

**`CurrentUser` as a type alias** means every route signature reads
`user: CurrentUser` instead of the full `Annotated[...]` expression. FastAPI resolves
it identically; the routes stay readable.

> **Viva question:** *Why does the user row get created by the API rather than by a
> Supabase database trigger on `auth.users`?*
>
> "A trigger on `auth.users` would couple our schema to Supabase's internal one — it
> would break local development entirely, and it would break if Supabase changed that
> table. Creating the row lazily from a verified JWT claim means our database has no
> dependency on theirs. The only cost is the race on first login, which one savepoint
> handles. That is [ADR-013](../../adr/0013-users-mirrors-supabase-auth.md)."

---

## 4.5 Domain exceptions

Services raise these. They know nothing about HTTP.

```python
# app/core/exceptions.py
class DomainError(Exception):
    """Base for everything the application raises deliberately."""


class NotFoundError(DomainError):
    def __init__(self, entity: str, identifier: object) -> None:
        super().__init__(f"{entity} {identifier} not found")


class PermissionDeniedError(DomainError):
    def __init__(self, action: str = "perform this action") -> None:
        super().__init__(f"You do not have permission to {action}")


class ConflictError(DomainError):
    """A uniqueness or state conflict — duplicate link, duplicate slug."""


class ValidationError(DomainError):
    """A business rule violation that Pydantic cannot express."""
```

Mapped to HTTP once, in `main.py`:

```python
# app/main.py  (add below the CORS middleware)
from fastapi import Request
from fastapi.responses import JSONResponse

from app.core.exceptions import (
    ConflictError, DomainError, NotFoundError,
    PermissionDeniedError, ValidationError,
)

_STATUS_MAP: dict[type[DomainError], int] = {
    NotFoundError: 404,
    PermissionDeniedError: 403,
    ConflictError: 409,
    ValidationError: 422,
}


@app.exception_handler(DomainError)
async def handle_domain_error(request: Request, exc: DomainError) -> JSONResponse:
    for error_type, status_code in _STATUS_MAP.items():
        if isinstance(exc, error_type):
            return JSONResponse(status_code=status_code, content={"detail": str(exc)})
    return JSONResponse(status_code=400, content={"detail": str(exc)})
```

**Fifteen lines buys you a service layer that is testable without a web server**, usable
from the seed script and any future CLI, and a single place where the HTTP mapping
lives. Compare with `raise HTTPException(403)` scattered through business logic, where
changing 403 to 404 for security reasons means finding every call site.

> **A security note worth stating in the viva.** `NotFoundError` and
> `PermissionDeniedError` are different exceptions, but for *reads* the service raises
> `NotFoundError` in both cases — see §4.6. Returning 403 for a note that exists but
> isn't yours confirms its existence to someone probing UUIDs. 404 reveals nothing.

---

## 4.6 Services — where authorization lives

```python
# app/services/note.py
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import NotFoundError, PermissionDeniedError
from app.models.note import Note
from app.models.user import User
from app.repositories.note import NoteRepository
from app.repositories.notebook import NotebookRepository
from app.schemas.note import NoteCreate, NoteResponse, NoteSummary, NoteUpdate


class NoteService:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db
        self.notes = NoteRepository(db)
        self.notebooks = NotebookRepository(db)

    # ── Authorization helpers — the ONLY place these rules are written ────────

    @staticmethod
    def _assert_can_read(note: Note, user: User) -> None:
        """A note is readable if you own it or it is public.

        Raises NotFoundError, not PermissionDeniedError: a 403 on someone else's
        private note confirms that the UUID is real. 404 leaks nothing.
        """
        if note.creator_id != user.id and not note.is_public:
            raise NotFoundError("Note", note.id)

    @staticmethod
    def _assert_can_write(note: Note, user: User) -> None:
        """Only the owner may modify. Public means readable, not writable."""
        if note.creator_id != user.id:
            raise PermissionDeniedError("modify this note")

    # ── Operations ────────────────────────────────────────────────────────────

    async def get(self, note_id: UUID, user: User) -> NoteResponse:
        note = await self.notes.get(note_id)
        if note is None:
            raise NotFoundError("Note", note_id)
        self._assert_can_read(note, user)
        return NoteResponse.model_validate(note)

    async def list(
        self, user: User, *, notebook_id: UUID | None = None,
        archived: bool = False, limit: int = 50, offset: int = 0,
    ) -> list[NoteSummary]:
        notes = await self.notes.list_for_user(
            user.id, notebook_id=notebook_id, archived=archived,
            limit=limit, offset=offset,
        )
        return [NoteSummary.model_validate(n) for n in notes]

    async def create(self, payload: NoteCreate, user: User) -> NoteResponse:
        # Validate the notebook belongs to this user BEFORE inserting. The
        # composite FK would reject it anyway (Phase 2), but a foreign key
        # violation surfaces as a 500 with a Postgres error string. Checking
        # first produces a clean 404 and a message the client can act on.
        if payload.notebook_id is not None:
            notebook = await self.notebooks.get(payload.notebook_id)
            if notebook is None or notebook.owner_id != user.id:
                raise NotFoundError("Notebook", payload.notebook_id)

        note = await self.notes.create(
            creator_id=user.id,
            title=payload.title,
            content=payload.content,
            notebook_id=payload.notebook_id,
            is_public=payload.is_public,
        )
        return NoteResponse.model_validate(note)

    async def update(self, note_id: UUID, payload: NoteUpdate, user: User) -> NoteResponse:
        note = await self.notes.get(note_id)
        if note is None:
            raise NotFoundError("Note", note_id)
        self._assert_can_write(note, user)

        changes = payload.model_dump(exclude_unset=True)

        if "notebook_id" in changes and changes["notebook_id"] is not None:
            notebook = await self.notebooks.get(changes["notebook_id"])
            if notebook is None or notebook.owner_id != user.id:
                raise NotFoundError("Notebook", changes["notebook_id"])

        for field, value in changes.items():
            setattr(note, field, value)

        await self.db.flush()
        await self.db.refresh(note)   # reload word_count after the trigger + generated col
        return NoteResponse.model_validate(note)

    async def delete(self, note_id: UUID, user: User) -> None:
        """Archives, not hard-deletes — see 00-ARCHITECTURE.md §0.7.

        A hard delete here would CASCADE to the note's versions, flashcards,
        resources, and both directions of knowledge_links (Phase 2 §2.4) — the
        exact history the versioning trigger exists to preserve. Setting
        `archived` reuses the column and partial index (idx_notes_creator_id_
        updated_at WHERE archived = FALSE, Phase 3 §3.2) that already exist for
        this: default note lists already filter it out.
        """
        note = await self.notes.get(note_id)
        if note is None:
            raise NotFoundError("Note", note_id)
        self._assert_can_write(note, user)
        note.archived = True
        await self.db.flush()
```

**`exclude_unset=True` is the whole reason PATCH works.** Without it,
`model_dump()` returns every field including the ones the client never mentioned, as
`None` — so a request updating only the title would wipe the content. The distinction
between "absent" and "explicitly null" only survives if you ask for it.

**`_assert_can_read` and `_assert_can_write` are separate on purpose.** Public notes are
readable by everyone and writable by nobody but the owner. One combined check would have
to encode both rules and would eventually be called with the wrong intent.

---

## 4.7 The cache, done correctly

The previous doc set's graph and note caching contained an **authorization bypass**.
This is the most serious defect in the audit and worth studying rather than just fixing.

### The broken version

```python
# DO NOT USE — this is the defect
async def get(self, note_id: UUID, user: User) -> NoteResponse:
    cache_key = f"note:{note_id}"                 # ← key has no user in it
    cached = await cache_get(cache_key)
    if cached:
        return NoteResponse.model_validate(cached)  # ← RETURNS BEFORE ANY CHECK

    note = await self.repo.get(note_id)
    if note.creator_id != user.id and not note.is_public:
        raise PermissionDeniedError()             # ← unreachable on a cache hit
    ...
```

**Alice reads her private note. It is now in Redis under `note:{uuid}`. Bob requests
the same UUID and gets it.** The authorization check is below the early return, so on
every cache hit it does not execute. The check is present, reviewed, and useless.

### The correct version — two independent fixes

```python
async def get_graph(self, note_id: UUID, user: User, depth: int) -> GraphResponse:
    # ── FIX 1: authorize FIRST, from the database, on every single request ────
    note = await self.notes.get(note_id)
    if note is None:
        raise NotFoundError("Note", note_id)
    self._assert_can_read(note, user)

    # ── FIX 2: the cache key includes the user ───────────────────────────────
    # Needed even with Fix 1. Two users may both be authorized to read this note
    # and still see DIFFERENT graphs — Alice's traversal includes her private
    # neighbours, Bob's does not. A shared key would serve Alice's neighbourhood
    # to Bob. The payload is user-specific, so the key must be too.
    cache_key = f"graph:{user.id}:{note_id}:{depth}"

    cached = await cache_get(cache_key)
    if cached is not None:
        return GraphResponse.model_validate(cached)

    graph = await self.notes.traverse_graph(note_id, user.id, depth)
    response = GraphResponse.model_validate(graph)
    await cache_set(cache_key, response.model_dump(mode="json"), settings.graph_cache_ttl)
    return response
```

> **Both fixes are necessary and neither is sufficient.**
>
> Authorize-first alone still leaks *content*: Bob is authorized to see the public root
> note, so he passes the check — and then receives Alice's cached graph including her
> private neighbours.
>
> User-scoped keys alone still leak *staleness*: Alice makes a note private, but Bob's
> cache entry from before the change is still valid for its TTL.
>
> The general principle: **a cache key must contain every input the cached value
> depends on.** The graph depends on the note, the depth, *and the viewer*. Omit one
> and you have a correctness bug that no test written against a cold cache will find.

### Invalidation

```python
async def _invalidate_graph_cache(self, user_id: UUID) -> None:
    """Any edge change alters the neighbourhood of many notes, not just two.

    Deleting only the two endpoints' keys leaves every other note whose
    traversal passed through that edge holding a stale answer.
    """
    await cache_delete_pattern(f"graph:{user_id}:*")
```

**Called after every link create and delete.** Coarse invalidation over clever
invalidation: the failure mode of deleting too much is a slower next request, and the
failure mode of deleting too little is a wrong answer. Choose the one that fails safely.

> **Viva question:** *What are the two hard problems in caching?*
>
> "Invalidation and naming. Both appear here. Naming: my key must contain every input
> the value depends on, including the viewer's identity — omitting it was an
> authorization bypass. Invalidation: when an edge changes, every cached traversal that
> could have crossed it is stale, so I invalidate the user's whole graph namespace
> rather than trying to compute exactly which entries were affected."

---

## 4.8 Routes

Thin. Validate, delegate, return.

```python
# app/api/v1/endpoints/notes.py
from uuid import UUID

from fastapi import APIRouter, Query, status

from app.core.dependencies import CurrentUser, DbSession
from app.schemas.graph import GraphResponse
from app.schemas.note import NoteCreate, NoteResponse, NoteSummary, NoteUpdate
from app.services.graph import GraphService
from app.services.note import NoteService

router = APIRouter(prefix="/notes", tags=["notes"])


@router.get("", response_model=list[NoteSummary])
async def list_notes(
    user: CurrentUser,
    db: DbSession,
    notebook_id: UUID | None = None,
    archived: bool = False,
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
) -> list[NoteSummary]:
    return await NoteService(db).list(
        user, notebook_id=notebook_id, archived=archived, limit=limit, offset=offset
    )


@router.post("", response_model=NoteResponse, status_code=status.HTTP_201_CREATED)
async def create_note(payload: NoteCreate, user: CurrentUser, db: DbSession) -> NoteResponse:
    return await NoteService(db).create(payload, user)


@router.get("/{note_id}", response_model=NoteResponse)
async def get_note(note_id: UUID, user: CurrentUser, db: DbSession) -> NoteResponse:
    return await NoteService(db).get(note_id, user)


@router.patch("/{note_id}", response_model=NoteResponse)
async def update_note(
    note_id: UUID, payload: NoteUpdate, user: CurrentUser, db: DbSession
) -> NoteResponse:
    return await NoteService(db).update(note_id, payload, user)


@router.delete("/{note_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_note(note_id: UUID, user: CurrentUser, db: DbSession) -> None:
    await NoteService(db).delete(note_id, user)


@router.get("/{note_id}/graph", response_model=GraphResponse)
async def get_note_graph(
    note_id: UUID,
    user: CurrentUser,
    db: DbSession,
    depth: int = Query(default=2, ge=1, le=5),
) -> GraphResponse:
    return await GraphService(db).get_graph(note_id, user, depth)
```

**`Query(ge=1, le=5)` on depth.** Without an upper bound, a client requests depth 50 and
the recursive CTE traverses the entire graph. Validation at the boundary is what stops
a denial-of-service that costs the attacker one HTTP request.

**No `try`/`except` anywhere.** Domain exceptions propagate to the handler in §4.5.
A route that catches and re-raises as `HTTPException` has reintroduced the coupling the
exception hierarchy removed.

**`status_code=204` on delete, with return type `None`.** 204 means "success, no body."
Returning a body with 204 is a spec violation that some clients reject outright.

### The dashboard endpoint

One route, backed entirely by the view built in [`03-SQL-LAYER.md`](03-SQL-LAYER.md)
§3.3 — `v_user_dashboard` already did the aggregation, so this layer has nothing to
compute, only to read and shape.

```python
# app/schemas/dashboard.py
from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict


class DashboardResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    user_id: UUID
    display_name: str
    total_notes: int
    pinned_notes: int
    archived_notes: int
    public_notes: int
    total_words: int
    workspace_count: int
    link_count: int
    last_edited_at: datetime | None
```

```python
# app/repositories/dashboard.py
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


class DashboardRepository:
    """No BaseRepository here — v_user_dashboard is a view, not a mapped model,
    and this is its only query. A repository can be one method."""

    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def get(self, user_id: UUID) -> dict | None:
        row = (await self.db.execute(
            text("SELECT * FROM v_user_dashboard WHERE user_id = :user_id"),
            {"user_id": user_id},
        )).mappings().first()
        return dict(row) if row else None
```

```python
# app/services/dashboard.py
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.repositories.dashboard import DashboardRepository
from app.schemas.dashboard import DashboardResponse


class DashboardService:
    def __init__(self, db: AsyncSession) -> None:
        self.dashboard = DashboardRepository(db)

    async def get(self, user_id: UUID) -> DashboardResponse:
        # A user with zero notes has no row in the view at all — it is a plain
        # LEFT JOIN aggregate keyed off `users`, so the row always exists once
        # the user does. There is no "not found" case to guard here.
        row = await self.dashboard.get(user_id)
        return DashboardResponse.model_validate(row)
```

```python
# app/api/v1/endpoints/dashboard.py
from fastapi import APIRouter

from app.core.dependencies import CurrentUser, DbSession
from app.schemas.dashboard import DashboardResponse
from app.services.dashboard import DashboardService

router = APIRouter(prefix="/dashboard", tags=["dashboard"])


@router.get("", response_model=DashboardResponse)
async def get_dashboard(user: CurrentUser, db: DbSession) -> DashboardResponse:
    return await DashboardService(db).get(user.id)
```

**Why this route has no ownership check to write.** `user_id` comes from the verified
JWT, not from a path parameter — there is no ID a caller could substitute to read
someone else's dashboard, so the authorization question §4.6 keeps asking ("does the
caller own the thing being read?") has no other party to check against.

### The router

```python
# app/api/v1/router.py
from fastapi import APIRouter

from app.api.v1.endpoints import (
    collections, dashboard, flashcards, links, notebooks, notes,
    notifications, resources, search, tags, users, workspaces,
)

api_router = APIRouter()
api_router.include_router(users.router)
api_router.include_router(workspaces.router)
api_router.include_router(notebooks.router)
api_router.include_router(notes.router)
api_router.include_router(links.router)
api_router.include_router(tags.router)
api_router.include_router(collections.router)
api_router.include_router(flashcards.router)
api_router.include_router(resources.router)
api_router.include_router(search.router)
api_router.include_router(notifications.router)
api_router.include_router(dashboard.router)
```

Then in `main.py`, uncomment the two lines Phase 1 left as a marker:

```python
from app.api.v1.router import api_router
app.include_router(api_router, prefix="/api/v1")
```

---

## 4.9 Automatic linking — `[[wiki-links]]`

Manual linking (§4.6) does not, by itself, produce a graph worth traversing. Nobody
opens a dialog often enough to build one — every knowledge-graph tool that people
actually use (Obsidian, Roam, Notion) generates most of its edges from a lightweight
markup: type `[[BCNF]]` inside a note, and an edge to the note titled "BCNF" appears,
with no dialog and no extra click.

### Why this needs its own `origin` column

The naive implementation re-parses a note's content on every save and makes the graph
match: delete edges for titles no longer mentioned, insert edges for titles newly
mentioned. That is a **destructive full reconciliation**, and run against the whole
table it would delete edges the user built by hand in the link dialog — including ones
carrying a relationship type and strength they chose deliberately.

`knowledge_links.origin` (§2.4) is what makes reconciliation safe: the reconciler only
ever deletes rows it created (`origin = 'wiki'`). A manually created edge to the same
target is invisible to it, in both directions — the reconciler will not delete it, and
will not duplicate it either.

```python
# app/services/wiki_link.py
import re
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.note import Note

# [[Title]] or [[Title|display text]] — the pipe form lets the editor show a
# shorter label while still linking to the note's real title.
_WIKI_LINK_PATTERN = re.compile(r"\[\[([^\]|]+)(?:\|[^\]]*)?\]\]")

# The relationship type wiki-links are filed under. 'related' — symmetric, since
# an implicit textual mention doesn't assert a direction the way a hand-chosen
# "prerequisite" or "contradicts" edge does.
_WIKI_REL_TYPE_NAME = "related"


class WikiLinkService:
    """Keeps knowledge_links in sync with [[title]] references in a note's content.

    Runs after every save that touches content. Computes the set of titles
    currently referenced, resolves them against the user's own notes, and
    reconciles knowledge_links to match — touching only rows this service
    created. See ADR-007: a wiki-link can no more cross ownership than a
    manually created one, so resolution is scoped to the author's own notes.
    """

    def __init__(self, db: AsyncSession) -> None:
        self.db = db
        self._rel_type_id: int | None = None

    async def _rel_type(self) -> int:
        # Resolved by NAME, not hardcoded as an id. relationship_types.id is an
        # IDENTITY column assigned in seed-script insertion order (Phase 2) —
        # a constant here would silently repoint every wiki-link at the wrong
        # type the day someone reorders that list. One extra query per
        # reconcile call is what correctness costs; it is not on a hot path.
        if self._rel_type_id is None:
            row = (await self.db.execute(text(
                "SELECT id FROM relationship_types WHERE name = :name"
            ), {"name": _WIKI_REL_TYPE_NAME})).first()
            if row is None:
                raise RuntimeError(
                    f"relationship_types has no '{_WIKI_REL_TYPE_NAME}' row — "
                    "was the seed script run?"
                )
            self._rel_type_id = row.id
        return self._rel_type_id

    @staticmethod
    def extract_titles(content: str | None) -> set[str]:
        if not content:
            return set()
        # Same HTML-stripping regex as the search_vector generated column
        # (Phase 2) — content is Tiptap's own well-formed output, so a full
        # HTML parser buys nothing a regex doesn't already give us here.
        stripped = re.sub(r"<[^>]+>", " ", content)
        return {
            m.group(1).strip()
            for m in _WIKI_LINK_PATTERN.finditer(stripped)
            if m.group(1).strip()
        }

    async def reconcile(self, note: Note) -> dict[str, list[str]]:
        titles = self.extract_titles(note.content)
        resolved: dict[str, UUID] = {}
        unresolved: list[str] = []

        if titles:
            # DISTINCT ON, same technique as the shortest-path function (§3.5):
            # a title can collide across notebooks, so pick one deterministically
            # — the most recently updated match — rather than erroring or
            # linking to an arbitrary row.
            rows = (await self.db.execute(text("""
                SELECT DISTINCT ON (lower(title)) id, title
                FROM notes
                WHERE creator_id = :user_id AND id != :note_id
                  AND lower(title) = ANY(:titles)
                ORDER BY lower(title), updated_at DESC
            """), {
                "user_id": note.creator_id,
                "note_id": note.id,
                "titles": [t.lower() for t in titles],
            })).all()

            by_lower = {row.title.lower(): row.id for row in rows}
            for wanted in titles:
                target_id = by_lower.get(wanted.lower())
                (resolved.__setitem__(wanted, target_id) if target_id
                 else unresolved.append(wanted))

        desired = set(resolved.values())

        existing_wiki = (await self.db.execute(text("""
            SELECT id, target_note_id FROM knowledge_links
            WHERE source_note_id = :note_id AND origin = 'wiki'
        """), {"note_id": note.id})).all()
        existing_targets = {row.target_note_id: row.id for row in existing_wiki}

        # Drop wiki edges for titles no longer in the text.
        stale_ids = [existing_targets[t] for t in existing_targets.keys() - desired]
        if stale_ids:
            await self.db.execute(
                text("DELETE FROM knowledge_links WHERE id = ANY(:ids)"),
                {"ids": stale_ids},
            )

        # Add edges for newly referenced titles — but skip any target that
        # already has an edge under this relationship type, regardless of
        # origin. A hand-made edge always wins; the reconciler never
        # overwrites or duplicates one it did not create.
        candidates = desired - existing_targets.keys()
        if candidates:
            rel_type_id = await self._rel_type()
            already = (await self.db.execute(text("""
                SELECT target_note_id FROM knowledge_links
                WHERE source_note_id = :note_id AND rel_type_id = :rel_type_id
                  AND target_note_id = ANY(:targets)
            """), {
                "note_id": note.id,
                "rel_type_id": rel_type_id,
                "targets": list(candidates),
            })).scalars().all()

            for target_id in candidates - set(already):
                await self.db.execute(text("""
                    INSERT INTO knowledge_links
                        (source_note_id, target_note_id, rel_type_id, created_by, origin)
                    VALUES (:source, :target, :rel_type_id, :creator, 'wiki')
                """), {
                    "source": note.id, "target": target_id,
                    "rel_type_id": rel_type_id, "creator": note.creator_id,
                })

        await self.db.flush()
        return {"resolved": sorted(resolved), "unresolved": sorted(unresolved)}
```

**Why raw `text()` and not the ORM here.** This is bulk set reconciliation — delete a
computed set, insert a computed set — expressed more directly as SQL than as a loop of
ORM object deletions. `NoteRepository.search` (§4.3) already established the same
pattern for exactly the same reason: some operations are just queries, and forcing them
through the ORM adds indirection without adding safety.

**The notification trigger stays correct with no changes.** `trg_knowledge_links_notify`
(§3.4) fires on every `INSERT` regardless of `origin`, but wiki-link resolution is
scoped to the author's *own* notes — so `target_owner` always equals `created_by`, the
trigger's self-notification guard always trips, and no notification noise is generated
by a user linking their own notes together via `[[...]]`.

### Wiring it into the service

```python
# app/services/note.py — add to NoteService

from app.services.wiki_link import WikiLinkService

class NoteService:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db
        self.notes = NoteRepository(db)
        self.notebooks = NotebookRepository(db)
        self.wiki_links = WikiLinkService(db)

    async def create(self, payload: NoteCreate, user: User) -> NoteResponse:
        # ... existing body from §4.6, unchanged up to the final refresh ...
        note = await self.notes.create(
            creator_id=user.id, title=payload.title, content=payload.content,
            notebook_id=payload.notebook_id, is_public=payload.is_public,
        )
        wiki_result = await self.wiki_links.reconcile(note)
        response = NoteResponse.model_validate(note)
        response.unresolved_wiki_links = wiki_result["unresolved"]
        return response

    async def update(self, note_id: UUID, payload: NoteUpdate, user: User) -> NoteResponse:
        # ... existing body from §4.6, through the flush + refresh ...
        wiki_result: dict[str, list[str]] = {"resolved": [], "unresolved": []}
        if "content" in payload.model_dump(exclude_unset=True):
            wiki_result = await self.wiki_links.reconcile(note)

        response = NoteResponse.model_validate(note)
        response.unresolved_wiki_links = wiki_result["unresolved"]
        return response
```

Add the field to `NoteResponse` (§4.2):

```python
class NoteResponse(BaseModel):
    ...
    unresolved_wiki_links: list[str] = []
    # Populated only on create/update — the titles the reconciler could not
    # match to one of your notes. A plain GET leaves this empty rather than
    # re-running the reconciler on every read; it is write-time feedback for
    # the editor, not a persisted fact about the note.
```

The frontend shows unresolved titles as a small "not found" banner (§5.7) — reusing the
exact language a spell-checker uses is deliberate: it should read as "this reference
didn't resolve," not as an error.

> **Viva question:** *What stops the reconciler from deleting a manually created edge?*
>
> "The `origin` column. Every edge records how it was created — `manual`, `wiki`, or
> `ai`, the last reserved for the suggestion feature in the roadmap. The reconciler's
> `DELETE` is scoped to `origin = 'wiki' AND source_note_id = this note`, so a row with
> `origin = 'manual'` is structurally invisible to it — not by convention, by the
> `WHERE` clause. And before inserting a new wiki edge, it checks whether *any* edge to
> that target already exists under the same relationship type, so it cannot duplicate a
> manual edge either. The rule driving both checks is the same: an automated process
> only ever owns what it created."

---

## 4.10 The complete contract

Every endpoint, with its authorization rule. **The four marked ⚠ had no ownership check
at all in the previous doc set** — any authenticated user could read anyone's links and
resources, and add notes to anyone's collections.

| Method | Path | Authorization |
|---|---|---|
| `GET` | `/api/v1/users/me` | Self |
| `PATCH` | `/api/v1/users/me` | Self |
| `GET` | `/api/v1/workspaces` | Owner-scoped list |
| `POST` | `/api/v1/workspaces` | Creates as self |
| `PATCH` `DELETE` | `/api/v1/workspaces/{id}` | Owner |
| `GET` `POST` | `/api/v1/notebooks` | Owner-scoped; workspace ownership verified |
| `PATCH` `DELETE` | `/api/v1/notebooks/{id}` | Owner |
| `GET` | `/api/v1/notes` | Owner-scoped list |
| `POST` | `/api/v1/notes` | Creates as self; notebook ownership verified |
| `GET` | `/api/v1/notes/{id}` | Owner **or** public |
| `PATCH` `DELETE` | `/api/v1/notes/{id}` | Owner only — content edits also trigger `[[wiki-link]]` reconciliation |
| `GET` | `/api/v1/notes/{id}/graph` | Read access to root; user-scoped cache |
| `GET` | `/api/v1/notes/{id}/versions` | Owner |
| `POST` | `/api/v1/notes/{id}/rollback` | Owner |
| ⚠ `GET` | `/api/v1/notes/{id}/links` | **Read access to the note** |
| `POST` | `/api/v1/links` | Owns source; can read target |
| `DELETE` | `/api/v1/links/{id}` | Created it |
| `GET` `POST` | `/api/v1/tags` | Owner-scoped |
| `POST` `DELETE` | `/api/v1/notes/{nid}/tags/{tid}` | Owns both note and tag |
| `GET` `POST` | `/api/v1/collections` | Owner-scoped |
| ⚠ `POST` | `/api/v1/collections/{cid}/notes/{nid}` | **Owns both** |
| ⚠ `DELETE` | `/api/v1/collections/{cid}/notes/{nid}` | **Owns both** |
| `GET` `POST` | `/api/v1/flashcards` | Owner-scoped; note ownership verified |
| `POST` | `/api/v1/flashcards/{id}/review` | Owner |
| `DELETE` | `/api/v1/flashcards/{id}` | Owner |
| ⚠ `GET` `POST` | `/api/v1/notes/{id}/resources` | **Owns the note** |
| `GET` | `/api/v1/search?q=` | Owner's notes + public |
| `GET` | `/api/v1/notifications` | Self only |
| `PATCH` | `/api/v1/notifications/{id}/read` | Self only |
| `GET` | `/api/v1/dashboard` | Self — `user_id` comes from the JWT, not a path param |

**The audit that produced this table is one you should be able to repeat**, because it
is the question an examiner asks about security: *for every endpoint, what stops user B
from acting on user A's data?* If the answer for any row is "nothing", you have found a
vulnerability. Three of the four above were `GET`s, which feel harmless and are not.

---

## 4.11 Phase 4 checklist

Run these against a live server with two real users. Owner, non-owner, anonymous —
every endpoint, three ways.

```
□ Anonymous request to any /api/v1/* route → 401
□ Malformed / expired token → 401, with no detail about which
□ GET  another user's PRIVATE note        → 404  (not 403 — no existence leak)
□ GET  another user's PUBLIC  note        → 200
□ PATCH another user's PUBLIC note        → 403  (public is readable, not writable)
□ POST a note into another user's notebook → 404
□ GET  another user's note's links        → 404
□ POST a note into another user's collection → 404
□ GET  another user's note's resources    → 404
□ PATCH with only {"title": "x"} leaves content unchanged
□ depth=50 on /graph → 422 from Query validation, no query executed
□ Second identical /graph request is served from cache (check Redis, or the log)
□ Alice's cached graph is NOT returned to Bob for the same public root note
□ Creating a link invalidates graph:{user}:* for the creator
□ Typing [[Title]] in content and saving creates a wiki-origin edge
□ Removing [[Title]] from the text deletes only that wiki edge, never a manual one
□ A [[Title]] matching no note appears in unresolved_wiki_links, not as an error
□ /docs lists every route in §4.10
□ grep -r "HTTPException" app/services/ → no matches
□ grep -r "sqlalchemy"    app/api/     → no matches
```

The last two are the layering rule made checkable. They take one second and catch the
architectural drift that code review misses.

---

## 4.12 What to know for the viva

**Q: Why three layers instead of putting the query in the route?**

"Each layer has one reason to change. The route changes when the HTTP contract changes,
the service when a business rule changes, the repository when the schema changes. With
everything in the route, all three reasons collide in one function — and authorization
has no single home, which is how the previous version ended up with four unprotected
endpoints. The layering is not ceremony; it is where I put the thing that must not be
forgotten."

**Q: Your service raises `NotFoundError` when a user lacks permission to read. Isn't
403 more accurate?**

"403 is more accurate and less secure. Returning 403 for a note that exists but isn't
yours confirms the UUID is real, so an attacker enumerating IDs learns which ones exist.
404 for both cases reveals nothing. For *writes* I do return 403, because reaching a
write on a note you can already read means its existence is not a secret from you."

**Q: You cache the graph. How do you know a user cannot see another user's cached data?**

"Two independent mechanisms. Authorization runs against the database on every request
before the cache is consulted, so a cache hit never bypasses the check. And the cache
key contains the viewer's user ID, because two authorized users see genuinely different
graphs — Alice's traversal includes her private neighbours and Bob's does not. The
earlier version of this code had the check *after* the cache read and a key with no user
in it, which meant any user who knew a UUID got the cached note."

---

**Next:** [`05-FRONTEND.md`](05-FRONTEND.md) — auth, the editor, and the graph canvas.
