"""Collections: an ORDERED, curated set of notes (collection_items.position),
private to their owner, holding only notes that owner created (composite FK).
"""

from uuid import uuid4

import pytest
from sqlalchemy.exc import IntegrityError

from app.core.exceptions import ConflictError, NotFoundError, ValidationError
from app.repositories.collection import CollectionRepository
from app.schemas.collection import CollectionCreate, CollectionUpdate
from app.schemas.note import NoteCreate
from app.services.collection import CollectionService
from app.services.note import NoteService


async def _notes(db, user, *titles):
    service = NoteService(db)
    return [await service.create(NoteCreate(title=t), user) for t in titles]


async def test_items_append_in_order_and_counts_follow(db, user):
    collections = CollectionService(db)
    a, b, c = await _notes(db, user, "A", "B", "C")
    col = await collections.create(CollectionCreate(name="Exam revision"), user)
    assert col.item_count == 0

    for note in (b, a, c):
        await collections.add_item(col.id, note.id, user)

    detail = await collections.get(col.id, user)
    assert [i.title for i in detail.items] == ["B", "A", "C"]
    assert [i.position for i in detail.items] == [0, 1, 2]
    [listed] = [x for x in await collections.list(user) if x.id == col.id]
    assert listed.item_count == 3


async def test_empty_collection_still_listed_with_zero(db, user):
    collections = CollectionService(db)
    col = await collections.create(CollectionCreate(name="Empty"), user)

    [listed] = [x for x in await collections.list(user) if x.id == col.id]
    assert listed.item_count == 0  # LEFT JOIN, not JOIN


async def test_adding_the_same_note_twice_is_a_no_op(db, user):
    collections = CollectionService(db)
    [a] = await _notes(db, user, "A")
    col = await collections.create(CollectionCreate(name="Twice"), user)

    await collections.add_item(col.id, a.id, user)
    detail = await collections.add_item(col.id, a.id, user)

    assert detail.item_count == 1


async def test_reorder_rewrites_every_position_in_one_statement(db, user):
    collections = CollectionService(db)
    a, b, c = await _notes(db, user, "A", "B", "C")
    col = await collections.create(CollectionCreate(name="Order"), user)
    for note in (a, b, c):
        await collections.add_item(col.id, note.id, user)

    detail = await collections.reorder(col.id, [c.id, a.id, b.id], user)

    assert [i.title for i in detail.items] == ["C", "A", "B"]
    assert [i.position for i in detail.items] == [0, 1, 2]


@pytest.mark.parametrize("shape", ["missing", "duplicate", "foreign"])
async def test_reorder_rejects_anything_but_the_exact_member_list(db, user, shape):
    collections = CollectionService(db)
    a, b = await _notes(db, user, "A", "B")
    col = await collections.create(CollectionCreate(name="Strict"), user)
    for note in (a, b):
        await collections.add_item(col.id, note.id, user)

    bad = {"missing": [a.id], "duplicate": [a.id, a.id, b.id], "foreign": [a.id, b.id, uuid4()]}

    with pytest.raises(ValidationError):
        await collections.reorder(col.id, bad[shape], user)


async def test_duplicate_name_is_a_conflict_not_a_500(db, user):
    collections = CollectionService(db)
    await collections.create(CollectionCreate(name="Reading"), user)
    other = await collections.create(CollectionCreate(name="Other"), user)

    with pytest.raises(ConflictError):
        await collections.create(CollectionCreate(name="Reading"), user)
    with pytest.raises(ConflictError):
        await collections.update(other.id, CollectionUpdate(name="Reading"), user)
    # Re-saving your own current name is not a conflict.
    await collections.update(other.id, CollectionUpdate(name="Other"), user)


async def test_same_name_is_fine_for_a_different_user(db, user, make_user):
    collections = CollectionService(db)
    stranger = await make_user(display_name="Stranger")
    await collections.create(CollectionCreate(name="Reading"), user)

    await collections.create(CollectionCreate(name="Reading"), stranger)  # UNIQUE(user_id, name)


async def test_cannot_add_someone_elses_note(db, user, make_user):
    collections = CollectionService(db)
    stranger = await make_user(display_name="Stranger")
    their_note = await NoteService(db).create(NoteCreate(title="Theirs", is_public=True), stranger)
    col = await collections.create(CollectionCreate(name="Mine"), user)

    with pytest.raises(NotFoundError):
        await collections.add_item(col.id, their_note.id, user)


async def test_composite_fk_rejects_a_forged_owner_at_the_database(db, user, make_user):
    """Bypasses the service: (note_id, owner_id) must match notes(id, creator_id)."""
    stranger = await make_user(display_name="Stranger")
    [their_note] = await _notes(db, stranger, "Theirs")
    col = await CollectionService(db).create(CollectionCreate(name="Mine"), user)

    with pytest.raises(IntegrityError, match="note_id_owner_id"):
        await CollectionRepository(db).add_item(col.id, their_note.id, user.id)


async def test_collections_are_private(db, user, make_user):
    stranger = await make_user(display_name="Stranger")
    col = await CollectionService(db).create(CollectionCreate(name="Private"), user)

    with pytest.raises(NotFoundError):
        await CollectionService(db).get(col.id, stranger)


async def test_deleting_a_collection_keeps_its_notes(db, user):
    collections = CollectionService(db)
    [a] = await _notes(db, user, "Survivor")
    col = await collections.create(CollectionCreate(name="Temp"), user)
    await collections.add_item(col.id, a.id, user)

    await collections.delete(col.id, user)

    assert (await NoteService(db).get(a.id, user)).title == "Survivor"


async def test_archived_member_is_flagged_and_purged_member_disappears(db, user):
    collections = CollectionService(db)
    notes = NoteService(db)
    [a] = await _notes(db, user, "A")
    col = await collections.create(CollectionCreate(name="Lifecycle"), user)
    await collections.add_item(col.id, a.id, user)

    await notes.delete(a.id, user)  # archive
    [item] = (await collections.get(col.id, user)).items
    assert item.archived is True

    await notes.purge(a.id, user)
    assert (await collections.get(col.id, user)).items == []  # ON DELETE CASCADE
