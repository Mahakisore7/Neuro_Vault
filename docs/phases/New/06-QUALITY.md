# Phase 6 — Testing and Quality

**Goal:** tests that prove the *database* works, not just that Python runs.

**Time:** ~4 hours · **Prerequisite:** [`05-FRONTEND.md`](05-FRONTEND.md)

**Done when:** `uv run pytest` and `pnpm test` pass locally and in CI.

---

## 6.1 Tests run against real PostgreSQL. Not SQLite.

This is the single most important decision in the phase, and it is non-negotiable here.

| Feature this project depends on | Exists in SQLite? |
|---|---|
| `WITH RECURSIVE` with `ARRAY` cycle detection | ❌ no array type |
| `tsvector`, `GIN`, `ts_rank_cd` | ❌ |
| `GENERATED ALWAYS AS ... STORED` | ⚠️ partial, different semantics |
| PL/pgSQL triggers | ❌ |
| `JSONB` operators (`@>`, `->>`, `?`) | ❌ |
| Composite FK with `ON DELETE SET NULL (col)` | ❌ |
| Row Level Security | ❌ |

A SQLite test suite would pass while every feature this project is graded on is
untested. **Tests that cannot fail are worse than no tests**, because they produce a
green badge that means nothing.

`docker compose up -d db` gives you the real thing in two seconds; CI already runs a
`postgres:16-alpine` service (§1.12). There is no reason to fake it.

> **Viva question:** *Why not use SQLite for speed?*
>
> "Because none of the features I'd be testing exist in SQLite — no recursive CTE with
> arrays, no tsvector, no PL/pgSQL, no JSONB operators. The tests would pass against a
> database that behaves nothing like production. A test suite's value is entirely in the
> failures it can produce, and that one could not produce any of the ones I care about."

---

## 6.2 Fixtures

```python
# backend/app/tests/conftest.py
import asyncio
from collections.abc import AsyncGenerator
from uuid import UUID, uuid4

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.core.dependencies import get_current_user
from app.db.session import engine, get_db
from app.main import app
from app.models.user import User


@pytest.fixture(scope="session")
def event_loop():
    loop = asyncio.new_event_loop()
    yield loop
    loop.close()


@pytest.fixture
async def db() -> AsyncGenerator[AsyncSession, None]:
    """Each test runs inside a transaction that is ALWAYS rolled back.

    The session is bound to an outer connection-level transaction. Anything the
    test writes — including anything a trigger writes — is discarded at teardown.
    Tests therefore share one migrated database with no cleanup code, no ordering
    dependencies, and no possibility of leaking state into each other.
    """
    connection = await engine.connect()
    transaction = await connection.begin()
    session = async_sessionmaker(bind=connection, expire_on_commit=False)()

    # Nested transaction: the code under test may call commit(), which commits
    # the SAVEPOINT rather than the outer transaction. The rollback below still
    # discards everything.
    await connection.begin_nested()

    try:
        yield session
    finally:
        await session.close()
        await transaction.rollback()
        await connection.close()


@pytest.fixture
async def alice(db: AsyncSession) -> User:
    user = User(id=uuid4(), email=f"alice-{uuid4().hex[:8]}@test.local",
                display_name="Alice")
    db.add(user)
    await db.flush()
    return user


@pytest.fixture
async def bob(db: AsyncSession) -> User:
    user = User(id=uuid4(), email=f"bob-{uuid4().hex[:8]}@test.local",
                display_name="Bob")
    db.add(user)
    await db.flush()
    return user


@pytest.fixture
async def client(db: AsyncSession, alice: User) -> AsyncGenerator[AsyncClient, None]:
    """An HTTP client authenticated as Alice.

    Both get_db and get_current_user are overridden. Overriding auth means the
    tests do not need to mint real Supabase JWTs — that is Supabase's code, not
    ours, and testing it would be testing someone else's library.
    """
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: alice

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac

    app.dependency_overrides.clear()


@pytest.fixture
async def bob_client(db: AsyncSession, bob: User) -> AsyncGenerator[AsyncClient, None]:
    """A second authenticated client — this is what makes authorization testable."""
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: bob

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac

    app.dependency_overrides.clear()
```

**The rollback-per-test pattern is the one to understand.** Every test starts from the
same migrated schema and ends with its writes discarded. No `DELETE FROM` teardown, no
test ordering, no flakiness from leftover rows. It is the standard approach in every
mature Python codebase using SQLAlchemy.

**`ASGITransport` calls the app in-process** — no port, no server, no network. Fast, and
the test can share the same session object the app is using, which is what makes the
rollback work.

---

## 6.3 The tests that matter

### The most important test in the project

