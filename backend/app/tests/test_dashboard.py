"""GET /dashboard - totals from v_user_dashboard, lists from v_note_graph_stats
and v_orphan_notes. The views' own arithmetic is tested in
test_views_and_functions.py; these check what the endpoint selects from them."""

from sqlalchemy import text

from app.schemas.note import NoteCreate
from app.services.dashboard import DashboardService
from app.services.note import NoteService


async def _link(db, source, target, by):
    await db.execute(
        text(
            "INSERT INTO knowledge_links (source_note_id, target_note_id, rel_type_id, created_by)"
            " VALUES (:s, :t, 1, :u)"
        ),
        {"s": source.id, "t": target.id, "u": by.id},
    )


async def test_lists_rank_hubs_and_find_orphans(db, user):
    notes = NoteService(db)
    hub, a, b, lonely = [
        await notes.create(NoteCreate(title=t), user) for t in ("Hub", "A", "B", "Lonely")
    ]
    await _link(db, hub, a, user)
    await _link(db, b, hub, user)

    dash = await DashboardService(db).get(user)

    assert (dash.most_connected[0].title, dash.most_connected[0].degree) == ("Hub", 2)
    assert sorted((n.title, n.degree) for n in dash.most_connected[1:]) == [("A", 1), ("B", 1)]
    assert [n.title for n in dash.orphans] == ["Lonely"]
    assert dash.totals.total_notes == 4
    assert dash.totals.link_count == 2


async def test_trashed_and_other_peoples_notes_stay_out(db, user, make_user):
    notes = NoteService(db)
    other = await make_user(display_name="Other")
    await notes.create(NoteCreate(title="Theirs", is_public=True), other)
    mine = await notes.create(NoteCreate(title="Mine"), user)
    binned = await notes.create(NoteCreate(title="Binned"), user)
    await notes.delete(binned.id, user)

    dash = await DashboardService(db).get(user)

    assert [n.title for n in dash.recent] == ["Mine"]
    assert [n.title for n in dash.orphans] == ["Mine"]
    assert (dash.totals.total_notes, dash.totals.archived_notes) == (1, 1)
    assert mine.id in {n.id for n in dash.recent}


async def test_new_user_gets_an_empty_dashboard_not_an_error(db, user):
    dash = await DashboardService(db).get(user)

    assert dash.totals.total_notes == 0
    assert (dash.most_connected, dash.orphans, dash.recent) == ([], [], [])
