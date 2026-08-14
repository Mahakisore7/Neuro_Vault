from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import NotFoundError, PermissionDeniedError
from app.models.user import User
from app.models.workspace import Workspace
from app.repositories.workspace import WorkspaceRepository
from app.schemas.workspace import WorkspaceCreate, WorkspaceResponse, WorkspaceUpdate


class WorkspaceService:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db
        self.workspaces = WorkspaceRepository(db)

    @staticmethod
    def _assert_owner(workspace: Workspace, user: User) -> None:
        """Unlike notes, a workspace has no public/private split - it's
        never readable by anyone but its owner, so there's only one check
        here instead of a separate _assert_can_read / _assert_can_write.
        """
        if workspace.owner_id != user.id:
            raise PermissionDeniedError("access this workspace")

    async def list(self, user: User) -> list[WorkspaceResponse]:
        workspaces = await self.workspaces.list_for_owner(user.id)
        return [WorkspaceResponse.model_validate(w) for w in workspaces]

    async def get(self, workspace_id: UUID, user: User) -> WorkspaceResponse:
        workspace = await self.workspaces.get(workspace_id)
        if workspace is None:
            raise NotFoundError("Workspace", workspace_id)
        self._assert_owner(workspace, user)
        return WorkspaceResponse.model_validate(workspace)

    async def create(self, payload: WorkspaceCreate, user: User) -> WorkspaceResponse:
        # No pre-check needed here the way notebooks/notes need one: a
        # workspace's only relationship is to its owner, and owner_id is
        # about to be set from the authenticated user directly below - there
        # is no OTHER row whose ownership needs verifying first. Uniqueness
        # (same owner, same slug) is caught by the DB's UNIQUE constraint
        # and surfaces as a 500 today; Stage 3's remaining work is exactly
        # this kind of gap to close with a ConflictError, table by table.
        workspace = await self.workspaces.create(
            owner_id=user.id,
            name=payload.name,
            slug=payload.slug,
            description=payload.description,
        )
        return WorkspaceResponse.model_validate(workspace)

    async def update(
        self, workspace_id: UUID, payload: WorkspaceUpdate, user: User
    ) -> WorkspaceResponse:
        workspace = await self.workspaces.get(workspace_id)
        if workspace is None:
            raise NotFoundError("Workspace", workspace_id)
        self._assert_owner(workspace, user)

        for field, value in payload.model_dump(exclude_unset=True).items():
            setattr(workspace, field, value)

        await self.db.flush()
        await self.db.refresh(workspace)
        return WorkspaceResponse.model_validate(workspace)

    async def delete(self, workspace_id: UUID, user: User) -> None:
        workspace = await self.workspaces.get(workspace_id)
        if workspace is None:
            raise NotFoundError("Workspace", workspace_id)
        self._assert_owner(workspace, user)
        # A real DELETE, unlike notes (which archive - see NoteService).
        # A workspace itself has no version history to protect. Deleting it
        # CASCADEs to its notebooks (Notebook's FK to Workspace is CASCADE),
        # but the notes that were IN those notebooks are NOT deleted - each
        # note's FK to its notebook is SET NULL, so notes survive as
        # unfiled rather than disappearing. Two different deletion
        # semantics, one level apart, both deliberate.
        await self.workspaces.delete(workspace)
