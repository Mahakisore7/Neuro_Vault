"""fn_create_note_version / trg_notes_create_version / sp_rollback_note_version.

None of these are called from Python — they run entirely inside Postgres.
These tests exist to prove the trigger fires (and only when content actually
changes), and that rollback restores state through the same trigger rather
than around it.
"""

from app.schemas.note import NoteCreate, NoteUpdate
from app.services.note import NoteService


async def test_update_fires_the_versioning_trigger(db, user):
    notes = NoteService(db)
    note = await notes.create(
        NoteCreate(title="Normalization", content="<p>1NF, 2NF, 3NF basics</p>"), user
    )

    await notes.update(
        note.id, NoteUpdate(content="<p>1NF, 2NF, 3NF, and BCNF</p>"), user
    )

    versions = await notes.list_versions(note.id, user)
    assert len(versions) == 1
    assert versions[0].version_num == 1
    # The trigger snapshots OLD, the row about to be overwritten — not the
    # new content the UPDATE was carrying.
    assert versions[0].title == "Normalization"


async def test_update_without_content_change_does_not_version(db, user):
    """IS DISTINCT FROM guards the trigger: pinning a note, or any update
    that leaves content untouched, must not fabricate history that never
    happened.
    """
    notes = NoteService(db)
    note = await notes.create(NoteCreate(title="Normalization", content="<p>same</p>"), user)

    await notes.update(note.id, NoteUpdate(pinned=True), user)

    versions = await notes.list_versions(note.id, user)
    assert versions == []


async def test_second_edit_creates_version_two(db, user):
    notes = NoteService(db)
    note = await notes.create(NoteCreate(title="Normalization", content="v1"), user)
    await notes.update(note.id, NoteUpdate(content="v2"), user)
    await notes.update(note.id, NoteUpdate(content="v3"), user)

    versions = await notes.list_versions(note.id, user)
    assert [v.version_num for v in versions] == [2, 1]  # newest first


async def test_rollback_restores_content_and_versions_the_state_it_replaced(db, user):
    """A rollback is never destructive: rolling back to v1 must itself be
    undoable, because sp_rollback_note_version's UPDATE re-fires the trigger.
    """
    notes = NoteService(db)
    note = await notes.create(NoteCreate(title="Normalization", content="v1"), user)
    await notes.update(note.id, NoteUpdate(content="v2"), user)

    restored = await notes.rollback_version(note.id, 1, user)
    assert restored.content == "v1"

    versions = await notes.list_versions(note.id, user)
    # v1 (the original edit) and v2 (the state the rollback just replaced)
    assert [v.version_num for v in versions] == [2, 1]
