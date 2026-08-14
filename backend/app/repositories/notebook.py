from collections.abc import Sequence
from uuid import UUID

from sqlalchemy import select

from app.models.workspace import Notebook
from app.repositories.base import BaseRepository


class NotebookRepository(BaseRepository[Notebook]):
    model = Notebook

    async def list_for_workspace(self, workspace_id: UUID, owner_id: UUID) -> Sequence[Notebook]:
        # Filtering on BOTH columns here is defense in depth, not the real
        # guarantee — the composite FK on `notes` already makes it
        # impossible to file a note under a notebook you don't own. This
        # filter just stops you listing someone ELSE's notebooks by
        # workspace_id alone, which the FK doesn't cover (listing isn't a
        # write).
        stmt = (
            select(Notebook)
            .where(Notebook.workspace_id == workspace_id, Notebook.owner_id == owner_id)
            .order_by(Notebook.name)
        )
        return (await self.db.execute(stmt)).scalars().all()
