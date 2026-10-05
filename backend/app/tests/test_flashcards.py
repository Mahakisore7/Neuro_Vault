"""Flashcards: private SM-2 study cards attached to a note through the same
(note_id, owner_id) composite FK as everything else that hangs off notes.
"""

from datetime import UTC, datetime, timedelta
from decimal import Decimal

import pytest
from pydantic import ValidationError as SchemaValidationError
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from app.core.exceptions import NotFoundError
from app.models.study import Flashcard
from app.repositories.flashcard import FlashcardRepository
from app.schemas.flashcard import FlashcardCreate, FlashcardUpdate
from app.schemas.note import NoteCreate, NoteUpdate
from app.services.flashcard import FlashcardService
from app.services.note import NoteService


async def _card(db, user, *, question="What is 3NF?", answer="No transitive dependencies"):
    note = await NoteService(db).create(NoteCreate(title="Normalisation"), user)
    card = await FlashcardService(db).create(
        FlashcardCreate(note_id=note.id, question=question, answer=answer), user
    )
    return note, card


async def test_new_card_starts_on_sm2_defaults_and_is_due_immediately(db, user):
    _, card = await _card(db, user)

    assert (card.ease_factor, card.interval_days, card.repetitions) == (2.5, 1, 0)
    assert card.last_result is None
    assert card.id in [c.id for c in await FlashcardService(db).list_due(user)]


async def test_review_reschedules_and_leaves_the_due_queue(db, user):
    cards = FlashcardService(db)
    _, card = await _card(db, user)

    reviewed = await cards.review(card.id, 3, user)

    assert reviewed.repetitions == 1
    assert reviewed.last_result == 3
    assert reviewed.due_at > datetime.now(UTC) + timedelta(hours=23)
    assert card.id not in [c.id for c in await cards.list_due(user)]
    summary = await cards.summary(user)
    assert (summary.total, summary.due) == (1, 0)
    assert summary.next_due_at == reviewed.due_at


async def test_ease_factor_round_trips_through_numeric_exactly(db, user):
    _, card = await _card(db, user)
    await FlashcardService(db).review(card.id, 3, user)  # 2.50 - 0.14

    stored = (
        await db.execute(text("SELECT ease_factor FROM flashcards WHERE id = :id"), {"id": card.id})
    ).scalar_one()

    assert stored == Decimal("2.36")  # not 2.3599999999


async def test_due_queue_is_ordered_most_overdue_first(db, user):
    cards = FlashcardService(db)
    note = await NoteService(db).create(NoteCreate(title="Ordering"), user)
    now = datetime.now(UTC)
    ids = []
    for days_overdue in (1, 5, 3):
        card = await cards.create(
            FlashcardCreate(note_id=note.id, question=f"Q{days_overdue}", answer="A"), user
        )
        await db.execute(
            text("UPDATE flashcards SET due_at = :d WHERE id = :id"),
            {"d": now - timedelta(days=days_overdue), "id": card.id},
        )
        ids.append(card.id)

    due = [c.question for c in await cards.list_due(user)]

    assert due == ["Q5", "Q3", "Q1"]


async def test_cannot_make_cards_on_someone_elses_note(db, user, make_user):
    stranger = await make_user(display_name="Stranger")
    their_note = await NoteService(db).create(NoteCreate(title="Theirs", is_public=True), stranger)

    # Service: a clean 404, even though the note is public and readable.
    with pytest.raises(NotFoundError):
        await FlashcardService(db).create(
            FlashcardCreate(note_id=their_note.id, question="Q", answer="A"), user
        )

    # Database: the composite FK refuses it on its own, service bypassed.
    with pytest.raises(IntegrityError, match="note_id_owner_id"):
        await FlashcardRepository(db).create(
            note_id=their_note.id, owner_id=user.id, question="Q", answer="A"
        )


async def test_cards_are_private_to_their_owner(db, user, make_user):
    stranger = await make_user(display_name="Stranger")
    _, card = await _card(db, user)

    with pytest.raises(NotFoundError):
        await FlashcardService(db).review(card.id, 5, stranger)
    with pytest.raises(NotFoundError):
        await FlashcardService(db).delete(card.id, stranger)


async def test_cards_of_a_trashed_note_pause_and_come_back_on_restore(db, user):
    notes, cards = NoteService(db), FlashcardService(db)
    note, card = await _card(db, user)

    await notes.delete(note.id, user)  # archive
    assert card.id not in [c.id for c in await cards.list_due(user)]
    assert (await cards.summary(user)).total == 0

    await notes.update(note.id, NoteUpdate(archived=False), user)
    assert card.id in [c.id for c in await cards.list_due(user)]


async def test_purging_the_note_cascades_its_cards(db, user):
    notes = NoteService(db)
    note, card = await _card(db, user)

    await notes.delete(note.id, user)
    await notes.purge(note.id, user)

    remaining = (
        await db.execute(text("SELECT count(*) FROM flashcards WHERE id = :id"), {"id": card.id})
    ).scalar_one()
    assert remaining == 0


async def test_editing_wording_keeps_the_schedule(db, user):
    cards = FlashcardService(db)
    _, card = await _card(db, user)
    reviewed = await cards.review(card.id, 4, user)

    edited = await cards.update(card.id, FlashcardUpdate(answer="No non-key -> non-key FDs"), user)

    assert edited.answer == "No non-key -> non-key FDs"
    assert (edited.repetitions, edited.due_at) == (reviewed.repetitions, reviewed.due_at)


def test_blank_text_is_rejected_before_it_reaches_the_check(user):
    with pytest.raises(SchemaValidationError):
        FlashcardCreate(note_id=user.id, question="   ", answer="A")


async def test_check_constraint_rejects_an_out_of_range_ease_factor(db, user):
    """The last line of defence if the scheduler ever had a bug: SM-2's
    bounds are enforced by the table, not just by app code."""
    _, card = await _card(db, user)

    with pytest.raises(IntegrityError, match="ck_flashcards_ease_factor_range"):
        await db.execute(
            text("UPDATE flashcards SET ease_factor = 2.60 WHERE id = :id"), {"id": card.id}
        )


async def test_due_query_uses_the_owner_due_index(db, user):
    await _card(db, user)
    # On a near-empty table the planner rightly prefers a seq scan; turning it
    # off asks "can this query use the index at all?" - which fails if the
    # migration is missing or the column order is wrong for the query.
    await db.execute(text("SET LOCAL enable_seqscan = off"))
    plan = (
        await db.execute(
            text(
                "EXPLAIN SELECT id FROM flashcards "
                "WHERE owner_id = :owner AND due_at <= now() ORDER BY due_at"
            ),
            {"owner": user.id},
        )
    ).scalars().all()

    assert any("idx_flashcards_owner_id_due_at" in line for line in plan), "\n".join(plan)
    assert not any("Sort" in line for line in plan), "\n".join(plan)


async def test_model_default_matches_the_numeric_column(db, user):
    _, card = await _card(db, user)
    row = await db.get(Flashcard, card.id)

    assert row is not None
    assert row.ease_factor == Decimal("2.50")
