from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import ConflictError, NotFoundError, ValidationError
from app.models.collection import Collection
from app.models.user import User
from app.repositories.collection import CollectionRepository
from app.repositories.note import NoteRepository
from app.schemas.collection import (
    CollectionCreate,
    CollectionDetail,
    CollectionItemResponse,
    CollectionResponse,
    CollectionUpdate,
)


class CollectionService:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db
        self.collections = CollectionRepository(db)
        self.notes = NoteRepository(db)

    async def _get_owned(self, collection_id: UUID, user: User) -> Collection:
        # 404 for "not yours" as well as "doesn't exist": collections are
        # private, and a 403 would confirm the id is real (same reasoning as
        # NoteService._assert_can_read for private notes).
        collection = await self.collections.get(collection_id)
        if collection is None or collection.user_id != user.id:
            raise NotFoundError("Collection", collection_id)
        return collection

    async def _assert_name_free(self, user: User, name: str) -> None:
        # Closes the duplicate-name gap documented in WorkspaceService.create
        # ("a ConflictError, table by table") for this table: a clean 409
        # instead of a 500 from UNIQUE(user_id, name). The constraint still
        # backs it up if two requests race past this check.
        if await self.collections.get_by_name(user.id, name) is not None:
            raise ConflictError(f'You already have a collection named "{name}"')

    async def _detail(self, collection: Collection) -> CollectionDetail:
        rows = await self.collections.list_items(collection.id)
        items = [CollectionItemResponse.model_validate(r, from_attributes=True) for r in rows]
        return CollectionDetail(
            id=collection.id,
            name=collection.name,
            description=collection.description,
            item_count=len(items),
            created_at=collection.created_at,
            updated_at=collection.updated_at,
            items=items,
        )

    async def get(self, collection_id: UUID, user: User) -> CollectionDetail:
        return await self._detail(await self._get_owned(collection_id, user))

    # Above list() - a method named `list` shadows the builtin for every
    # annotation after it in the class body (see NoteService).
    async def reorder(
        self, collection_id: UUID, note_ids: list[UUID], user: User
    ) -> CollectionDetail:
        collection = await self._get_owned(collection_id, user)
        current = {row.note_id for row in await self.collections.list_items(collection_id)}
        # Must be exactly the current members, each once - a reorder is not
        # a way to add, drop, or duplicate items.
        if len(note_ids) != len(set(note_ids)) or set(note_ids) != current:
            raise ValidationError("note_ids must list every note in the collection exactly once")
        await self.collections.reorder(collection_id, note_ids)
        return await self._detail(collection)

    async def list(self, user: User) -> list[CollectionResponse]:
        rows = await self.collections.list_with_counts(user.id)
        return [
            CollectionResponse(
                id=r.Collection.id,
                name=r.Collection.name,
                description=r.Collection.description,
                item_count=r.item_count,
                created_at=r.Collection.created_at,
                updated_at=r.Collection.updated_at,
            )
            for r in rows
        ]

    async def create(self, payload: CollectionCreate, user: User) -> CollectionDetail:
        await self._assert_name_free(user, payload.name)
        collection = await self.collections.create(
            user_id=user.id, name=payload.name, description=payload.description
        )
        return await self._detail(collection)

    async def update(
        self, collection_id: UUID, payload: CollectionUpdate, user: User
    ) -> CollectionDetail:
        collection = await self._get_owned(collection_id, user)
        changes = payload.model_dump(exclude_unset=True)
        if "name" in changes and changes["name"] != collection.name:
            await self._assert_name_free(user, changes["name"])
        for field, value in changes.items():
            setattr(collection, field, value)
        await self.db.flush()
        await self.db.refresh(collection)
        return await self._detail(collection)

    async def delete(self, collection_id: UUID, user: User) -> None:
        # A real DELETE: collection_items cascade away, the notes themselves
        # are untouched (the FK runs items -> notes, not the other way).
        collection = await self._get_owned(collection_id, user)
        await self.collections.delete(collection)

    async def add_item(self, collection_id: UUID, note_id: UUID, user: User) -> CollectionDetail:
        collection = await self._get_owned(collection_id, user)
        # The composite FK (note_id, owner_id) -> notes(id, creator_id)
        # already makes "someone else's note in my collection" a row the
        # database refuses; checking first turns that into a clean 404.
        note = await self.notes.get(note_id)
        if note is None or note.creator_id != user.id:
            raise NotFoundError("Note", note_id)
        # Idempotent, like attaching a tag: a double-click ends in the same
        # state instead of a primary-key violation.
        if await self.collections.get_item(collection_id, note_id) is None:
            await self.collections.add_item(collection_id, note_id, user.id)
        return await self._detail(collection)

    async def remove_item(self, collection_id: UUID, note_id: UUID, user: User) -> CollectionDetail:
        collection = await self._get_owned(collection_id, user)
        item = await self.collections.get_item(collection_id, note_id)
        if item is None:
            raise NotFoundError("Note in collection", note_id)
        await self.collections.remove_item(item)
        return await self._detail(collection)