```python
# backend/app/tests/test_triggers.py
import pytest
from httpx import AsyncClient
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.note import NoteVersion


async def test_update_creates_version(client: AsyncClient, db: AsyncSession):
    """Proves a PostgreSQL trigger fires, observed through the HTTP API.

    Nothing in app/ creates a NoteVersion. If this passes, the trigger ran.
    """
    created = await client.post("/api/v1/notes", json={
        "title": "Original", "content": "<p>First draft</p>",
    })
    assert created.status_code == 201
    note_id = created.json()["id"]

    # No versions yet — a version records a PREVIOUS state, and there isn't one.
    versions = (await db.execute(
        select(NoteVersion).where(NoteVersion.note_id == note_id)
    )).scalars().all()
    assert len(versions) == 0

    updated = await client.patch(f"/api/v1/notes/{note_id}",
                                 json={"content": "<p>Second draft</p>"})
    assert updated.status_code == 200

    versions = (await db.execute(
        select(NoteVersion).where(NoteVersion.note_id == note_id)
    )).scalars().all()
    assert len(versions) == 1
    assert versions[0].version_num == 1
    assert versions[0].content == "<p>First draft</p>"   # the OLD content


async def test_no_version_when_content_unchanged(client: AsyncClient, db: AsyncSession):
    """The trigger's IS DISTINCT FROM guard: metadata-only edits are not history."""
    note_id = (await client.post("/api/v1/notes", json={
        "title": "Stable", "content": "<p>Body</p>",
    })).json()["id"]

    await client.patch(f"/api/v1/notes/{note_id}", json={"pinned": True})

    count = (await db.execute(
        select(NoteVersion).where(NoteVersion.note_id == note_id)
    )).scalars().all()
    assert len(count) == 0


async def test_generated_columns(client: AsyncClient):
    """word_count is computed by PostgreSQL, and HTML tags are not words."""
    response = await client.post("/api/v1/notes", json={
        "title": "Counting", "content": "<p>one two three</p><p>four</p>",
    })
    assert response.json()["word_count"] == 4


async def test_word_count_is_unwritable(db: AsyncSession, alice):
    """The column rejects direct writes — the guarantee the design depends on."""
    from app.models.note import Note

    note = Note(creator_id=alice.id, title="T", content="<p>a b c</p>")
    db.add(note)
    await db.flush()

    with pytest.raises(Exception) as exc:
        await db.execute(text("UPDATE notes SET word_count = 999 WHERE id = :id"),
                         {"id": note.id})
    assert "can only be updated to DEFAULT" in str(exc.value)
```

### Wiki-link reconciliation

The property worth locking in with a test is not "a link gets created" — it's that the
reconciler never touches a row it did not create. That guarantee is the entire reason
`origin` exists (04-API.md §4.9), and it is exactly the kind of thing that breaks
silently: get it wrong and a user's hand-picked "contradicts" edge quietly vanishes the
next time they edit an unrelated sentence in the note.

```python
# backend/app/tests/test_wiki_links.py
from sqlalchemy import select

from app.models.link import KnowledgeLink


async def test_wiki_link_creates_edge(client: AsyncClient, db: AsyncSession):
    target = (await client.post("/api/v1/notes", json={"title": "BCNF"})).json()
    source = (await client.post("/api/v1/notes", json={
        "title": "Normalization", "content": "<p>See [[BCNF]] for details.</p>",
    })).json()

    edges = (await db.execute(
        select(KnowledgeLink).where(KnowledgeLink.source_note_id == source["id"])
    )).scalars().all()
    assert len(edges) == 1
    assert str(edges[0].target_note_id) == target["id"]
    assert edges[0].origin == "wiki"


async def test_removing_the_reference_deletes_the_wiki_edge(client: AsyncClient, db: AsyncSession):
    target = (await client.post("/api/v1/notes", json={"title": "BCNF"})).json()
    source = (await client.post("/api/v1/notes", json={
        "title": "Normalization", "content": "<p>See [[BCNF]].</p>",
    })).json()

    await client.patch(f"/api/v1/notes/{source['id']}",
                       json={"content": "<p>No longer mentioning it.</p>"})

    edges = (await db.execute(
        select(KnowledgeLink).where(KnowledgeLink.source_note_id == source["id"])
    )).scalars().all()
    assert len(edges) == 0


async def test_reconciler_never_deletes_a_manual_edge(client: AsyncClient, db: AsyncSession):
    """The guarantee that actually matters. Getting this wrong silently
    destroys a user's deliberate work as a side effect of an unrelated edit."""
    target = (await client.post("/api/v1/notes", json={"title": "BCNF"})).json()
    source = (await client.post("/api/v1/notes", json={
        "title": "Normalization", "content": "<p>See [[BCNF]].</p>",
    })).json()

    # The user ALSO hand-creates a link to the same target, with a type they chose.
    await client.post("/api/v1/links", json={
        "source_note_id": source["id"], "target_note_id": target["id"],
        "rel_type_id": 4,  # 'prerequisite' — deliberately not 'related'
    })

    # They edit the note and remove the [[BCNF]] reference entirely.
    await client.patch(f"/api/v1/notes/{source['id']}",
                       json={"content": "<p>Rewritten, no bracket syntax now.</p>"})

    edges = (await db.execute(
        select(KnowledgeLink).where(KnowledgeLink.source_note_id == source["id"])
    )).scalars().all()
    # The wiki edge is gone. The manually created one survives untouched.
    assert len(edges) == 1
    assert edges[0].origin == "manual"
    assert edges[0].rel_type_id == 4


async def test_unresolved_title_reported_not_errored(client: AsyncClient):
    response = await client.post("/api/v1/notes", json={
        "title": "Draft", "content": "<p>References [[A Note That Does Not Exist]].</p>",
    })
    assert response.status_code == 201
    assert response.json()["unresolved_wiki_links"] == ["A Note That Does Not Exist"]
```

