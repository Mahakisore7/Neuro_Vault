"""knowledge_links + the recursive-CTE graph traversal (docs/phases/New/03-
SQL-LAYER.md §3.6) — ADR-007's two-sided FK (composite on the source,
plain on the target), the cycle guard, the depth bound, and the visibility
predicate that keeps traversal from crossing through a note the caller
can't read.
"""

from uuid import uuid4

import pytest
from sqlalchemy.exc import IntegrityError

from app.core.exceptions import NotFoundError, PermissionDeniedError, ValidationError
from app.repositories.link import KnowledgeLinkRepository
from app.schemas.link import KnowledgeLinkCreate
from app.schemas.note import NoteCreate
from app.services.link import LinkService
from app.services.note import NoteService

RELATES_TO = 1  # first seeded row — see the migration; order is insertion order


async def _make_note(db, user, title: str, *, is_public: bool = False):
    return await NoteService(db).create(NoteCreate(title=title, is_public=is_public), user)


async def test_create_link_between_own_notes(db, user):
    links = LinkService(db)
    a = await _make_note(db, user, "A")
    b = await _make_note(db, user, "B")

    link = await links.create(a.id, KnowledgeLinkCreate(target_note_id=b.id, rel_type_id=RELATES_TO), user)

    assert link.source_note_id == a.id
    assert link.target_note_id == b.id


async def test_cannot_link_a_note_to_itself(db, user):
    a = await _make_note(db, user, "A")
    with pytest.raises(ValidationError):
        await LinkService(db).create(
            a.id, KnowledgeLinkCreate(target_note_id=a.id, rel_type_id=RELATES_TO), user
        )


async def test_cannot_create_link_from_someone_elses_note(db, user, make_user):
    """ADR-007: an edge may only originate from a note you own."""
    stranger = await make_user(display_name="Stranger")
    their_note = await _make_note(db, stranger, "Not yours")
    my_note = await _make_note(db, user, "Mine")

    with pytest.raises(PermissionDeniedError):
        await LinkService(db).create(
            their_note.id, KnowledgeLinkCreate(target_note_id=my_note.id, rel_type_id=RELATES_TO), user
        )


async def test_can_link_to_someone_elses_public_note_but_not_their_private_one(db, user, make_user):
    """target_note_id is a plain FK: you may point an edge at any note you
    can READ. Public passes; private is a clean 404, not a 403 — the same
    exists-but-hidden semantics as everywhere else a note might be private.
    """
    stranger = await make_user(display_name="Stranger")
    public_note = await _make_note(db, stranger, "Public", is_public=True)
    private_note = await _make_note(db, stranger, "Private", is_public=False)
    my_note = await _make_note(db, user, "Mine")

    link = await LinkService(db).create(
        my_note.id, KnowledgeLinkCreate(target_note_id=public_note.id, rel_type_id=RELATES_TO), user
    )
    assert link.target_note_id == public_note.id

    with pytest.raises(NotFoundError):
        await LinkService(db).create(
            my_note.id,
            KnowledgeLinkCreate(target_note_id=private_note.id, rel_type_id=RELATES_TO),
            user,
        )


async def test_composite_fk_rejects_a_forged_source_owner(db, user):
    """Bypassing the service (as ADR-001-style tests do elsewhere): the
    database itself refuses a link whose (source_note_id, created_by) pair
    doesn't match a real note - not just the service-layer check above.
    Two distinct notes, so the no_self_link CHECK can't also fire and mask
    which constraint actually rejected the insert.
    """
    a = await _make_note(db, user, "A")
    b = await _make_note(db, user, "B")
    forger_id = uuid4()

    with pytest.raises(IntegrityError, match="source_note_id_created_by"):
        await KnowledgeLinkRepository(db).create(
            source_note_id=a.id,
            target_note_id=b.id,
            rel_type_id=RELATES_TO,
            created_by=forger_id,
        )


async def test_unknown_relationship_type_is_a_clean_404(db, user):
    a = await _make_note(db, user, "A")
    b = await _make_note(db, user, "B")

    with pytest.raises(NotFoundError):
        await LinkService(db).create(a.id, KnowledgeLinkCreate(target_note_id=b.id, rel_type_id=9999), user)


