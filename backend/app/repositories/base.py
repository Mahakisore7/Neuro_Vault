from collections.abc import Sequence
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.base import Base


class BaseRepository[ModelT: Base]:
    """CRUD written once here, reused by every concrete repository below.

    `[ModelT: Base]` is a PEP 695 generic (Python 3.12): it declares a type
    parameter bound to Base, so pyright knows NoteRepository.get() returns
    Note | None specifically — not the bare Base | None a non-generic base
    class would give you.
    """

    model: type[ModelT]

    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def get(self, id_: Any) -> ModelT | None:
        return await self.db.get(self.model, id_)

    async def list(self, *, limit: int = 50, offset: int = 0, **filters: Any) -> Sequence[ModelT]:
        stmt = select(self.model).limit(limit).offset(offset)
        for field, value in filters.items():
            stmt = stmt.where(getattr(self.model, field) == value)
        result = await self.db.execute(stmt)
        return result.scalars().all()

    async def create(self, **values: Any) -> ModelT:
        obj = self.model(**values)
        self.db.add(obj)
        # flush(), not commit(): the repository doesn't decide when the
        # transaction ends — get_db() does, once, at the end of the request
        # (see db/session.py). flush() sends the INSERT so the database can
        # assign the primary key and any server-side defaults, while
        # leaving the transaction open so a later failure in the same
        # request still rolls this insert back too.
        await self.db.flush()
        await self.db.refresh(obj)  # loads server-generated values (e.g. word_count on Note)
        return obj

    async def delete(self, obj: ModelT) -> None:
        await self.db.delete(obj)
        await self.db.flush()