**`test_reconciler_never_deletes_a_manual_edge` is the one to run in front of an
examiner.** It exercises the exact failure mode `origin` was added to prevent, and it
fails immediately if that column is ever dropped or the `WHERE origin = 'wiki'` clause
is ever loosened.

### The recursive CTE, including the cycle

```python
# backend/app/tests/test_graph.py
async def test_traversal_respects_depth(client: AsyncClient):
    ids = [
        (await client.post("/api/v1/notes", json={"title": f"N{i}"})).json()["id"]
        for i in range(4)
    ]
    for a, b in zip(ids, ids[1:]):
        await client.post("/api/v1/links", json={
            "source_note_id": a, "target_note_id": b, "rel_type_id": 1,
        })

    depth1 = await client.get(f"/api/v1/notes/{ids[0]}/graph?depth=1")
    assert len(depth1.json()["nodes"]) == 2      # root + 1 hop

    depth3 = await client.get(f"/api/v1/notes/{ids[0]}/graph?depth=3")
    assert len(depth3.json()["nodes"]) == 4      # the whole chain


async def test_traversal_terminates_on_a_cycle(client: AsyncClient):
    """A → B → C → A. Without the visited_path check this never returns."""
    a, b, c = [
        (await client.post("/api/v1/notes", json={"title": t})).json()["id"]
        for t in ("A", "B", "C")
    ]
    for src, tgt in ((a, b), (b, c), (c, a)):
        await client.post("/api/v1/links", json={
            "source_note_id": src, "target_note_id": tgt, "rel_type_id": 1,
        })

    response = await client.get(f"/api/v1/notes/{a}/graph?depth=5")
    assert response.status_code == 200
    assert len(response.json()["nodes"]) == 3    # each node exactly once


async def test_depth_is_bounded(client: AsyncClient):
    note_id = (await client.post("/api/v1/notes", json={"title": "X"})).json()["id"]
    response = await client.get(f"/api/v1/notes/{note_id}/graph?depth=50")
    assert response.status_code == 422           # rejected before any SQL runs
```

**`test_traversal_terminates_on_a_cycle` has a hard timeout by nature** — if cycle
prevention breaks, this test hangs rather than failing. Add `--timeout` via
`pytest-timeout` if you want it to fail fast; either way, a hang in CI is a signal.

### Authorization — the matrix

```python
# backend/app/tests/test_authorization.py
async def test_cannot_read_another_users_private_note(client, bob_client):
    note_id = (await client.post("/api/v1/notes", json={
        "title": "Private", "is_public": False,
    })).json()["id"]

    response = await bob_client.get(f"/api/v1/notes/{note_id}")
    assert response.status_code == 404    # NOT 403 — no existence leak


async def test_can_read_another_users_public_note(client, bob_client):
    note_id = (await client.post("/api/v1/notes", json={
        "title": "Public", "is_public": True,
    })).json()["id"]

    assert (await bob_client.get(f"/api/v1/notes/{note_id}")).status_code == 200


async def test_cannot_write_another_users_public_note(client, bob_client):
    """Public means readable, not writable."""
    note_id = (await client.post("/api/v1/notes", json={
        "title": "Public", "is_public": True,
    })).json()["id"]

    response = await bob_client.patch(f"/api/v1/notes/{note_id}",
                                      json={"title": "Hijacked"})
    assert response.status_code == 403


async def test_cannot_read_another_users_links(client, bob_client):
    """One of the four endpoints that previously had NO authorization."""
    note_id = (await client.post("/api/v1/notes", json={"title": "Private"})).json()["id"]
    assert (await bob_client.get(f"/api/v1/notes/{note_id}/links")).status_code == 404


async def test_cross_tenant_insert_is_rejected_by_the_database(db, alice, bob):
    """Not by a service check — by the composite foreign key itself."""
    from sqlalchemy.exc import IntegrityError

    from app.models.note import Note
    from app.models.workspace import Notebook, Workspace

    ws = Workspace(owner_id=alice.id, name="Alice WS", slug="alice-ws")
    db.add(ws)
    await db.flush()
    nb = Notebook(workspace_id=ws.id, owner_id=alice.id, name="Alice NB")
    db.add(nb)
    await db.flush()

    db.add(Note(creator_id=bob.id, notebook_id=nb.id, title="Sneaky"))
    with pytest.raises(IntegrityError):
        await db.flush()
```

