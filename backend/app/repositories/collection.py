from collections.abc import Sequence
from uuid import UUID

from sqlalchemy import Row, func, select, text

from app.models.collection import Collection, CollectionItem
from app.models.note import Note
from app.repositories.base import BaseRepository

# One statement for the whole reorder, not one UPDATE per note: unnest()
# turns the id array into rows, WITH ORDINALITY numbers them 1..n in array
# order, and the UPDATE joins on that. Either every position changes or,
# on any failure, none does.
_REORDER_SQL = text("""
    UPDATE collection_items ci
    SET position = o.ord - 1
    FROM unnest(CAST(:note_ids AS uuid[])) WITH ORDINALITY AS o(note_id, ord)
    WHERE ci.collection_id = :collection_id
      AND ci.note_id = o.note_id
""")


class CollectionRepository(BaseRepository[Collection]):
    model = Collection

    async def list_with_counts(self, user_id: UUID) -> Sequence[Row]:
        # LEFT JOIN, not JOIN: an empty collection must still be listed, with 0.
        stmt = (
            select(Collection, func.count(CollectionItem.note_id).label("item_count"))
            .outerjoin(CollectionItem, CollectionItem.collection_id == Collection.id)
            .where(Collection.user_id == user_id)
            .group_by(Collection.id)
            .order_by(Collection.name)
        )
        return (await self.db.execute(stmt)).all()

    async def get_by_name(self, user_id: UUID, name: str) -> Collection | None:
        stmt = select(Collection).where(Collection.user_id == user_id, Collection.name == name)
        return (await self.db.execute(stmt)).scalar_one_or_none()

    async def list_items(self, collection_id: UUID) -> Sequence[Row]:
        stmt = (
            select(
                CollectionItem.note_id,
                Note.title,
                Note.word_count,
                Note.archived,
                CollectionItem.position,
                CollectionItem.added_at,
            )
            .join(Note, Note.id == CollectionItem.note_id)
            .where(CollectionItem.collection_id == collection_id)
            # added_at breaks ties: two concurrent appends can read the same
            # MAX(position) and land on the same number (position isn't
            # unique), and this keeps their order stable regardless.
            .order_by(CollectionItem.position, CollectionItem.added_at)
        )
        return (await self.db.execute(stmt)).all()

    async def get_item(self, collection_id: UUID, note_id: UUID) -> CollectionItem | None:
        return await self.db.get(CollectionItem, (collection_id, note_id))

    async def add_item(self, collection_id: UUID, note_id: UUID, owner_id: UUID) -> None:
        next_position = (
            await self.db.execute(
                select(func.coalesce(func.max(CollectionItem.position), -1) + 1).where(
                    CollectionItem.collection_id == collection_id
                )
            )
        ).scalar_one()
        self.db.add(
            CollectionItem(
                collection_id=collection_id,
                note_id=note_id,
                owner_id=owner_id,
                position=next_position,
            )
        )
        await self.db.flush()

    async def remove_item(self, item: CollectionItem) -> None:
        await self.db.delete(item)
        await self.db.flush()

    async def reorder(self, collection_id: UUID, note_ids: list[UUID]) -> None:
        # No expire_all() afterwards, deliberately: list_items() reads plain
        # columns straight from the database, so nothing cached can be stale,
        # and expiring ORM objects in an AsyncSession makes the next attribute
        # access attempt lazy-load I/O outside an await (MissingGreenlet).
        await self.db.execute(
            _REORDER_SQL, {"collection_id": collection_id, "note_ids": note_ids}
        )
