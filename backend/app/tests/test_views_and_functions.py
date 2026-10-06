"""Views (v_note_graph_stats, v_note_search, v_user_dashboard, v_orphan_notes),
graph functions (fn_note_distances, fn_max_graph_depth, fn_shortest_path),
and the indexes that back the app's queries.
"""

from itertools import combinations
from uuid import uuid4

import pytest
from sqlalchemy import text

from app.core.exceptions import NotFoundError
from app.schemas.note import NoteCreate
from app.services.link import LinkService
from app.services.note import NoteService

RELATES_TO = 1


async def _notes(db, user, *titles, **kwargs):
    service = NoteService(db)
    return [await service.create(NoteCreate(title=t, **kwargs), user) for t in titles]


async def _link(db, source, target, by):
    # Raw SQL keeps the graph tests fast and independent of LinkService.
    await db.execute(
        text(
            "INSERT INTO knowledge_links (source_note_id, target_note_id, rel_type_id, created_by)"
            " VALUES (:s, :t, :r, :u)"
        ),
        {"s": source.id, "t": target.id, "r": RELATES_TO, "u": by.id},
    )


async def _rows(db, sql: str, **params):
    return (await db.execute(text(sql), params)).all()


# ── v_user_dashboard ──────────────────────────────────────────────────────────


async def test_dashboard_word_count_is_not_multiplied_by_joins(db, user):
    """The original design joined notes, workspaces, and links in one FROM.
    COUNT(DISTINCT) hid the fan-out for counts, but SUM(word_count) was
    multiplied by workspaces x links. Run both side by side."""
    a, b = await _notes(db, user, "A", "B")
    await db.execute(
        text("UPDATE notes SET content = :c WHERE id = :id"),
        {"c": "<p>one two three four five</p>", "id": a.id},
    )  # 5 words; B has 0
    for i in range(3):
        await db.execute(
            text("INSERT INTO workspaces (owner_id, name, slug) VALUES (:u, :n, :s)"),
            {"u": user.id, "n": f"W{i}", "s": f"w-{i}"},
        )
    await _link(db, a, b, user)
    await _link(db, b, a, user)

    [fixed] = await _rows(db, "SELECT * FROM v_user_dashboard WHERE user_id = :u", u=user.id)
    [original] = await _rows(
        db,
        """
        SELECT COUNT(DISTINCT n.id) AS total_notes, COALESCE(SUM(n.word_count), 0) AS total_words
        FROM users u
        LEFT JOIN notes n ON n.creator_id = u.id
        LEFT JOIN workspaces w ON w.owner_id = u.id
        LEFT JOIN knowledge_links kl ON kl.created_by = u.id
        WHERE u.id = :u
        """,
        u=user.id,
    )

    assert (fixed.total_notes, fixed.total_words) == (2, 5)
    assert (fixed.workspace_count, fixed.link_count) == (3, 2)
    assert original.total_notes == 2  # DISTINCT saved the count...
    assert original.total_words == 5 * 3 * 2  # ...but not the sum: 3 workspaces x 2 links


async def test_dashboard_for_a_brand_new_user_is_all_zeros(db, user):
    [row] = await _rows(db, "SELECT * FROM v_user_dashboard WHERE user_id = :u", u=user.id)

    assert (row.total_notes, row.total_words, row.workspace_count, row.cards_due) == (0, 0, 0, 0)
    assert row.last_edited_at is None


async def test_dashboard_separates_trashed_notes(db, user):
    notes = NoteService(db)
    keep, binned = await _notes(db, user, "Keep", "Binned")
    await notes.delete(binned.id, user)

    [row] = await _rows(db, "SELECT * FROM v_user_dashboard WHERE user_id = :u", u=user.id)

    assert (row.total_notes, row.archived_notes) == (1, 1)


# ── v_orphan_notes / v_note_graph_stats ───────────────────────────────────────


async def test_orphans_are_live_notes_with_no_links_either_way(db, user):
    linked_a, linked_b, lonely, binned = await _notes(db, user, "A", "B", "Lonely", "Binned")
    await _link(db, linked_a, linked_b, user)
    await NoteService(db).delete(binned.id, user)

    rows = await _rows(db, "SELECT title FROM v_orphan_notes WHERE creator_id = :u", u=user.id)

    assert [r.title for r in rows] == ["Lonely"]


