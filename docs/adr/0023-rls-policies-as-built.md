# ADR-023 — Row level security policies: four departures from the design

**Context.** [ADR-008](0008-row-level-security.md) makes RLS the boundary for the one path
into the database that skips FastAPI: the browser holds the anon key, and Supabase's REST
API (PostgREST) serves every table in `public`. When the policies were finally migrated
(`20261006_1500_row_level_security_policies.py`), the live Supabase project already had
RLS **enabled on every table with zero policies**. Supabase does that itself for new
tables. So client roles were denied everything, and nothing about it was in our
migrations: a database built from them, like CI or local Docker, had no RLS at all.

The migration now states RLS and the per-user policies explicitly. Building them exposed
four problems in the design sketched in 03-SQL-LAYER.md §3.8.

**1. The design's local `auth.uid()` stand-in would overwrite Supabase's.** The sketch
ran `CREATE OR REPLACE FUNCTION auth.uid()` inside the migration "for local
development". On Supabase that **replaces the platform's own function**. The stand-in
only reads `request.jwt.claim.sub`, while current PostgREST sends the claims as JSON in
`request.jwt.claims`, so every signed-in user would look anonymous to every policy. That
includes the avatar storage policies, which are not ours to break.
*Chosen:* the migration never defines `auth.uid()`. CI and local Docker get it from
`backend/ci/bootstrap_supabase_stubs.sql`, whose body now matches Supabase's (claim
setting first, then the JSON claims). The stub also creates the `anon` and `authenticated`
roles with Supabase's default grants, so the policies can actually be tested.

**2. Under RLS, editing a note would fail.** `note_versions` correctly gets no INSERT
policy, because history must not be client-writable. But `trg_notes_create_version` ran
with the *caller's* rights, so a client's own `UPDATE notes …` would fire it, have the
history insert denied, and abort the update.
*Chosen:* the trigger function becomes `SECURITY DEFINER` with a pinned `search_path`,
the same as the audit triggers (ADR-020). Clients still can't write history; the trigger
can.

**3. Public notes would have been readable without signing in.** The sketch's policies
had no `TO` clause, so they applied to every role, `anon` included. `is_public = TRUE`
would have let anyone on the internet read every public note, including ones in Trash.
*Chosen:* every policy is `TO authenticated`, and the public branch is
`is_public AND NOT archived`. The database is now exactly as open as the app: sign in to
read public notes, and Trash is private.

**4. A downgrade must not open the tables.** A symmetric downgrade would
`DISABLE ROW LEVEL SECURITY`, and on Supabase, where `anon` and `authenticated` have table
privileges, that would expose everything.
*Chosen:* the downgrade drops the policies and leaves RLS enabled, which is deny-all,
the state Supabase had these tables in.

**Also:** every policy calls `(select auth.uid())` rather than bare `auth.uid()`. As a
scalar subquery it is evaluated once per statement (an InitPlan), not once per row; that
is Supabase's documented RLS performance pattern. `alembic_version` gets RLS with no
policy, so it is deny-all for clients and never exposed by PostgREST.

**Verification.** `app/tests/test_row_level_security.py` impersonates clients the way
PostgREST does (`SET LOCAL ROLE authenticated`, `request.jwt.claim.sub`). It runs ten
tests:
- One query returns different rows for different users.
- `anon` reads nothing.
- You can't update or delete another user's note, create a note as them, or give your
  own note away.
- Editing your own note still writes its version and activity row.
- Audit rows are readable but can't be forged or erased.
- History stays private even for public notes.
- Views and functions apply the caller's RLS.
- A catalog check finds no table without RLS, and none without a policy except
  `alembic_version`.

Removing the policies makes 7 of the 10 fail. Making the trigger invoker-rights again
makes the edit test fail.

**Learning note.** "RLS is on" and "RLS is configured" are different states. With RLS on
and no policies, a table is safe but unusable from the client. With policies but no
`TO` clause, a public-read rule quietly includes the unauthenticated role. And any
trigger that writes to an RLS-protected table is subject to those policies unless it is
`SECURITY DEFINER`.
