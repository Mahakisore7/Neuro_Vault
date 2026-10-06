"""row level security policies

Revision ID: c3f81a6d2e57
Revises: b7e2c4f9a031
Create Date: 2026-10-06 15:00:00.000000

"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "c3f81a6d2e57"
down_revision: str | Sequence[str] | None = "b7e2c4f9a031"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Two ways into this database (ADR-008):
#   browser --(anon key / user JWT)--> PostgREST --> PostgreSQL   <- RLS enforces
#   browser --(JWT)--> FastAPI --(postgres, BYPASSRLS)--> PostgreSQL  <- services enforce
# These policies guard the first path: anyone can lift the anon key out of the
# frontend bundle and query the tables directly. The backend is unaffected.
#
# Conventions, applied to every policy:
# - TO authenticated: no policy grants `anon` anything. A visitor without a
#   session reads nothing, not even public notes - the app itself requires
#   sign-in to read them, and the database shouldn't be more open than the app.
# - (select auth.uid()), not bare auth.uid(): wrapped in a scalar subquery the
#   planner evaluates it once per statement (an InitPlan) instead of once per
#   row - Supabase's own recommendation for RLS performance.
# - auth.uid() is NOT defined here. Supabase provides it (and its storage
#   policies depend on it); CI and local Docker get the same function from
#   ci/bootstrap_supabase_stubs.sql. Redefining it here would overwrite the real
#   one on Supabase.
ME = "(select auth.uid())"

# Every table in public. Supabase had already switched RLS on for all of them
# (with no policies, i.e. deny-all); stating it here makes that part of the
# schema, so a database built from these migrations has it too.
TABLES = [
    "users", "workspaces", "notebooks", "notes", "note_versions", "tags", "note_tags",
    "relationship_types", "knowledge_links", "collections", "collection_items",
    "flashcards", "resources", "activity_logs", "notifications",
    # Policy-less on purpose: deny-all for every client role. Only migrations
    # (as postgres) touch it, and PostgREST would otherwise expose it.
    "alembic_version",
]

# A note visible to the current user: their own, or someone's public note that
# isn't in the Trash. The same rule the API's services apply.
VISIBLE_NOTE = f"(n.creator_id = {ME} OR (n.is_public AND NOT n.archived))"

# (policy name, table, command, USING, WITH CHECK)
POLICIES: list[tuple[str, str, str, str | None, str | None]] = [
    # users: yourself only. Rows are created by the auth.users trigger
    # (SECURITY DEFINER), never by a client, so there is no INSERT policy.
    ("users_select_own", "users", "SELECT", f"id = {ME}", None),
    ("users_update_own", "users", "UPDATE", f"id = {ME}", f"id = {ME}"),
    # notes: read your own and live public ones; write only your own.
    (
        "notes_select_visible", "notes", "SELECT",
        f"creator_id = {ME} OR (is_public AND NOT archived)", None,
    ),
    ("notes_insert_own", "notes", "INSERT", None, f"creator_id = {ME}"),
    # USING picks the rows you may target; WITH CHECK what they may become.
    # Without WITH CHECK you could UPDATE creator_id and hand a note to someone.
    ("notes_update_own", "notes", "UPDATE", f"creator_id = {ME}", f"creator_id = {ME}"),
    ("notes_delete_own", "notes", "DELETE", f"creator_id = {ME}", None),
    # note_versions: history of your own notes, read-only. Rows are written by
    # trg_notes_create_version, which this migration makes SECURITY DEFINER.
    (
        "note_versions_select_own", "note_versions", "SELECT",
        # Interpolates only module constants, never input.
        f"EXISTS (SELECT 1 FROM notes n WHERE n.id = note_versions.note_id "  # noqa: S608
        f"AND n.creator_id = {ME})",
        None,
    ),
    # Shared, seeded vocabulary: readable by any signed-in user, writable by none.
    ("relationship_types_select_all", "relationship_types", "SELECT", "true", None),
    # knowledge_links: see links you made, and links pointing at a note you can
    # see (incoming links to your notes). Create/change/delete only your own -
    # and the composite FK already requires the source note to be yours (ADR-007).
    (
        "knowledge_links_select_visible", "knowledge_links", "SELECT",
        f"created_by = {ME} OR EXISTS (SELECT 1 FROM notes n "  # noqa: S608 - constants only
        f"WHERE n.id = knowledge_links.target_note_id AND {VISIBLE_NOTE})",
        None,
    ),
    ("knowledge_links_insert_own", "knowledge_links", "INSERT", None, f"created_by = {ME}"),
    (
        "knowledge_links_update_own", "knowledge_links", "UPDATE",
        f"created_by = {ME}", f"created_by = {ME}",
    ),
    ("knowledge_links_delete_own", "knowledge_links", "DELETE", f"created_by = {ME}", None),
    # Audit tables: read your own. No INSERT/DELETE policy at all - only the
    # SECURITY DEFINER triggers write them, so a client can't forge or erase
    # an audit row. Notifications additionally allow flipping is_read.
    ("activity_logs_select_own", "activity_logs", "SELECT", f"user_id = {ME}", None),
    ("notifications_select_own", "notifications", "SELECT", f"user_id = {ME}", None),
    (
        "notifications_update_own", "notifications", "UPDATE",
        f"user_id = {ME}", f"user_id = {ME}",
    ),
]

# Plain owner-scoped tables: everything on your own rows, nothing on anyone
# else's. FOR ALL covers SELECT/INSERT/UPDATE/DELETE with one rule.
OWNED: list[tuple[str, str]] = [
    ("workspaces", "owner_id"),
    ("notebooks", "owner_id"),
    ("tags", "user_id"),
    ("note_tags", "owner_id"),
    ("collections", "user_id"),
    ("collection_items", "owner_id"),
    ("flashcards", "owner_id"),
    ("resources", "owner_id"),
]
for _table, _col in OWNED:
    POLICIES.append((f"{_table}_all_own", _table, "ALL", f"{_col} = {ME}", f"{_col} = {ME}"))


def upgrade() -> None:
    """Upgrade schema."""
    for table in TABLES:
        op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")

    for name, table, command, using, check in POLICIES:
        sql = f"CREATE POLICY {name} ON {table} FOR {command} TO authenticated"
        if using is not None:
            sql += f" USING ({using})"
        if check is not None:
            sql += f" WITH CHECK ({check})"
        op.execute(sql)

    # The versioning trigger ran with the caller's rights. Under RLS a client's
    # UPDATE of their own note would then fail: the trigger's INSERT into
    # note_versions has no policy allowing it (deliberately - history is not
    # client-writable). SECURITY DEFINER, like the audit triggers, lets the
    # trigger write history while clients still can't. search_path is pinned
    # so the definer-rights function can't be pointed at a look-alike table.
    op.execute(
        "ALTER FUNCTION fn_create_note_version() SECURITY DEFINER "
        "SET search_path = public, pg_temp"
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.execute("ALTER FUNCTION fn_create_note_version() SECURITY INVOKER RESET search_path")
    for name, table, *_ in reversed(POLICIES):
        op.execute(f"DROP POLICY IF EXISTS {name} ON {table}")
    # RLS itself is deliberately left ENABLED: with the policies gone that is
    # deny-all for client roles, which is where Supabase had these tables. A
    # downgrade must never be the thing that opens the tables to the anon key.
