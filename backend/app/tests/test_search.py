"""Full-text search: websearch_to_tsquery + ts_rank_cd + ts_headline over
the notes.search_vector generated column (docs/phases/New/03-SQL-LAYER.md Q15).
"""

from sqlalchemy import text

from app.schemas.note import NoteCreate
from app.services.note import NoteService

START, STOP = "\x01", "\x02"


async def _note(db, user, title, content=None, *, is_public=False):
    return await NoteService(db).create(
        NoteCreate(title=title, content=content, is_public=is_public), user
    )


async def test_matches_body_text_and_marks_the_hit(db, user):
    await _note(db, user, "Docker", "<p>Containers give each service its own isolation.</p>")

    [hit] = await NoteService(db).search(user, "isolation")

    assert hit.title == "Docker"
    assert f"{START}isolation{STOP}" in hit.snippet


async def test_stemming_matches_other_word_forms(db, user):
    await _note(db, user, "Docker", "<p>One container per process.</p>")

    results = await NoteService(db).search(user, "containers")

    assert [r.title for r in results] == ["Docker"]


async def test_title_match_outranks_body_only_match(db, user):
    """setweight: title lexemes are weight A, body lexemes weight B."""
    await _note(db, user, "Unrelated", "<p>a passing mention of normalization</p>")
    await _note(db, user, "Normalization", "<p>1NF, 2NF, 3NF</p>")

    results = await NoteService(db).search(user, "normalization")

    assert [r.title for r in results] == ["Normalization", "Unrelated"]
    assert results[0].title_highlight == f"{START}Normalization{STOP}"


async def test_excludes_archived_notes(db, user):
    notes = NoteService(db)
    note = await _note(db, user, "Gone", "<p>kubernetes</p>")
    await notes.delete(note.id, user)

    assert await notes.search(user, "kubernetes") == []


async def test_visibility_includes_others_public_but_not_private(db, user, make_user):
    stranger = await make_user(display_name="Stranger")
    await _note(db, stranger, "Public one", "<p>quantum</p>", is_public=True)
    await _note(db, stranger, "Private one", "<p>quantum</p>", is_public=False)

    results = await NoteService(db).search(user, "quantum")

    assert [(r.title, r.is_own) for r in results] == [("Public one", False)]


async def test_malformed_input_never_raises(db, user):
    """websearch_to_tsquery accepts anything a person types; to_tsquery
    would raise a syntax error on most of these."""
    notes = NoteService(db)
    for q in ['"unclosed quote', "a & | ! (", "-", "   "]:
        await notes.search(user, q)


async def test_html_entities_come_back_as_plain_text(db, user):
    await _note(db, user, "Budget", "<p>R&amp;D spending on research</p>")

    [hit] = await NoteService(db).search(user, "research")

    assert "R&D" in hit.snippet
    assert "&amp;" not in hit.snippet


async def test_search_query_can_use_the_gin_index(db):
    """Not "is it fast on today's tiny table" - the planner picks a seq scan
    for a handful of rows regardless. With seq scans disabled, a usable
    index must show up; if the query or the generated column ever drift
    apart so the index no longer applies, this is what fails.
    """
    await db.execute(text("SET LOCAL enable_seqscan = off"))
    plan = (
        await db.execute(
            text(
                "EXPLAIN SELECT id FROM notes "
                "WHERE search_vector @@ websearch_to_tsquery('english', 'docker')"
            )
        )
    ).scalars().all()

    assert any("idx_notes_search_vector" in line for line in plan), "\n".join(plan)