async def test_graph_stats_count_each_direction_without_fan_out(db, user):
    hub, x, y, z = await _notes(db, user, "Hub", "X", "Y", "Z")
    await _link(db, hub, x, user)
    await _link(db, hub, y, user)
    await _link(db, z, hub, user)
    for i in range(3):  # 3 real content changes -> 3 versions; mustn't multiply link counts
        await db.execute(
            text("UPDATE notes SET content = :c WHERE id = :id"), {"c": f"<p>{i}</p>", "id": hub.id}
        )

    [s] = await _rows(db, "SELECT * FROM v_note_graph_stats WHERE note_id = :n", n=hub.id)

    assert (s.outgoing_count, s.incoming_count, s.degree, s.version_count) == (2, 1, 3, 3)


async def test_every_view_checks_rls_as_the_caller(db):
    """Default views run with the owner's rights and bypass RLS - over
    Supabase's REST API that would be a hole. All four are security_invoker."""
    rows = await _rows(
        db,
        """
        SELECT c.relname, c.reloptions
        FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
        WHERE ns.nspname = 'public' AND c.relkind = 'v'
        ORDER BY c.relname
        """,
    )

    assert [r.relname for r in rows] == [
        "v_note_graph_stats",
        "v_note_search",
        "v_orphan_notes",
        "v_user_dashboard",
    ]
    assert all("security_invoker=true" in (r.reloptions or []) for r in rows)


# ── fn_note_distances / fn_shortest_path / fn_max_graph_depth ─────────────────


async def test_shortest_path_takes_the_short_route(db, user):
    a, b, c, d, e = await _notes(db, user, "A", "B", "C", "D", "E")
    for s, t in ((a, b), (b, c), (c, d), (d, e)):  # long way: A-B-C-D-E
        await _link(db, s, t, user)
    await _link(db, e, b, user)  # direction doesn't matter: E-B is a shortcut back

    path = await LinkService(db).shortest_path(a.id, e.id, user, 10)

    assert [p.title for p in path] == ["A", "B", "E"]
    assert [p.step for p in path] == [0, 1, 2]


async def test_no_path_is_an_empty_list_not_an_error(db, user):
    a, island = await _notes(db, user, "A", "Island")

    assert await LinkService(db).shortest_path(a.id, island.id, user, 10) == []


async def test_paths_never_pass_through_someone_elses_private_note(db, user, make_user):
    other = await make_user(display_name="Other")
    a, b = await _notes(db, user, "A", "B", is_public=True)
    [secret] = await _notes(db, other, "Secret")  # private
    await _link(db, secret, a, other)
    await _link(db, secret, b, other)  # A - Secret - B is the only route

    assert await LinkService(db).shortest_path(a.id, b.id, user, 10) == []
    # ...while its owner sees the route through it.
    path = await LinkService(db).shortest_path(a.id, b.id, other, 10)
    assert [p.title for p in path] == ["A", "Secret", "B"]


async def test_path_to_an_unreadable_note_is_a_404(db, user, make_user):
    other = await make_user(display_name="Other")
    [mine] = await _notes(db, user, "Mine")
    [theirs] = await _notes(db, other, "Theirs")

    with pytest.raises(NotFoundError):
        await LinkService(db).shortest_path(mine.id, theirs.id, user, 10)


async def test_max_depth_is_the_farthest_shortest_distance(db, user):
    a, b, c, lonely = await _notes(db, user, "A", "B", "C", "Lonely")
    await _link(db, a, b, user)
    await _link(db, b, c, user)
    await _link(db, c, a, user)  # a cycle: everything is within 1 hop of A

    stats = await LinkService(db).stats(a.id, user)
    assert stats.max_depth == 1
    assert (await LinkService(db).stats(lonely.id, user)).max_depth == 0
    assert (
        await db.execute(
            text("SELECT fn_max_graph_depth(:n, :u)"), {"n": uuid4(), "u": user.id}
        )
    ).scalar_one() is None  # unknown note: NULL, not 0


