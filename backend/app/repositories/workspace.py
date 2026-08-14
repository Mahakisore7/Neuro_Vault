from collections.abc import Sequence
from uuid import UUID

from sqlalchemy import select

from app.models.workspace import Workspace
from app.repositories.base import BaseRepository


class WorkspaceRepository(BaseRepository[Workspace]):
    model = Workspace

    async def list_for_owner(self, owner_id: UUID) -> Sequence[Workspace]:
        stmt = (
            select(Workspace)
            .where(Workspace.owner_id == owner_id)
            .order_by(Workspace.created_at)
        )
        return (await self.db.execute(stmt)).scalars().all()
