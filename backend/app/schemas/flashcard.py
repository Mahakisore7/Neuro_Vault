from datetime import datetime
from typing import Annotated
from uuid import UUID

from pydantic import BaseModel, Field, StringConstraints

# Stripped before the length check, so "   " is rejected with a 422 here
# rather than reaching ck_flashcards_*_not_blank as a 500.
CardText = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=5000)]


class FlashcardCreate(BaseModel):
    note_id: UUID
    question: CardText
    answer: CardText


class FlashcardUpdate(BaseModel):
    """Editing the wording leaves the schedule alone - rewording a card you
    already know shouldn't send it back to day one.
    """

    question: CardText | None = None
    answer: CardText | None = None


class FlashcardReview(BaseModel):
    quality: int = Field(ge=0, le=5)


class FlashcardResponse(BaseModel):
    id: UUID
    note_id: UUID
    note_title: str
    question: str
    answer: str
    # float on the wire (JSON has no decimal type); the column and the
    # scheduler stay exact NUMERIC / Decimal.
    ease_factor: float
    interval_days: int
    repetitions: int
    due_at: datetime
    last_result: int | None
    created_at: datetime
    updated_at: datetime


class FlashcardSummary(BaseModel):
    total: int
    due: int
    next_due_at: datetime | None