async def test_bfs_expands_each_note_once_where_path_enumeration_explodes(db, user):
    """Every pair of 9 notes linked (36 links). The per-path recursive CTE
    from the original design produces one row per simple path; BFS returns
    one row per note."""
    notes = await _notes(db, user, *[f"N{i}" for i in range(9)])
    for s, t in combinations(notes, 2):
        await _link(db, s, t, user)

    bfs = await _rows(
        db, "SELECT * FROM fn_note_distances(:r, :u, 4)", r=notes[0].id, u=user.id
    )
    [per_path] = await _rows(
        db,
        """
        WITH RECURSIVE g AS (
            SELECT n.id, 0 AS depth, ARRAY[n.id] AS path FROM notes n WHERE n.id = :r
            UNION ALL
            SELECT nxt.id, g.depth + 1, g.path || nxt.id
            FROM g
            JOIN knowledge_links kl ON kl.source_note_id = g.id OR kl.target_note_id = g.id
            JOIN notes nxt ON nxt.id = CASE WHEN kl.source_note_id = g.id
                                            THEN kl.target_note_id ELSE kl.source_note_id END
            WHERE g.depth < 4 AND nxt.id <> ALL(g.path)
        )
        SELECT count(*) AS n FROM g
        """,
        r=notes[0].id,
    )

    assert len(bfs) == 9
    assert {r.depth for r in bfs} == {0, 1}
    assert per_path.n == 1 + 8 + 8 * 7 + 8 * 7 * 6 + 8 * 7 * 6 * 5  # 2,081 rows


# ── fuzzy search (pg_trgm) ────────────────────────────────────────────────────


async def test_a_typo_falls_back_to_similar_titles(db, user):
    await _notes(db, user, "Normalization")

    results = await NoteService(db).search(user, "normalizaton")

    assert [(r.title, r.fuzzy) for r in results] == [("Normalization", True)]


async def test_real_matches_are_not_marked_fuzzy(db, user):
    await _notes(db, user, "Normalization")

    [result] = await NoteService(db).search(user, "normalization")

    assert result.fuzzy is False


async def test_fuzzy_fallback_respects_visibility_and_trash(db, user, make_user):
    other = await make_user(display_name="Other")
    await _notes(db, other, "Normalization")  # private, someone else's
    [binned] = await _notes(db, user, "Normalisation")
    await NoteService(db).delete(binned.id, user)

    assert await NoteService(db).search(user, "normalizaton") == []


# ── indexes ───────────────────────────────────────────────────────────────────


async def _plan(db, sql: str, **params) -> str:
    await db.execute(text("SET LOCAL enable_seqscan = off"))
    rows = (await db.execute(text("EXPLAIN " + sql), params)).scalars().all()
    return "\n".join(rows)


async def test_note_list_reads_rows_already_sorted(db, user):
    # enable_sort = off as well: the question is "can this index hand back
    # rows already in ORDER BY order", independent of table statistics. If it
    # couldn't, the plan would still need a Sort node (just a costlier one).
    await db.execute(text("SET LOCAL enable_sort = off"))
    plan = await _plan(
        db,
        "SELECT id FROM notes WHERE creator_id = :u AND archived = false "
        "ORDER BY pinned DESC, updated_at DESC LIMIT 50",
        u=user.id,
    )

    assert "idx_notes_creator_id_pinned_updated_at" in plan, plan
    assert "Sort" not in plan, plan


async def test_incoming_links_use_the_target_index(db, user):
    plan = await _plan(
        db, "SELECT id FROM knowledge_links WHERE target_note_id = :n", n=uuid4()
    )

    assert "idx_knowledge_links_target_note_id" in plan, plan


async def test_title_similarity_uses_the_trigram_index(db, user):
    plan = await _plan(db, "SELECT id FROM notes WHERE title % :q", q="normalizaton")

    assert "idx_notes_title_trgm" in plan, plan


async def test_the_search_view_is_inlined_into_the_same_plan_as_the_table(db, user):
    """A view is substituted into the query before planning, so searching
    v_note_search must plan exactly like the equivalent query on notes - and
    keeps every index that query could use (test_search already shows the
    GIN index serves it; on a 50k-row table the default planner picks it
    through the view too). Plans compared at realistic-ish size."""
    await db.execute(
        text(
            "INSERT INTO notes (creator_id, title, content) "
            "SELECT :u, 'Note ' || i, '<p>filler text number ' || i || '</p>' "
            "FROM generate_series(1, 500) AS i"
        ),
        {"u": user.id},
    )
    await db.execute(text("ANALYZE notes"))

    async def plan(sql: str) -> list[str]:
        rows = (await db.execute(text("EXPLAIN " + sql))).scalars().all()
        # Alias aside ("notes n" vs "notes"), the plans must match line for line.
        return [r.replace("notes n ", "notes ") for r in rows]

    via_view = await plan(
        "SELECT id FROM v_note_search "
        "WHERE search_vector @@ websearch_to_tsquery('english', 'docker')"
    )
    via_table = await plan(
        "SELECT id FROM notes "
        "WHERE archived = false AND search_vector @@ websearch_to_tsquery('english', 'docker')"
    )

    assert via_view == via_table
