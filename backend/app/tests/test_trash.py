"""Trash: archive -> list archived -> restore, or purge for real.

purge is the only code path in the app that issues a real DELETE on notes,
so these tests check what it takes with it, not just that the row is gone.
"""

import pytest
from sqlalchemy import text

from app.core.exceptions import PermissionDeniedError, ValidationError
from app.repositories.tag import TagRepository
from app.schemas.link import KnowledgeLinkCreate
from app.schemas.note import NoteCreate, NoteUpdate
from app.services.link import LinkService
from app.services.note import NoteService

RELATES_TO = 1


async def _count(db, sql: str, note_id) -> int:
    return (await db.execute(text(sql), {"id": note_id})).scalar_one()


async def test_archived_notes_only_appear_in_the_archived_listing(db, user):
    notes = NoteService(db)
    note = await notes.create(NoteCreate(title="Old"), user)
    await notes.delete(note.id, user)

    assert note.id not in [n.id for n in await notes.list(user)]
    assert note.id in [n.id for n in await notes.list(user, archived=True)]


async def test_restore_brings_a_note_back(db, user):
    notes = NoteService(db)
    note = await notes.create(NoteCreate(title="Back"), user)
    await notes.delete(note.id, user)

    await notes.update(note.id, NoteUpdate(archived=False), user)

    assert note.id in [n.id for n in await notes.list(user)]


async def test_purge_refuses_a_live_note(db, user):
    """Two-step on purpose: a note has to be in Trash first."""
    notes = NoteService(db)
    note = await notes.create(NoteCreate(title="Live"), user)

    with pytest.raises(ValidationError):
        await notes.purge(note.id, user)

    assert (await notes.get(note.id, user)).archived is False


async def test_purge_removes_the_note_and_everything_cascading_from_it(db, user):
    notes = NoteService(db)
    links = LinkService(db)

    doomed = await notes.create(NoteCreate(title="Doomed", content="v1"), user)
    other = await notes.create(NoteCreate(title="Other"), user)
    await notes.update(doomed.id, NoteUpdate(content="v2"), user)  # -> one version row
    await links.create(doomed.id, KnowledgeLinkCreate(target_note_id=other.id, rel_type_id=RELATES_TO), user)
    await links.create(other.id, KnowledgeLinkCreate(target_note_id=doomed.id, rel_type_id=RELATES_TO), user)
    tag = await TagRepository(db).create(user_id=user.id, name="Temp", slug="temp", color="#4CAF50")
    await TagRepository(db).attach(doomed.id, tag.id, user.id)

    await notes.delete(doomed.id, user)
    await notes.purge(doomed.id, user)

    assert await _count(db, "SELECT count(*) FROM notes WHERE id = :id", doomed.id) == 0
    assert await _count(db, "SELECT count(*) FROM note_versions WHERE note_id = :id", doomed.id) == 0
    assert await _count(
        db,
        "SELECT count(*) FROM knowledge_links WHERE source_note_id = :id OR target_note_id = :id",
        doomed.id,
    ) == 0
    assert await _count(db, "SELECT count(*) FROM note_tags WHERE note_id = :id", doomed.id) == 0
    # The note on the other end of the links survives - only the edges go.
    assert (await notes.get(other.id, user)).title == "Other"


async def test_cannot_purge_someone_elses_note(db, user, make_user):
    notes = NoteService(db)
    note = await notes.create(NoteCreate(title="Mine", is_public=True), user)
    await notes.delete(note.id, user)
    stranger = await make_user(display_name="Stranger")

    with pytest.raises(PermissionDeniedError):
        await notes.purge(note.id, stranger)


async def test_empty_trash_deletes_only_the_callers_archived_notes(db, user, make_user):
    notes = NoteService(db)
    live = await notes.create(NoteCreate(title="Live", content="x"), user)
    trashed = [await notes.create(NoteCreate(title=f"T{i}", content="x"), user) for i in range(3)]
    for n in trashed:
        await notes.delete(n.id, user)
    stranger = await make_user(display_name="Stranger")
    theirs = await notes.create(NoteCreate(title="Theirs", content="x"), stranger)
    await notes.delete(theirs.id, stranger)

    assert await notes.empty_trash(user) == 3

    assert await notes.list(user, archived=True) == []
    assert [n.id for n in await notes.list(user)] == [live.id]
    # Someone else's Trash is untouched.
    assert [n.id for n in await notes.list(stranger, archived=True)] == [theirs.id]
