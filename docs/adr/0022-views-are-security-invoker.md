# ADR-022 — Views are created `WITH (security_invoker = true)`

**Problem.** The four views from 03-SQL-LAYER.md §3.3 (`v_note_graph_stats`,
`v_note_search`, `v_user_dashboard`, `v_orphan_notes`) select from `notes`, `users`,
`knowledge_links` and the other tables. By default PostgreSQL runs a view's query with the
**view owner's** privileges, and row-level security is checked against that owner too.
Here the owner is the migration role, which bypasses RLS.

That matters because of how Supabase exposes the database. PostgREST serves every table
**and view** in the `public` schema at `/rest/v1/<name>`, and the browser holds the
project's anon key ([ADR-008](0008-row-level-security.md)). A default view would therefore
let anyone with that key read the results (note titles, word counts, per-user statistics)
straight past whatever RLS policies protect the underlying tables. A view would become
a hole in the security boundary.

**Alternatives considered.**

- *Put the views in a non-exposed schema.* Works, but every query would need a
  schema-qualified name. It also only hides the views from PostgREST, so the views would
  still bypass RLS for any role that can reach them.
- *`REVOKE SELECT … FROM anon, authenticated` on each view.* Works on Supabase, but those
  roles don't exist in CI or local Docker, so the migration would need conditional SQL.
  It is also opt-out: each future view is open until someone remembers to revoke.

**Chosen.** Every view is created `WITH (security_invoker = true)` (PostgreSQL 15+;
Supabase and the CI image are both newer). The view then runs with the privileges, and
under the RLS policies, of **whoever queries it**. A view can never show a caller more
than the underlying tables would. The backend connects with a role that bypasses RLS, so
the app's own queries are unaffected.

**Trade-offs.** None for this project. Security-definer views exist to deliberately expose
a restricted slice of data that callers can't read directly, and nothing here needs that.

**Verification.** `test_every_view_checks_rls_as_the_caller` reads `pg_class.reloptions`
and asserts `security_invoker=true` on every view in `public`. A view added later without
it fails the test.

**Learning note.** A view feels like a saved query, so it's easy to assume it has the
same permissions as the query would if you ran it yourself. By default it doesn't: it
borrows its creator's identity. Supabase's database linter flags these as
"security definer views" for exactly this reason.
