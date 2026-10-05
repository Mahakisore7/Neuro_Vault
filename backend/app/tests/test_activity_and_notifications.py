"""Activity log and notifications - both written ONLY by database triggers
(fn_log_note_activity, fn_log_link_activity, fn_notify_on_link). The app's
services just read them, so most of these tests are really trigger tests.
"""

from uuid import uuid4

import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from app.core.exceptions import NotFoundError
from app.schemas.link import KnowledgeLinkCreate
from app.schemas.note import NoteCreate, NoteUpdate
from app.services.activity import ActivityService
from app.services.link import LinkService
from app.services.note import NoteService
from app.services.notification import NotificationService

RELATES_TO = 1


async def _events(db, user) -> list[tuple[str, int]]:
    return [(e.metadata["event"], e.count) for e in await ActivityService(db).feed(user)]


async def test_trigger_logs_a_raw_sql_insert_with_no_app_code_involved(db, user):
    note_id = uuid4()
    await db.execute(
        text("INSERT INTO notes (id, creator_id, title) VALUES (:id, :uid, 'Raw SQL')"),
        {"id": note_id, "uid": user.id},
    )

    row = (
        await db.execute(
            text(
                "SELECT action_type, metadata ->> 'title' FROM activity_logs "
                "WHERE entity_id = :id"
            ),
            {"id": note_id},
        )
    ).one()

    assert tuple(row) == ("create", "Raw SQL")


async def test_each_kind_of_note_change_gets_its_own_event(db, user):
    notes = NoteService(db)
    note = await notes.create(NoteCreate(title="Joins"), user)
    await notes.update(note.id, NoteUpdate(is_public=True), user)
    await notes.update(note.id, NoteUpdate(title="SQL joins"), user)
    await notes.delete(note.id, user)  # archive
    await notes.update(note.id, NoteUpdate(archived=False), user)

    assert [event for event, _ in await _events(db, user)] == [
        "restored",
        "trashed",
        "edited",
        "published",
        "created",
    ]


async def test_pinning_is_not_logged(db, user):
    notes = NoteService(db)
    note = await notes.create(NoteCreate(title="Pin me"), user)

    await notes.update(note.id, NoteUpdate(pinned=True), user)

    assert await _events(db, user) == [("created", 1)]


async def test_autosave_runs_collapse_into_one_feed_entry(db, user):
    """Gaps-and-islands in the feed query: consecutive 'edited' rows for the
    same note become one entry, while the raw log keeps every row."""
    notes = NoteService(db)
    note = await notes.create(NoteCreate(title="Draft"), user)
    for i in range(3):
        await notes.update(note.id, NoteUpdate(content=f"<p>v{i}</p>"), user)
    await notes.delete(note.id, user)

    assert await _events(db, user) == [("trashed", 1), ("edited", 3), ("created", 1)]
    raw = (
        await db.execute(
            text("SELECT count(*) FROM activity_logs WHERE entity_id = :id"), {"id": note.id}
        )
    ).scalar_one()
    assert raw == 5


async def test_edits_to_different_notes_are_not_merged(db, user):
    notes = NoteService(db)
    a = await notes.create(NoteCreate(title="A"), user)
    b = await notes.create(NoteCreate(title="B"), user)
    for note in (a, b, a):
        await notes.update(note.id, NoteUpdate(content=f"<p>{uuid4()}</p>"), user)

    feed = await ActivityService(db).feed(user)

    assert [(e.metadata["title"], e.metadata["event"]) for e in feed[:3]] == [
        ("A", "edited"),
        ("B", "edited"),
        ("A", "edited"),
    ]


async def test_purge_is_logged_and_the_log_outlives_the_note(db, user):
    notes = NoteService(db)
    note = await notes.create(NoteCreate(title="Gone"), user)
    await notes.delete(note.id, user)
    await notes.purge(note.id, user)

    [latest, *_] = await ActivityService(db).feed(user)

    assert (latest.action_type, latest.entity_id) == ("delete", note.id)
    assert latest.metadata["title"] == "Gone"


async def test_linking_someone_elses_public_note_notifies_them(db, user, make_user):
    author = await make_user(display_name="Author")
    theirs = await NoteService(db).create(NoteCreate(title="B-trees", is_public=True), author)
    mine = await NoteService(db).create(NoteCreate(title="Indexing"), user)

    await LinkService(db).create(
        mine.id, KnowledgeLinkCreate(target_note_id=theirs.id, rel_type_id=RELATES_TO), user
    )

    [notification] = await NotificationService(db).recent(author)
    assert notification.type == "link_created"
    assert notification.body == '"Indexing" now links to your note "B-trees"'
    assert notification.link_url == f"/notes/{theirs.id}"
    assert notification.is_read is False  # the column's server default, set by the migration
    assert await NotificationService(db).recent(user) == []  # linker isn't notified


async def test_linking_your_own_notes_logs_activity_but_notifies_nobody(db, user):
    notes = NoteService(db)
    a = await notes.create(NoteCreate(title="A"), user)
    b = await notes.create(NoteCreate(title="B"), user)

    link = await LinkService(db).create(
        a.id, KnowledgeLinkCreate(target_note_id=b.id, rel_type_id=RELATES_TO), user
    )
    await LinkService(db).delete(a.id, link.id, user)

    feed = await ActivityService(db).feed(user)
    assert [e.metadata["event"] for e in feed[:2]] == ["unlinked", "linked"]
    assert feed[1].metadata["relationship"] == "relates_to"
    assert await NotificationService(db).recent(user) == []


