"""notes.word_count — GENERATED ALWAYS ... STORED, computed by Postgres.

Never assigned in Python; there is no code path that can write a stale value
into it because there's no code path that can write to it at all.
"""

from app.schemas.note import NoteCreate, NoteUpdate
from app.services.note import NoteService


async def test_word_count_is_computed_on_insert(db, user):
    note = await NoteService(db).create(
        NoteCreate(title="Normalization", content="<p>1NF, 2NF, 3NF basics</p>"), user
    )
    assert note.word_count == 4  # tags stripped: "1NF, 2NF, 3NF basics"


async def test_word_count_recomputes_on_update(db, user):
    notes = NoteService(db)
    note = await notes.create(NoteCreate(title="Note", content="one two three"), user)
    assert note.word_count == 3

    updated = await notes.update(note.id, NoteUpdate(content="one two three four five"), user)
    assert updated.word_count == 5


async def test_word_count_zero_for_empty_content(db, user):
    note = await NoteService(db).create(NoteCreate(title="Blank", content=None), user)
    assert note.word_count == 0
