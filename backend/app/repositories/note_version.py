from collections.abc import Sequence
from uuid import UUID

from sqlalchemy import select

from app.models.note import NoteVersion
from app.repositories.base import BaseRepository


class NoteVersionRepository(BaseRepository[NoteVersion]):
    model = NoteVersion

    async def list_for_note(self, note_id: UUID) -> Sequence[NoteVersion]:
        stmt = (
            select(NoteVersion)
            .where(NoteVersion.note_id == note_id)
            .order_by(NoteVersion.version_num.desc())
        )
        return (await self.db.execute(stmt)).scalars().all()

    async def get_by_version_num(self, note_id: UUID, version_num: int) -> NoteVersion | None:
        stmt = select(NoteVersion).where(
            NoteVersion.note_id == note_id, NoteVersion.version_num == version_num
        )
        return (await self.db.execute(stmt)).scalar_one_or_none()
