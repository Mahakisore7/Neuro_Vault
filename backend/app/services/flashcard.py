from datetime import UTC, datetime, timedelta
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import NotFoundError
from app.models.study import Flashcard
from app.models.user import User
from app.repositories.flashcard import FlashcardRepository
from app.repositories.note import NoteRepository
from app.schemas.flashcard import (
    FlashcardCreate,
    FlashcardResponse,
    FlashcardSummary,
    FlashcardUpdate,
)
from app.services.sm2 import Schedule, next_schedule


def _response(card: Flashcard, note_title: str) -> FlashcardResponse:
    return FlashcardResponse(
        id=card.id,
        note_id=card.note_id,
        note_title=note_title,
        question=card.question,
        answer=card.answer,
        ease_factor=float(card.ease_factor),
        interval_days=card.interval_days,
        repetitions=card.repetitions,
        due_at=card.due_at,
        last_result=card.last_result,
        created_at=card.created_at,
        updated_at=card.updated_at,
    )


class FlashcardService:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db
        self.cards = FlashcardRepository(db)
        self.notes = NoteRepository(db)

    async def _get_owned(self, card_id: UUID, user: User) -> tuple[Flashcard, str]:
        # Flashcards are private study state, even on a public note: 404 for
        # "not yours" so a card id can't be probed (same as collections).
        row = await self.cards.get_with_title(card_id)
        if row is None or row.Flashcard.owner_id != user.id:
            raise NotFoundError("Flashcard", card_id)
        return row.Flashcard, row.note_title

    async def _assert_owns_note(self, note_id: UUID, user: User) -> str:
        # Mirrors the composite FK (note_id, owner_id) -> notes(id, creator_id):
        # the database would refuse a card on someone else's note anyway, this
        # turns that into a 404 instead of an IntegrityError.
        note = await self.notes.get(note_id)
        if note is None or note.creator_id != user.id:
            raise NotFoundError("Note", note_id)
        return note.title

    async def list_for_note(self, note_id: UUID, user: User) -> list[FlashcardResponse]:
        await self._assert_owns_note(note_id, user)
        rows = await self.cards.list_for_note(note_id, user.id)
        return [_response(r.Flashcard, r.note_title) for r in rows]

    async def list_due(self, user: User, limit: int = 50) -> list[FlashcardResponse]:
        rows = await self.cards.list_due(user.id, limit)
        return [_response(r.Flashcard, r.note_title) for r in rows]

    async def summary(self, user: User) -> FlashcardSummary:
        row = await self.cards.summary(user.id)
        return FlashcardSummary(total=row.total, due=row.due, next_due_at=row.next_due_at)

    async def create(self, payload: FlashcardCreate, user: User) -> FlashcardResponse:
        note_title = await self._assert_owns_note(payload.note_id, user)
        # Schedule columns are left to their defaults (ease 2.50, interval 1,
        # 0 repetitions, due now) - a new card is due immediately.
        card = await self.cards.create(
            note_id=payload.note_id,
            owner_id=user.id,
            question=payload.question,
            answer=payload.answer,
        )
        return _response(card, note_title)

    async def update(
        self, card_id: UUID, payload: FlashcardUpdate, user: User
    ) -> FlashcardResponse:
        card, note_title = await self._get_owned(card_id, user)
        for field, value in payload.model_dump(exclude_unset=True, exclude_none=True).items():
            setattr(card, field, value)
        await self.db.flush()
        await self.db.refresh(card)
        return _response(card, note_title)

    async def delete(self, card_id: UUID, user: User) -> None:
        card, _ = await self._get_owned(card_id, user)
        await self.cards.delete(card)

    async def review(self, card_id: UUID, quality: int, user: User) -> FlashcardResponse:
        card, note_title = await self._get_owned(card_id, user)
        nxt = next_schedule(
            Schedule(
                ease_factor=card.ease_factor,
                interval_days=card.interval_days,
                repetitions=card.repetitions,
            ),
            quality,
        )
        card.ease_factor = nxt.ease_factor
        card.interval_days = nxt.interval_days
        card.repetitions = nxt.repetitions
        card.last_result = quality
        card.due_at = datetime.now(UTC) + timedelta(days=nxt.interval_days)
        # If the scheduler ever produced an out-of-range value, this flush is
        # where the CHECK constraints would reject it and roll the review back.
        await self.db.flush()
        await self.db.refresh(card)
        return _response(card, note_title)
