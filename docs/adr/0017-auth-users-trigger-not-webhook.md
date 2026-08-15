# ADR-017 — `public.users` is synced from `auth.users` by a trigger, not a webhook

**Problem.** `get_current_user` (ADR-013) creates a `public.users` row lazily, on a
user's first authenticated API call. That leaves a real gap: a user who has signed up
in Supabase Auth but never made it past login — because of an unrelated bug, a slow
network, or simply closing the tab — has no row here at all. It also means nothing in
our own data can reference a user until they've made a successful request, which
breaks the moment any feature needs to know about someone before their first API call
(for example, inviting a collaborator by email).

**Alternatives considered.**

- *Supabase Database Webhook (HTTP).* Fires an HTTP POST to a backend endpoint on
  `auth.users` insert. This is the more "decoupled" option on paper, but for a
  solo-dev project running the API on `localhost`, Supabase's webhook delivery has no
  way to reach it — it would need a public tunnel (ngrok or similar) running at all
  times during development purely to receive one webhook. That is ongoing operational
  weight for no real benefit here.
- *Keep it purely lazy.* Simplest, and already implemented. Rejected as the sole
  mechanism for the reason above: it leaves real accounts unrepresented in our schema
  indefinitely if they never complete a first successful request.

**Chosen.** A Postgres trigger, `on_auth_user_created`, fires `AFTER INSERT ON
auth.users` and inserts the matching `public.users` row directly, in the same
database, in the same transaction as the signup — no network hop, nothing external to
keep running. It reads `raw_user_meta_data` for `display_name` / `full_name` / `name`
and `avatar_url`, so an OAuth signup (Google, GitHub) arrives with a real name and
photo already attached, not just a placeholder. `ON CONFLICT (id) DO NOTHING` makes it
safe to coexist with the lazy path in `get_current_user`, which stays as a fallback —
whichever of the two runs first wins, and both build an equivalent row. This is the
same approach Supabase's own docs recommend for keeping a `profiles`-style table in
sync with `auth.users`.

**Trade-offs.** The trigger function needs `SECURITY DEFINER` with a pinned
`search_path`, because the role that writes `auth.users` (`supabase_auth_admin`) has
no privileges on `public.users` — that's a small, deliberate widening of what runs
with elevated rights, scoped to exactly one `INSERT`. This also means our migration
history now creates one object on a schema we do not own (`auth`), which ADR-013
otherwise avoids — accepted here because a trigger is a one-way, best-effort sync, not
a foreign key: dropping it in `downgrade()` costs us nothing structural.

**Learning note.** ADR-013 said "sync, don't reference" for the schema shape. This ADR
is the same principle applied to timing: `public.users` still owns its own data and
never trusts `auth.users` blindly, but *when* the sync happens can move earlier without
weakening that boundary, as long as the mechanism stays inside the database we already
control.
