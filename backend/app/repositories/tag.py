from collections.abc import Sequence
from uuid import UUID

from sqlalchemy import select

from app.models.tag import NoteTag, Tag
from app.repositories.base import BaseRepository


class TagRepository(BaseRepository[Tag]):
    model = Tag

    async def list_for_user(self, user_id: UUID) -> Sequence[Tag]:
        stmt = select(Tag).where(Tag.user_id == user_id).order_by(Tag.name)
        return (await self.db.execute(stmt)).scalars().all()

    async def list_for_note(self, note_id: UUID) -> Sequence[Tag]:
        stmt = (
            select(Tag)
            .join(NoteTag, NoteTag.tag_id == Tag.id)
            .where(NoteTag.note_id == note_id)
            .order_by(Tag.name)
        )
        return (await self.db.execute(stmt)).scalars().all()

    async def get_note_tag(self, note_id: UUID, tag_id: int) -> NoteTag | None:
        stmt = select(NoteTag).where(NoteTag.note_id == note_id, NoteTag.tag_id == tag_id)
        return (await self.db.execute(stmt)).scalar_one_or_none()

    async def attach(self, note_id: UUID, tag_id: int, owner_id: UUID) -> NoteTag:
        note_tag = NoteTag(note_id=note_id, tag_id=tag_id, owner_id=owner_id)
        self.db.add(note_tag)
        await self.db.flush()
        return note_tag

    async def detach(self, note_tag: NoteTag) -> None:
        await self.db.delete(note_tag)
        await self.db.flush()
