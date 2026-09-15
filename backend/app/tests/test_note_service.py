"""Delete-means-archive, unfiled listing, and the read/write permission split.

These are product decisions (see docs/adr/) that only hold if the service
layer actually behaves this way — nothing here is enforced by a constraint,
so it's exactly the kind of thing that regresses silently without a test.
"""

import pytest

from app.core.exceptions import NotFoundError, PermissionDeniedError
from app.schemas.note import NoteCreate
from app.services.note import NoteService


async def test_delete_archives_instead_of_removing_the_row(db, user):
    notes = NoteService(db)
    note = await notes.create(NoteCreate(title="Keep me", content="body"), user)

    await notes.delete(note.id, user)

    # The row is still there — still readable by its own creator.
    fetched = await notes.get(note.id, user)
    assert fetched.archived is True


async def test_unfiled_note_has_no_notebook(db, user):
    notes = NoteService(db)
    note = await notes.create(NoteCreate(title="No notebook", content="body"), user)
    assert note.notebook_id is None

    listing = await notes.list(user, unfiled=True)
    assert [n.id for n in listing] == [note.id]


async def test_filed_note_is_excluded_from_unfiled_listing(db, user, notebook):
    notes = NoteService(db)
    await notes.create(NoteCreate(title="Filed", content="body", notebook_id=notebook.id), user)

    listing = await notes.list(user, unfiled=True)
    assert listing == []


async def test_private_note_is_not_readable_by_another_user(db, user, make_user):
    notes = NoteService(db)
    note = await notes.create(NoteCreate(title="Private", content="body", is_public=False), user)
    stranger = await make_user(display_name="Stranger")

    # 404, not 403: a private note's existence isn't confirmed to non-owners.
    with pytest.raises(NotFoundError):
        await notes.get(note.id, stranger)


async def test_public_note_is_readable_but_not_writable_by_another_user(db, user, make_user):
    notes = NoteService(db)
    note = await notes.create(NoteCreate(title="Public", content="body", is_public=True), user)
    stranger = await make_user(display_name="Stranger")

    fetched = await notes.get(note.id, stranger)
    assert fetched.id == note.id

    with pytest.raises(PermissionDeniedError):
        await notes.delete(note.id, stranger)
