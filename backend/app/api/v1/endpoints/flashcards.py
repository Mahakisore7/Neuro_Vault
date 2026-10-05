from uuid import UUID

from fastapi import APIRouter, Query, status

from app.core.dependencies import CurrentUser, DbSession
from app.schemas.flashcard import (
    FlashcardCreate,
    FlashcardResponse,
    FlashcardReview,
    FlashcardSummary,
    FlashcardUpdate,
)
from app.services.flashcard import FlashcardService

router = APIRouter(prefix="/flashcards", tags=["flashcards"])


@router.get("", response_model=list[FlashcardResponse])
async def list_flashcards(
    user: CurrentUser, db: DbSession, note_id: UUID
) -> list[FlashcardResponse]:
    return await FlashcardService(db).list_for_note(note_id, user)


# /due and /summary are declared before /{card_id}: routes match in order,
# and "due" would otherwise be parsed (and rejected) as a card UUID.
@router.get("/due", response_model=list[FlashcardResponse])
async def list_due_flashcards(
    user: CurrentUser, db: DbSession, limit: int = Query(default=50, ge=1, le=200)
) -> list[FlashcardResponse]:
    return await FlashcardService(db).list_due(user, limit)


@router.get("/summary", response_model=FlashcardSummary)
async def flashcard_summary(user: CurrentUser, db: DbSession) -> FlashcardSummary:
    return await FlashcardService(db).summary(user)


@router.post("", response_model=FlashcardResponse, status_code=status.HTTP_201_CREATED)
async def create_flashcard(
    payload: FlashcardCreate, user: CurrentUser, db: DbSession
) -> FlashcardResponse:
    return await FlashcardService(db).create(payload, user)


@router.patch("/{card_id}", response_model=FlashcardResponse)
async def update_flashcard(
    card_id: UUID, payload: FlashcardUpdate, user: CurrentUser, db: DbSession
) -> FlashcardResponse:
    return await FlashcardService(db).update(card_id, payload, user)


@router.delete("/{card_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_flashcard(card_id: UUID, user: CurrentUser, db: DbSession) -> None:
    await FlashcardService(db).delete(card_id, user)


@router.post("/{card_id}/review", response_model=FlashcardResponse)
async def review_flashcard(
    card_id: UUID, payload: FlashcardReview, user: CurrentUser, db: DbSession
) -> FlashcardResponse:
    return await FlashcardService(db).review(card_id, payload.quality, user)
