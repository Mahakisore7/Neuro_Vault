"""Row level security, tested the way Supabase's REST API runs queries.

PostgREST switches to the `authenticated` role (or `anon` with no JWT) and
puts the JWT's claims in request.jwt.claim.sub, which auth.uid() reads. These
tests do the same with SET LOCAL ROLE + set_config, then run plain SQL - so
they exercise the policies themselves, with no FastAPI service in the way.
Setup happens as the backend's own role, which bypasses RLS.
"""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from uuid import UUID

import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError

from app.schemas.note import NoteCreate
from app.services.note import NoteService


@asynccontextmanager
async def as_client(db, user_id: UUID | None) -> AsyncIterator[None]:
    """Run the block as a REST client: signed in as user_id, or anon if None."""
    role = "authenticated" if user_id else "anon"
    await db.execute(text(f"SET LOCAL ROLE {role}"))
    await db.execute(
        text("SELECT set_config('request.jwt.claim.sub', :sub, true)"),
        {"sub": str(user_id) if user_id else ""},
    )
    try:
        yield
    finally:
        await db.execute(text("RESET ROLE"))
        await db.execute(text("SELECT set_config('request.jwt.claim.sub', '', true)"))


async def _titles(db, sql: str = "SELECT title FROM notes ORDER BY title", **params):
    return [r[0] for r in (await db.execute(text(sql), params)).all()]


@pytest.fixture
async def two_users(db, make_user):
    alice = await make_user(display_name="Alice")
    bob = await make_user(display_name="Bob")
    notes = NoteService(db)
    await notes.create(NoteCreate(title="Alice private"), alice)
    await notes.create(NoteCreate(title="Alice public", is_public=True), alice)
    binned = await notes.create(NoteCreate(title="Alice binned public", is_public=True), alice)
    await notes.delete(binned.id, alice)  # archive
    await notes.create(NoteCreate(title="Bob private"), bob)
    return alice, bob


async def test_same_query_different_rows_by_identity(db, two_users):
    """The 03-SQL-LAYER.md demo: one table, one query, different answers."""
    alice, bob = two_users

    async with as_client(db, alice.id):
        alice_sees = await _titles(db)
    async with as_client(db, bob.id):
        bob_sees = await _titles(db)

    assert alice_sees == ["Alice binned public", "Alice private", "Alice public"]
    # Bob: his own note plus Alice's LIVE public one - not her private or trashed note.
    assert bob_sees == ["Alice public", "Bob private"]


async def test_anon_key_alone_reads_nothing_not_even_public_notes(db, two_users):
    async with as_client(db, None):
        assert await _titles(db) == []
        assert await _titles(db, "SELECT name FROM relationship_types") == []


async def test_cannot_change_or_delete_someone_elses_note(db, two_users):
    alice, bob = two_users

    async with as_client(db, bob.id):
        # Not an error: RLS makes Alice's rows invisible to the UPDATE, so it
        # simply matches nothing - the same as for a row that doesn't exist.
        updated = await db.execute(
            text("UPDATE notes SET title = 'pwned' WHERE title = 'Alice public'")
        )
        deleted = await db.execute(text("DELETE FROM notes WHERE title = 'Alice public'"))

    assert (updated.rowcount, deleted.rowcount) == (0, 0)
    assert "Alice public" in await _titles(db)


async def test_cannot_create_a_note_as_someone_else(db, two_users):
    alice, bob = two_users

    async with as_client(db, bob.id):
        with pytest.raises(DBAPIError, match="row-level security"):
            async with db.begin_nested():
                await db.execute(
                    text("INSERT INTO notes (creator_id, title) VALUES (:a, 'Forged')"),
                    {"a": alice.id},
                )


async def test_cannot_give_your_note_away(db, two_users):
    """UPDATE needs WITH CHECK as well as USING: USING lets Bob target his own
    note, WITH CHECK stops the new row from belonging to Alice."""
    alice, bob = two_users

    async with as_client(db, bob.id):
        with pytest.raises(DBAPIError, match="row-level security"):
            async with db.begin_nested():
                await db.execute(
                    text("UPDATE notes SET creator_id = :a WHERE title = 'Bob private'"),
                    {"a": alice.id},
                )


async def test_editing_your_own_note_still_versions_and_logs_it(db, two_users):
    """The versioning trigger writes note_versions, which clients may not
    write. It only works because the trigger is SECURITY DEFINER."""
    alice, _ = two_users

    async with as_client(db, alice.id):
        await db.execute(
            text("UPDATE notes SET content = '<p>edited via REST</p>' WHERE title = 'Alice private'")
        )
        versions = await _titles(db, "SELECT title FROM note_versions")
        events = await _titles(db, "SELECT metadata ->> 'event' FROM activity_logs ORDER BY id")

    assert versions == ["Alice private"]
    assert events[-1] == "edited"


async def test_audit_tables_are_readable_but_not_writable(db, two_users):
    alice, bob = two_users

    async with as_client(db, bob.id):
        own_logs = await _titles(db, "SELECT DISTINCT user_id::text FROM activity_logs")
        with pytest.raises(DBAPIError, match="row-level security"):
            async with db.begin_nested():
                await db.execute(
                    text(
                        "INSERT INTO activity_logs (user_id, action_type, entity_type) "
                        "VALUES (:b, 'delete', 'note')"
                    ),
                    {"b": bob.id},
                )
        erased = await db.execute(text("DELETE FROM activity_logs"))

    assert own_logs == [str(bob.id)]
    assert erased.rowcount == 0  # no DELETE policy: an audit trail can't be wiped


async def test_note_history_is_private_even_for_public_notes(db, two_users):
    alice, bob = two_users
    await db.execute(text("UPDATE notes SET content = '<p>v2</p>' WHERE title = 'Alice public'"))

    async with as_client(db, bob.id):
        assert await _titles(db, "SELECT title FROM note_versions") == []
    async with as_client(db, alice.id):
        assert await _titles(db, "SELECT title FROM note_versions") == ["Alice public"]


async def test_views_and_functions_inherit_the_callers_rls(db, two_users):
    """security_invoker views (ADR-022) and invoker-rights functions see only
    what the caller could see in the tables themselves."""
    alice, bob = two_users

    async with as_client(db, bob.id):
        dashboard_users = await _titles(db, "SELECT user_id::text FROM v_user_dashboard")
        stats_titles = await _titles(db, "SELECT title FROM v_note_graph_stats ORDER BY title")

    assert dashboard_users == [str(bob.id)]  # users policy: only yourself
    assert stats_titles == ["Alice public", "Bob private"]


async def test_every_table_has_rls_and_every_data_table_a_policy(db):
    """Guards future tables: a new table without RLS - or with RLS but no
    policy, i.e. unusable from the client - fails here."""
    rows = (
        await db.execute(
            text("""
                SELECT c.relname, c.relrowsecurity,
                       (SELECT count(*) FROM pg_policies p
                         WHERE p.schemaname = 'public' AND p.tablename = c.relname) AS policies
                FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
                WHERE ns.nspname = 'public' AND c.relkind = 'r'
            """)
        )
    ).all()

    without_rls = [r.relname for r in rows if not r.relrowsecurity]
    without_policy = [r.relname for r in rows if r.policies == 0]
    assert without_rls == []
    assert without_policy == ["alembic_version"]  # deny-all on purpose
