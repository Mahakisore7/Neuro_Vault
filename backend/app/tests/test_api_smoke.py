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
