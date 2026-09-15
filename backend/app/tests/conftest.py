from collections.abc import AsyncGenerator
from uuid import uuid4

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import engine
from app.models.user import User
from app.models.workspace import Notebook, Workspace
from app.repositories.notebook import NotebookRepository
from app.repositories.workspace import WorkspaceRepository


@pytest.fixture
async def db() -> AsyncGenerator[AsyncSession, None]:
    """One test, one transaction, always rolled back.

    Tests run against the real database — the same one docs/viva-sql-practice.md
    was verified against — so triggers, generated columns, and constraints all
    behave exactly as they do in production. `join_transaction_mode` nests any
    flush/commit a service performs inside a SAVEPOINT rather than the outer
    transaction, so no matter what the code under test does, the final
    `rollback()` below discards all of it. Nothing a test writes outlives it.
    """
    connection = await engine.connect()
    trans = await connection.begin()
    session = AsyncSession(
        bind=connection, join_transaction_mode="create_savepoint", expire_on_commit=False
    )
    try:
        yield session
    finally:
        await session.close()
        await trans.rollback()
        await connection.close()


@pytest.fixture
async def make_user(db: AsyncSession):
    """Factory, not a single fixture: tests like the cross-tenant composite-FK
    demo need two distinct users in the same test.
    """

    async def _make(*, email: str | None = None, display_name: str = "Test User") -> User:
        user = User(
            id=uuid4(),
            email=email or f"{uuid4()}@example.test",
            display_name=display_name,
        )
        db.add(user)
        await db.flush()
        return user

    return _make


@pytest.fixture
async def user(make_user) -> User:
    return await make_user(email="viva.demo@example.test", display_name="Viva Demo User")


@pytest.fixture
async def workspace(db: AsyncSession, user: User) -> Workspace:
    return await WorkspaceRepository(db).create(
        owner_id=user.id, name="Semester 5", slug="sem-5", description="DBMS coursework"
    )


@pytest.fixture
async def notebook(db: AsyncSession, user: User, workspace: Workspace) -> Notebook:
    return await NotebookRepository(db).create(
        workspace_id=workspace.id, owner_id=user.id, name="DBMS", color="#4CAF50"
    )