async def test_purging_a_note_does_not_log_its_cascaded_links_as_unlinks(db, user):
    notes = NoteService(db)
    a = await notes.create(NoteCreate(title="A"), user)
    b = await notes.create(NoteCreate(title="B"), user)
    await LinkService(db).create(
        a.id, KnowledgeLinkCreate(target_note_id=b.id, rel_type_id=RELATES_TO), user
    )

    await notes.delete(a.id, user)
    await notes.purge(a.id, user)

    assert "unlinked" not in [event for event, _ in await _events(db, user)]


async def test_a_rejected_link_leaves_no_notification(db, user, make_user):
    author = await make_user(display_name="Author")
    stranger = await make_user(display_name="Stranger")
    theirs = await NoteService(db).create(NoteCreate(title="Target", is_public=True), author)
    mine = await NoteService(db).create(NoteCreate(title="Mine"), user)

    # Stranger tries to create an edge out of *my* note: the composite FK
    # (source_note_id, created_by) -> notes(id, creator_id) refuses it.
    with pytest.raises(IntegrityError):
        async with db.begin_nested():
            await db.execute(
                text(
                    "INSERT INTO knowledge_links "
                    "(id, source_note_id, target_note_id, rel_type_id, created_by) "
                    "VALUES (gen_random_uuid(), :src, :tgt, 1, :by)"
                ),
                {"src": mine.id, "tgt": theirs.id, "by": stranger.id},
            )

    assert await NotificationService(db).recent(author) == []


async def test_deleting_a_user_still_works_with_the_triggers_in_place(db, user, make_user):
    """Account deletion cascades users -> notes -> knowledge_links. Without
    the triggers' "does this user still exist" guard, logging those cascaded
    deletes would violate activity_logs.user_id's FK and abort the delete."""
    leaving = await make_user(display_name="Leaving")
    theirs = await NoteService(db).create(NoteCreate(title="Theirs"), leaving)
    other = await NoteService(db).create(NoteCreate(title="Other"), leaving)
    await LinkService(db).create(
        theirs.id, KnowledgeLinkCreate(target_note_id=other.id, rel_type_id=RELATES_TO), leaving
    )

    await db.execute(text("DELETE FROM users WHERE id = :id"), {"id": leaving.id})

    orphaned = (
        await db.execute(
            text(
                "SELECT count(*) FROM activity_logs "
                "WHERE entity_id IN (:a, :b) AND user_id IS NULL"
            ),
            {"a": theirs.id, "b": other.id},
        )
    ).scalar_one()
    assert orphaned == 2  # the 'created' rows survive, actor SET NULL - still an audit trail


async def test_marking_read_and_unread_count(db, user, make_user):
    linker = await make_user(display_name="Linker")
    service = NotificationService(db)
    mine = await NoteService(db).create(NoteCreate(title="Popular", is_public=True), user)
    for title in ("X", "Y", "Z"):
        source = await NoteService(db).create(NoteCreate(title=title), linker)
        await LinkService(db).create(
            source.id, KnowledgeLinkCreate(target_note_id=mine.id, rel_type_id=RELATES_TO), linker
        )
    assert await service.unread_count(user) == 3

    newest, *_ = await service.recent(user)
    assert (await service.mark_read(newest.id, user)).is_read is True
    assert await service.unread_count(user) == 2

    await service.mark_all_read(user)
    assert await service.unread_count(user) == 0


async def test_notifications_are_private(db, user, make_user):
    linker = await make_user(display_name="Linker")
    mine = await NoteService(db).create(NoteCreate(title="Mine", is_public=True), user)
    source = await NoteService(db).create(NoteCreate(title="Src"), linker)
    await LinkService(db).create(
        source.id, KnowledgeLinkCreate(target_note_id=mine.id, rel_type_id=RELATES_TO), linker
    )
    [notification] = await NotificationService(db).recent(user)

    with pytest.raises(NotFoundError):
        await NotificationService(db).mark_read(notification.id, linker)


async def test_unread_count_uses_the_partial_index(db, user):
    """The case the partial index exists for: an old account with thousands
    of read notifications and a handful unread. ANALYZE so the planner sees
    that shape; it then picks the small unread-only index over the full one,
    which would have to visit and discard every read row."""
    await db.execute(
        text(
            "INSERT INTO notifications (user_id, type, title, is_read) "
            "SELECT :uid, 'system', 'Old news', TRUE FROM generate_series(1, 2000)"
        ),
        {"uid": user.id},
    )
    await db.execute(
        text("INSERT INTO notifications (user_id, type, title) VALUES (:uid, 'system', 'New')"),
        {"uid": user.id},
    )
    await db.execute(text("ANALYZE notifications"))

    plan = (
        await db.execute(
            text(
                "EXPLAIN SELECT count(*) FROM notifications "
                "WHERE user_id = :uid AND is_read = FALSE"
            ),
            {"uid": user.id},
        )
    ).scalars().all()

    assert any("idx_notifications_user_id_created_at" in line for line in plan), "\n".join(plan)
