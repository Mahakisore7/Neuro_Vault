"""[[wiki-links]]: titles in a note's text become graph edges on save, and
the reconciler only ever touches edges it created itself (origin = 'wiki')."""

from sqlalchemy import text

from app.schemas.link import KnowledgeLinkCreate
from app.schemas.note import NoteCreate, NoteUpdate
from app.services.link import LinkService
from app.services.note import NoteService
from app.services.wiki_link import MAX_WIKI_LINKS_PER_NOTE, WikiLinkService

extract = WikiLinkService.extract_titles


def test_extracts_titles_including_the_pipe_form():
    assert extract("<p>See [[BCNF]] and [[Third Normal Form|3NF]].</p>") == [
        "BCNF",
        "Third Normal Form",
    ]


def test_inline_formatting_inside_the_brackets_is_ignored():
    assert extract("<p>[[BC<strong>NF</strong>]]</p>") == ["BCNF"]


def test_html_entities_are_decoded():
    assert extract("<p>[[Q&amp;A]]</p>") == ["Q&A"]


def test_brackets_never_pair_across_paragraphs():
    assert extract("<p>start [[foo</p><p>bar]] end</p>") == []


def test_titles_are_deduplicated_case_insensitively_keeping_the_first_spelling():
    assert extract("<p>[[BCNF]] [[bcnf]] [[  BCNF ]]</p>") == ["BCNF"]


def test_extraction_is_capped():
    content = "".join(f"<p>[[Note {i}]]</p>" for i in range(MAX_WIKI_LINKS_PER_NOTE + 50))
    assert len(extract(content)) == MAX_WIKI_LINKS_PER_NOTE


async def _edges(db, source_id):
    rows = await db.execute(
        text(
            """
            SELECT kl.target_note_id, kl.origin, rt.name
            FROM knowledge_links kl JOIN relationship_types rt ON rt.id = kl.rel_type_id
            WHERE kl.source_note_id = :id ORDER BY kl.origin
            """
        ),
        {"id": source_id},
    )
    return [tuple(r) for r in rows]


async def test_a_title_in_the_text_becomes_a_wiki_edge_and_misses_are_reported(db, user):
    notes = NoteService(db)
    bcnf = await notes.create(NoteCreate(title="BCNF", content="x"), user)

    source = await notes.create(
        NoteCreate(title="Normalization", content="<p>Leads to [[bcnf]] and [[Nowhere]].</p>"),
        user,
    )

    assert await _edges(db, source.id) == [(bcnf.id, "wiki", "relates_to")]
    assert source.unresolved_wiki_links == ["Nowhere"]


async def test_removing_the_text_removes_the_wiki_edge_but_never_a_manual_one(db, user):
    notes = NoteService(db)
    await notes.create(NoteCreate(title="BCNF", content="x"), user)
    joins = await notes.create(NoteCreate(title="Joins", content="x"), user)
    source = await notes.create(NoteCreate(title="Src", content="<p>[[BCNF]]</p>"), user)
    supports = (
        await db.execute(text("SELECT id FROM relationship_types WHERE name = 'supports'"))
    ).scalar_one()
    await LinkService(db).create(
        source.id, KnowledgeLinkCreate(target_note_id=joins.id, rel_type_id=supports), user
    )

    await notes.update(source.id, NoteUpdate(content="<p>No links now.</p>"), user)

    # The wiki edge to BCNF is gone; the hand-made one to Joins survives.
    assert await _edges(db, source.id) == [(joins.id, "manual", "supports")]


async def test_a_hand_made_link_to_the_same_note_is_neither_duplicated_nor_deleted(db, user):
    notes = NoteService(db)
    bcnf = await notes.create(NoteCreate(title="BCNF", content="x"), user)
    source = await notes.create(NoteCreate(title="Src", content="<p>plain</p>"), user)
    supports = (
        await db.execute(text("SELECT id FROM relationship_types WHERE name = 'supports'"))
    ).scalar_one()
    await LinkService(db).create(
        source.id, KnowledgeLinkCreate(target_note_id=bcnf.id, rel_type_id=supports), user
    )

    await notes.update(source.id, NoteUpdate(content="<p>[[BCNF]]</p>"), user)
    assert await _edges(db, source.id) == [(bcnf.id, "manual", "supports")]

    await notes.update(source.id, NoteUpdate(content="<p>gone</p>"), user)
    assert await _edges(db, source.id) == [(bcnf.id, "manual", "supports")]


async def test_never_links_to_someone_elses_note_or_one_in_trash(db, user, make_user):
    notes = NoteService(db)
    stranger = await make_user(display_name="Stranger")
    await notes.create(NoteCreate(title="Theirs", content="x", is_public=True), stranger)
    trashed = await notes.create(NoteCreate(title="Binned", content="x"), user)
    await notes.delete(trashed.id, user)

    source = await notes.create(
        NoteCreate(title="Src", content="<p>[[Theirs]] [[Binned]]</p>"), user
    )

    assert await _edges(db, source.id) == []
    assert source.unresolved_wiki_links == ["Theirs", "Binned"]


async def test_a_duplicate_title_resolves_to_the_most_recently_edited_note(db, user):
    notes = NoteService(db)
    older = await notes.create(NoteCreate(title="Index", content="x"), user)
    newer = await notes.create(NoteCreate(title="Index", content="x"), user)
    await db.execute(
        text("UPDATE notes SET updated_at = now() - interval '1 day' WHERE id = :id"),
        {"id": older.id},
    )

    source = await notes.create(NoteCreate(title="Src", content="<p>[[Index]]</p>"), user)

    assert await _edges(db, source.id) == [(newer.id, "wiki", "relates_to")]


async def test_a_save_that_does_not_touch_content_leaves_wiki_edges_alone(db, user):
    notes = NoteService(db)
    bcnf = await notes.create(NoteCreate(title="BCNF", content="x"), user)
    source = await notes.create(NoteCreate(title="Src", content="<p>[[BCNF]]</p>"), user)
    await db.execute(text("DELETE FROM notes WHERE id = :id"), {"id": bcnf.id})
    await notes.create(NoteCreate(title="BCNF", content="replacement"), user)

    # A pin is not a content change, so no reconcile: still no edge to the
    # replacement (the old edge cascaded away with the deleted note).
    response = await notes.update(source.id, NoteUpdate(pinned=True), user)

    assert await _edges(db, source.id) == []
    assert response.unresolved_wiki_links == []
