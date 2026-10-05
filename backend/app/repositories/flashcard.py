from collections.abc import Sequence
from uuid import UUID

from sqlalchemy import Row, func, select

from app.models.note import Note
from app.models.study import Flashcard
from app.repositories.base import BaseRepository


class FlashcardRepository(BaseRepository[Flashcard]):
    model = Flashcard

    def _with_title(self):
        return select(Flashcard, Note.title.label("note_title")).join(
            Note, Note.id == Flashcard.note_id
        )

    async def get_with_title(self, card_id: UUID) -> Row | None:
        stmt = self._with_title().where(Flashcard.id == card_id)
        return (await self.db.execute(stmt)).one_or_none()

    async def list_for_note(self, note_id: UUID, owner_id: UUID) -> Sequence[Row]:
        stmt = (
            self._with_title()
            .where(Flashcard.note_id == note_id, Flashcard.owner_id == owner_id)
            .order_by(Flashcard.created_at)
        )
        return (await self.db.execute(stmt)).all()

    async def list_due(self, owner_id: UUID, limit: int) -> Sequence[Row]:
        # owner_id = ? AND due_at <= now() ORDER BY due_at is exactly the
        # shape of idx_flashcards_owner_id_due_at. Cards whose note is in the
        # Trash are skipped, not deleted: restoring the note brings them back.
        stmt = (
            self._with_title()
            .where(
                Flashcard.owner_id == owner_id,
                Flashcard.due_at <= func.now(),
                Note.archived.is_(False),
            )
            .order_by(Flashcard.due_at)
            .limit(limit)
        )
        return (await self.db.execute(stmt)).all()

    async def summary(self, owner_id: UUID) -> Row:
        # One pass over the user's cards: FILTER gives a conditional count
        # without a second query or a CASE inside SUM.
        stmt = (
            select(
                func.count().label("total"),
                func.count().filter(Flashcard.due_at <= func.now()).label("due"),
                func.min(Flashcard.due_at).filter(Flashcard.due_at > func.now()).label(
                    "next_due_at"
                ),
            )
            .select_from(Flashcard)
            .join(Note, Note.id == Flashcard.note_id)
            .where(Flashcard.owner_id == owner_id, Note.archived.is_(False))
        )
        return (await self.db.execute(stmt)).one()
