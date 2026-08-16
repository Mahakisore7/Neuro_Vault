from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import NotFoundError, PermissionDeniedError
from app.models.tag import Tag
from app.models.user import User
from app.repositories.note import NoteRepository
from app.repositories.tag import TagRepository
from app.schemas.tag import TagCreate, TagResponse, TagUpdate


class TagService:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db
        self.tags = TagRepository(db)
        self.notes = NoteRepository(db)

    @staticmethod
    def _assert_owner(tag: Tag, user: User) -> None:
        if tag.user_id != user.id:
            raise PermissionDeniedError("access this tag")

    # list_for_note lives above list() on purpose: a method named `list`
    # shadows the builtin for every annotation written after it in this
    # class body (see NoteService for the same fix, with a longer note).
    async def list_for_note(self, note_id: UUID, user: User) -> list[TagResponse]:
        note = await self.notes.get(note_id)
        if note is None:
            raise NotFoundError("Note", note_id)
        if note.creator_id != user.id:
            raise PermissionDeniedError("view tags on this note")
        tags = await self.tags.list_for_note(note_id)
        return [TagResponse.model_validate(t) for t in tags]

    async def list(self, user: User) -> list[TagResponse]:
        tags = await self.tags.list_for_user(user.id)
        return [TagResponse.model_validate(t) for t in tags]

    async def create(self, payload: TagCreate, user: User) -> TagResponse:
        # Same gap as WorkspaceService.create: a duplicate (user_id, slug)
        # surfaces as a 500 from the DB's UNIQUE constraint today, not a
        # ConflictError. Consistent with the rest of this codebase's current
        # state rather than special-cased for tags alone.
        tag = await self.tags.create(
            user_id=user.id, name=payload.name, slug=payload.slug, color=payload.color
        )
        return TagResponse.model_validate(tag)

    async def update(self, tag_id: int, payload: TagUpdate, user: User) -> TagResponse:
        tag = await self.tags.get(tag_id)
        if tag is None:
            raise NotFoundError("Tag", tag_id)
        self._assert_owner(tag, user)

        for field, value in payload.model_dump(exclude_unset=True).items():
            setattr(tag, field, value)

        await self.db.flush()
        await self.db.refresh(tag)
        return TagResponse.model_validate(tag)

    async def delete(self, tag_id: int, user: User) -> None:
        tag = await self.tags.get(tag_id)
        if tag is None:
            raise NotFoundError("Tag", tag_id)
        self._assert_owner(tag, user)
        await self.tags.delete(tag)

    async def attach_to_note(self, note_id: UUID, tag_id: int, user: User) -> None:
        note = await self.notes.get(note_id)
        if note is None:
            raise NotFoundError("Note", note_id)
        if note.creator_id != user.id:
            raise PermissionDeniedError("tag this note")

        tag = await self.tags.get(tag_id)
        if tag is None:
            raise NotFoundError("Tag", tag_id)
        self._assert_owner(tag, user)

        # Idempotent, not an error: attaching a tag that's already there
        # ends in the same state either way, and the note_tags composite PK
        # would otherwise turn a double-click into a 500.
        if await self.tags.get_note_tag(note_id, tag_id) is not None:
            return
        await self.tags.attach(note_id, tag_id, user.id)

    async def detach_from_note(self, note_id: UUID, tag_id: int, user: User) -> None:
        note = await self.notes.get(note_id)
        if note is None:
            raise NotFoundError("Note", note_id)
        if note.creator_id != user.id:
            raise PermissionDeniedError("untag this note")

        note_tag = await self.tags.get_note_tag(note_id, tag_id)
        if note_tag is None:
            raise NotFoundError("Tag on note", tag_id)
        await self.tags.detach(note_tag)