**That last test is the one to show an examiner.** It proves the tenancy guarantee is
structural — no service was involved, and the database refused.

### Anonymous access

```python
# backend/app/tests/test_auth.py
async def test_missing_token_returns_401():
    """No dependency overrides here — the real auth dependency runs."""
    from httpx import ASGITransport, AsyncClient

    from app.main import app

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        assert (await ac.get("/api/v1/notes")).status_code == 401
```

**Verified: FastAPI's `HTTPBearer(auto_error=True)` returns 401 on a missing
`Authorization` header** on FastAPI 0.141 — not 403, which is what an older and
widely-copied version of this test asserted.

---

## 6.4 Frontend tests

```ts
// frontend/vitest.config.ts
import react from "@vitejs/plugin-react";
import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/tests/setup.ts"],
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
});
```

```ts
// frontend/src/tests/setup.ts
import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

afterEach(cleanup);

// Supabase is someone else's code. Mocking it at the module boundary keeps the
// tests about OUR components and removes the network entirely.
vi.mock("@/lib/supabase", () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: null } }),
      signInWithPassword: vi.fn(),
      onAuthStateChange: vi.fn().mockReturnValue({
        data: { subscription: { unsubscribe: vi.fn() } },
      }),
    },
  },
}));
```

```tsx
// frontend/src/tests/login.test.tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import LoginPage from "@/app/(auth)/login/page";
import { supabase } from "@/lib/supabase";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

describe("LoginPage", () => {
  it("rejects an invalid email before calling the API", async () => {
    render(<LoginPage />);
    await userEvent.type(screen.getByLabelText(/email/i), "not-an-email");
    await userEvent.type(screen.getByLabelText(/password/i), "password123");
    await userEvent.click(screen.getByRole("button", { name: /sign in/i }));

    expect(await screen.findByText(/valid email/i)).toBeInTheDocument();
    expect(supabase.auth.signInWithPassword).not.toHaveBeenCalled();
  });

  it("shows a generic message on bad credentials", async () => {
    vi.mocked(supabase.auth.signInWithPassword).mockResolvedValue({
      data: { user: null, session: null },
      error: { message: "Invalid login credentials" },
    } as never);

    render(<LoginPage />);
    await userEvent.type(screen.getByLabelText(/email/i), "a@b.com");
    await userEvent.type(screen.getByLabelText(/password/i), "password123");
    await userEvent.click(screen.getByRole("button", { name: /sign in/i }));

    // Generic on purpose — see §5.5. This test locks that property in.
    expect(await screen.findByText(/incorrect email or password/i)).toBeInTheDocument();
  });
});
```

**`getByLabelText`, not `getByTestId`.** Querying the way a user (or a screen reader)
finds the field means the test fails if the label is removed — which is an accessibility
regression the test catches for free.

---

## 6.5 What to test, and what not to

| Test | Skip |
|---|---|
| Triggers fire and write the right rows | That SQLAlchemy can insert a row |
| The recursive CTE terminates and bounds depth | That FastAPI parses JSON |
| Authorization for owner / non-owner / anonymous | That Pydantic rejects a bad type |
| Generated columns compute and reject writes | That Supabase's login works |
| Composite FKs reject cross-tenant writes | Getters and setters |
| Cache key isolation between users | Third-party library behaviour |

**Coverage percentage is not a goal.** 100% coverage with no trigger test proves less
than 40% coverage with one. Aim the tests at the things that are *yours* and would
*silently* break.

---

## 6.6 Phase 6 checklist

```
□ uv run pytest passes against a real PostgreSQL container
□ test_update_creates_version passes  ← the flagship
□ test_traversal_terminates_on_a_cycle completes (does not hang)
□ Every row of the §4.10 authorization table has a test
□ test_reconciler_never_deletes_a_manual_edge passes
□ pnpm test passes
□ Both CI workflows green on a pull request
□ Deliberately break a trigger in a migration → the test suite goes red
```

**Do the last one once.** A test suite you have never seen fail is a test suite you have
no evidence works. Comment out the `INSERT` in `fn_create_note_version`, run
`alembic upgrade head`, watch `test_update_creates_version` fail, then revert. Now you
know.

---

**Next:** [`07-DEPLOY.md`](07-DEPLOY.md).
