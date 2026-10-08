"""Delete-means-archive, unfiled listing, and the read/write permission split.

These are product decisions (see docs/adr/) that only hold if the service
layer actually behaves this way — nothing here is enforced by a constraint,
so it's exactly the kind of thing that regresses silently without a test.
"""

import pytest

from app.core.exceptions import NotFoundError, PermissionDeniedError
from app.schemas.note import NoteCreate
from app.schemas.tag import TagCreate
from app.services.note import NoteService
from app.services.tag import TagService


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


async def test_tag_filter_lists_only_notes_with_that_tag(db, user):
    notes = NoteService(db)
    tags = TagService(db)
    tagged = await notes.create(NoteCreate(title="Tagged", content="body"), user)
    await notes.create(NoteCreate(title="Untagged", content="body"), user)
    tag = await tags.create(TagCreate(name="Exam", slug="exam"), user)
    other = await tags.create(TagCreate(name="Other", slug="other"), user)
    await tags.attach_to_note(tagged.id, tag.id, user)
    await tags.attach_to_note(tagged.id, other.id, user)

    listing = await notes.list(user, tag_id=tag.id)
    # One row, not two: the filter is a semi-join, so a note carrying
    # several tags still appears once.
    assert [n.id for n in listing] == [tagged.id]


async def test_tag_filter_with_someone_elses_tag_finds_nothing(db, user, make_user):
    notes = NoteService(db)
    stranger = await make_user(display_name="Stranger")
    their_note = await notes.create(NoteCreate(title="Theirs", content="body"), stranger)
    their_tag = await TagService(db).create(TagCreate(name="Secret", slug="secret"), stranger)
    await TagService(db).attach_to_note(their_note.id, their_tag.id, stranger)

    assert await notes.list(user, tag_id=their_tag.id) == []


async def test_pages_neither_repeat_nor_skip_notes(db, user):
    # Notes created in one transaction share now() as updated_at, so the
    # page order rests on the id tie-breaker in ORDER BY. A small table
    # usually sorts ties consistently even without it, so this guards the
    # paging contract rather than proving the tie-breaker is needed.
    notes = NoteService(db)
    created = {
        (await notes.create(NoteCreate(title=f"N{i}", content="b"), user)).id for i in range(7)
    }

    seen = []
    for offset in range(0, 7, 3):
        seen += [n.id for n in await notes.list(user, limit=3, offset=offset)]
    assert len(seen) == 7
    assert set(seen) == created


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
