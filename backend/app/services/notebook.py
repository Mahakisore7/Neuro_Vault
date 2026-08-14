from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import NotFoundError, PermissionDeniedError
from app.models.user import User
from app.models.workspace import Notebook
from app.repositories.notebook import NotebookRepository
from app.repositories.workspace import WorkspaceRepository
from app.schemas.notebook import NotebookCreate, NotebookResponse, NotebookUpdate


class NotebookService:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db
        self.notebooks = NotebookRepository(db)
        self.workspaces = WorkspaceRepository(db)

    @staticmethod
    def _assert_owner(notebook: Notebook, user: User) -> None:
        if notebook.owner_id != user.id:
            raise PermissionDeniedError("access this notebook")

    async def list(self, workspace_id: UUID, user: User) -> list[NotebookResponse]:
        notebooks = await self.notebooks.list_for_workspace(workspace_id, user.id)
        return [NotebookResponse.model_validate(n) for n in notebooks]

    async def get(self, notebook_id: UUID, user: User) -> NotebookResponse:
        notebook = await self.notebooks.get(notebook_id)
        if notebook is None:
            raise NotFoundError("Notebook", notebook_id)
        self._assert_owner(notebook, user)
        return NotebookResponse.model_validate(notebook)

    async def create(self, payload: NotebookCreate, user: User) -> NotebookResponse:
        # Check the PARENT's ownership before inserting. The composite FK
        # (workspace_id, owner_id) -> workspaces(id, owner_id) would reject
        # this anyway if payload.workspace_id belonged to someone else - but
        # a foreign-key violation reaches the client as a raw asyncpg/
        # Postgres error, a 500 with a stack trace, not a clean 404. Checking
        # first turns a database-level failure into a normal domain error the
        # client can actually act on. The FK is still there as the real
        # guarantee; this check is about the QUALITY of the failure, not its
        # existence.
        workspace = await self.workspaces.get(payload.workspace_id)
        if workspace is None or workspace.owner_id != user.id:
            raise NotFoundError("Workspace", payload.workspace_id)

        notebook = await self.notebooks.create(
            workspace_id=payload.workspace_id,
            owner_id=user.id,
            name=payload.name,
            description=payload.description,
            color=payload.color,
        )
        return NotebookResponse.model_validate(notebook)

    async def update(
        self, notebook_id: UUID, payload: NotebookUpdate, user: User
    ) -> NotebookResponse:
        notebook = await self.notebooks.get(notebook_id)
        if notebook is None:
            raise NotFoundError("Notebook", notebook_id)
        self._assert_owner(notebook, user)

        for field, value in payload.model_dump(exclude_unset=True).items():
            setattr(notebook, field, value)

        await self.db.flush()
        await self.db.refresh(notebook)
        return NotebookResponse.model_validate(notebook)

    async def delete(self, notebook_id: UUID, user: User) -> None:
        notebook = await self.notebooks.get(notebook_id)
        if notebook is None:
            raise NotFoundError("Notebook", notebook_id)
        self._assert_owner(notebook, user)
        # Deleting a notebook does NOT delete its notes - notes.notebook_id
        # is ON DELETE SET NULL (notebook_id), the PostgreSQL 15+
        # column-list form (02-DATABASE.md §2.4). They become unfiled, not
        # gone. A plain SET NULL on this composite FK would also try to
        # null creator_id, which is NOT NULL, and the delete would fail
        # outright the first time a notebook with notes in it was deleted.
        await self.notebooks.delete(notebook)
