"""One HTTP-level test proving the wiring: router -> dependency -> service ->
real Postgres, exercised through actual requests instead of calling services
directly like the rest of this suite does.

Auth is overridden rather than faked with a real Supabase JWT — verifying
JWKS signatures is Supabase's job, not this test's; `get_current_user` is
swapped for a stub that returns the already-created test user, exactly the
way FastAPI's own testing docs recommend.
"""

from collections.abc import AsyncGenerator

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.dependencies import get_current_user
from app.db.session import get_db
from app.main import app
from app.models.user import User
from app.repositories.workspace import WorkspaceRepository


@pytest.fixture
async def client(db: AsyncSession, user: User) -> AsyncGenerator[AsyncClient, None]:
    async def _get_db_override() -> AsyncGenerator[AsyncSession, None]:
        yield db

    async def _get_current_user_override() -> User:
        return user

    app.dependency_overrides[get_db] = _get_db_override
    app.dependency_overrides[get_current_user] = _get_current_user_override
    try:
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as ac:
            yield ac
    finally:
        app.dependency_overrides.clear()


async def test_health_check(client: AsyncClient):
    response = await client.get("/health")
    assert response.status_code == 200


async def test_create_and_fetch_note_round_trip(client: AsyncClient):
    create_response = await client.post(
        "/api/v1/notes", json={"title": "From the API", "content": "<p>hello</p>"}
    )
    assert create_response.status_code == 201
    body = create_response.json()
    assert body["word_count"] == 1

    get_response = await client.get(f"/api/v1/notes/{body['id']}")
    assert get_response.status_code == 200
    assert get_response.json()["title"] == "From the API"


async def test_delete_note_returns_it_as_archived_not_gone(client: AsyncClient):
    create_response = await client.post("/api/v1/notes", json={"title": "Temp", "content": "x"})
    note_id = create_response.json()["id"]

    delete_response = await client.delete(f"/api/v1/notes/{note_id}")
    assert delete_response.status_code == 204

    get_response = await client.get(f"/api/v1/notes/{note_id}")
    assert get_response.status_code == 200
    assert get_response.json()["archived"] is True


async def test_collection_round_trip_over_http(client: AsyncClient):
    a = (await client.post("/api/v1/notes", json={"title": "A"})).json()["id"]
    b = (await client.post("/api/v1/notes", json={"title": "B"})).json()["id"]
    col = (await client.post("/api/v1/collections", json={"name": "Over HTTP"})).json()["id"]
    for note_id in (a, b):
        await client.post(f"/api/v1/collections/{col}/items", json={"note_id": note_id})

    response = await client.put(f"/api/v1/collections/{col}/items/order", json={"note_ids": [b, a]})

    assert response.status_code == 200
    assert [i["title"] for i in response.json()["items"]] == ["B", "A"]
    duplicate = await client.post("/api/v1/collections", json={"name": "Over HTTP"})
    assert duplicate.status_code == 409


async def test_flashcard_review_loop_over_http(client: AsyncClient):
    """Also pins route order: /flashcards/due and /summary must not be parsed
    as /flashcards/{card_id}."""
    note_id = (await client.post("/api/v1/notes", json={"title": "Joins"})).json()["id"]
    card = await client.post(
        "/api/v1/flashcards",
        json={"note_id": note_id, "question": "LEFT JOIN keeps?", "answer": "Unmatched left rows"},
    )
    assert card.status_code == 201
    card_id = card.json()["id"]

    due = await client.get("/api/v1/flashcards/due")
    assert due.status_code == 200
    assert [c["note_title"] for c in due.json()] == ["Joins"]

    bad = await client.post(f"/api/v1/flashcards/{card_id}/review", json={"quality": 6})
    assert bad.status_code == 422
    reviewed = await client.post(f"/api/v1/flashcards/{card_id}/review", json={"quality": 5})
    assert reviewed.json()["repetitions"] == 1

    summary = (await client.get("/api/v1/flashcards/summary")).json()
    assert (summary["total"], summary["due"]) == (1, 0)


async def test_activity_and_notification_routes_over_http(client: AsyncClient):
    """/notifications/unread-count and /read-all must not be parsed as
    /notifications/{notification_id}; the feed reflects trigger-written rows."""
    await client.post("/api/v1/notes", json={"title": "Logged by a trigger"})

    feed = await client.get("/api/v1/activity")
    assert feed.status_code == 200
    assert feed.json()[0]["metadata"]["event"] == "created"

    unread = await client.get("/api/v1/notifications/unread-count")
    assert (unread.status_code, unread.json()) == (200, {"count": 0})
    assert (await client.post("/api/v1/notifications/read-all")).status_code == 204
    assert (await client.post("/api/v1/notifications/999999999/read")).status_code == 404


async def test_search_route_is_not_swallowed_by_note_id_route(client: AsyncClient):
    """GET /notes/search must resolve to search, not to GET /notes/{note_id}
    with note_id="search" (which would be a 422 UUID error)."""
    await client.post("/api/v1/notes", json={"title": "Searchable", "content": "<p>zebra</p>"})

    response = await client.get("/api/v1/notes/search", params={"q": "zebra"})

    assert response.status_code == 200
    assert [r["title"] for r in response.json()] == ["Searchable"]


async def test_purge_over_http_is_two_step(client: AsyncClient):
    note_id = (await client.post("/api/v1/notes", json={"title": "Bin me"})).json()["id"]

    assert (await client.delete(f"/api/v1/notes/{note_id}/permanent")).status_code == 422

    await client.delete(f"/api/v1/notes/{note_id}")
    assert (await client.delete(f"/api/v1/notes/{note_id}/permanent")).status_code == 204
    assert (await client.get(f"/api/v1/notes/{note_id}")).status_code == 404


async def test_note_graph_round_trip_over_http(client: AsyncClient):
    a = (await client.post("/api/v1/notes", json={"title": "A"})).json()
    b = (await client.post("/api/v1/notes", json={"title": "B"})).json()

    link_response = await client.post(
        f"/api/v1/notes/{a['id']}/links",
        json={"target_note_id": b["id"], "rel_type_id": 1},
    )
    assert link_response.status_code == 201

    graph_response = await client.get(f"/api/v1/notes/{a['id']}/graph")
    assert graph_response.status_code == 200
    graph = graph_response.json()
    assert {node["id"] for node in graph["nodes"]} == {a["id"], b["id"]}
    assert len(graph["edges"]) == 1


async def test_note_graph_rejects_max_depth_over_the_configured_ceiling(client: AsyncClient):
    a = (await client.post("/api/v1/notes", json={"title": "A"})).json()

    response = await client.get(f"/api/v1/notes/{a['id']}/graph", params={"max_depth": 999})
    assert response.status_code == 422


async def test_cross_tenant_notebook_create_is_a_clean_404(client: AsyncClient, make_user, db):
    """workspace belongs to a different user - see test_tenancy_constraint.py
    for the same rule proven at the database layer.
    """
    other_user = await make_user(display_name="Owner")
    other_workspace = await WorkspaceRepository(db).create(
        owner_id=other_user.id, name="Not yours", slug="not-yours"
    )

    response = await client.post(
        "/api/v1/notebooks",
        json={"workspace_id": str(other_workspace.id), "name": "Sneaky", "color": "#4CAF50"},
    )
    assert response.status_code == 404
