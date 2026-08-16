from collections.abc import Sequence
from uuid import UUID

from sqlalchemy import select

from app.models.note import Note
from app.repositories.base import BaseRepository


class NoteRepository(BaseRepository[Note]):
    model = Note

    async def list_for_user(
        self,
        user_id: UUID,
        *,
        notebook_id: UUID | None = None,
        unfiled: bool = False,
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
        # unfiled is its own flag, not "notebook_id=None" — None already
        # means "don't filter by notebook" (every note), so it can't also
        # mean "only notes with no notebook" (IS NULL) without colliding.
        if unfiled:
            stmt = stmt.where(Note.notebook_id.is_(None))
        elif notebook_id is not None:
            stmt = stmt.where(Note.notebook_id == notebook_id)
        return (await self.db.execute(stmt)).scalars().all()