async def test_graph_traverses_multiple_hops_with_correct_depth(db, user):
    links = LinkService(db)
    a = await _make_note(db, user, "A")
    b = await _make_note(db, user, "B")
    c = await _make_note(db, user, "C")
    await links.create(a.id, KnowledgeLinkCreate(target_note_id=b.id, rel_type_id=RELATES_TO), user)
    await links.create(b.id, KnowledgeLinkCreate(target_note_id=c.id, rel_type_id=RELATES_TO), user)

    graph = await links.get_graph(a.id, user, max_depth=6)

    depths = {node.id: node.depth for node in graph.nodes}
    assert depths == {a.id: 0, b.id: 1, c.id: 2}
    assert len(graph.edges) == 2


async def test_graph_respects_max_depth(db, user):
    links = LinkService(db)
    a = await _make_note(db, user, "A")
    b = await _make_note(db, user, "B")
    c = await _make_note(db, user, "C")
    await links.create(a.id, KnowledgeLinkCreate(target_note_id=b.id, rel_type_id=RELATES_TO), user)
    await links.create(b.id, KnowledgeLinkCreate(target_note_id=c.id, rel_type_id=RELATES_TO), user)

    graph = await links.get_graph(a.id, user, max_depth=1)

    assert {node.id for node in graph.nodes} == {a.id, b.id}


async def test_graph_handles_a_cycle_without_looping_forever(db, user):
    """A <-> B <-> C <-> A. Without the visited-path guard this query never
    terminates; asserting it returns at all (pytest's own timeout aside) is
    the point of the test.
    """
    links = LinkService(db)
    a = await _make_note(db, user, "A")
    b = await _make_note(db, user, "B")
    c = await _make_note(db, user, "C")
    await links.create(a.id, KnowledgeLinkCreate(target_note_id=b.id, rel_type_id=RELATES_TO), user)
    await links.create(b.id, KnowledgeLinkCreate(target_note_id=c.id, rel_type_id=RELATES_TO), user)
    await links.create(c.id, KnowledgeLinkCreate(target_note_id=a.id, rel_type_id=RELATES_TO), user)

    graph = await links.get_graph(a.id, user, max_depth=6)

    assert {node.id for node in graph.nodes} == {a.id, b.id, c.id}
    assert len(graph.edges) == 3


async def test_graph_traversal_does_not_cross_a_private_note_owned_by_someone_else(
    db, user, make_user
):
    """A (mine, public) -- links to --> X (stranger's PRIVATE note) -- links
    to --> B (stranger's PUBLIC note). B is reachable through a note I can't
    read, so it must not appear - the traversal itself has to stop at X,
    not merely hide X's content once reached.
    """
    stranger = await make_user(display_name="Stranger")
    links = LinkService(db)

    a = await _make_note(db, user, "Mine", is_public=True)
    x = await _make_note(db, stranger, "Stranger's private bridge", is_public=False)
    b = await _make_note(db, stranger, "Stranger's public far side", is_public=True)

    await KnowledgeLinkRepository(db).create(
        source_note_id=a.id, target_note_id=x.id, rel_type_id=RELATES_TO, created_by=user.id
    )
    await KnowledgeLinkRepository(db).create(
        source_note_id=x.id, target_note_id=b.id, rel_type_id=RELATES_TO, created_by=stranger.id
    )

    graph = await links.get_graph(a.id, user, max_depth=6)

    visible_ids = {node.id for node in graph.nodes}
    assert visible_ids == {a.id}
    assert b.id not in visible_ids


async def test_graph_on_a_note_the_caller_cannot_read_is_not_found(db, user, make_user):
    stranger = await make_user(display_name="Stranger")
    private_note = await _make_note(db, stranger, "Private", is_public=False)

    with pytest.raises(NotFoundError):
        await LinkService(db).get_graph(private_note.id, user, max_depth=3)


async def test_delete_link_requires_being_its_creator(db, user, make_user):
    stranger = await make_user(display_name="Stranger")
    links = LinkService(db)
    a = await _make_note(db, user, "A", is_public=True)
    b = await _make_note(db, user, "B", is_public=True)
    link = await links.create(a.id, KnowledgeLinkCreate(target_note_id=b.id, rel_type_id=RELATES_TO), user)

    with pytest.raises(PermissionDeniedError):
        await links.delete(a.id, link.id, stranger)

    await links.delete(a.id, link.id, user)
    assert await links.list_for_note(a.id, user) == []


async def test_list_relationship_types_returns_the_seeded_vocabulary(db):
    types = await LinkService(db).list_relationship_types()
    names = {t.name for t in types}
    assert names == {
        "relates_to",
        "supports",
        "contradicts",
        "extends",
        "example_of",
        "prerequisite_for",
        "see_also",
    }
