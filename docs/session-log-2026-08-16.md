# Session log — 2026-08-16

What got built, what broke, and why, across one long session covering auth,
a UI/UX pass, the rich-text editor, and three new features (unfiled notes,
note version history, tags). Organized by subsystem, not strict time order —
each section tells its own story: what changed, what bug surfaced, how it
was found, and how it was fixed.

Branches referenced below: `docs/adr-018-jwt-jwks`, `feature/ui-overhaul`,
`feature/rich-text-editor`, `feature/unfiled-notes` (merged via PR #12),
`feature/tags` (merged via PR #14). §11 covers a same-day continuation:
the first three of those sat unmerged long enough to cause a real bug
report, and were consolidated onto `fix/merge-ui-overhaul`.

---

## 1. Auth: syncing Supabase accounts into our own `users` table

**The ask:** Supabase Auth's `auth.users` table is not the app's `users`
table (by design — [ADR-013](adr/0013-users-mirrors-supabase-auth.md)). Two
real accounts had signed up but never appeared in `public.users`.

**Why:** the *only* thing that created a `public.users` row was
`get_current_user` (`backend/app/core/dependencies.py`), lazily, on a
user's first successful authenticated API call. Both real accounts hit an
unrelated bug (§2) on every request, so that first successful call never
happened — they were stuck signed up but unrepresented.

**Decision — trigger, not webhook.** Supabase's HTTP Database Webhooks
would need a public tunnel (ngrok) running at all times just to reach a
`localhost` backend during development, for no real benefit over a
same-database Postgres trigger. Documented as
[ADR-017](adr/0017-auth-users-trigger-not-webhook.md).

**What got built** (migration `20260815_1830_sync_auth_users_via_trigger.py`):
- `handle_new_auth_user()` — a `SECURITY DEFINER` trigger function firing
  `AFTER INSERT ON auth.users`. Reads `raw_user_meta_data` for
  `display_name` / `full_name` / `name` / `avatar_url`, so a Google/GitHub
  signup arrives with a real name and photo, not a placeholder.
- `ON CONFLICT (id) DO NOTHING` — safe to coexist with the lazy fallback in
  `get_current_user`, which stays as a backstop for anything that predates
  the trigger.
- **One-time backfill.** The trigger only fires on *new* inserts. The two
  pre-existing accounts were backfilled once, by hand, with the identical
  mapping logic the trigger uses — not part of the migration, since it's
  data, not schema.

**Also added, same session:** an `avatars` Storage bucket + 4 RLS policies
(public read, owner-scoped insert/update/delete), via
`20260815_1849_provision_avatars_storage_bucket.py`, for the profile page's
avatar upload.

---

## 2. The JWT secret saga → discovering Supabase had moved to JWKS

This was the longest-running thread of the session, and the most
instructive bug. Told in the order it actually unfolded:

1. **Symptom:** every real login still 401'd on `/api/v1/workspaces` etc.,
   even after the backend's `SUPABASE_JWT_SECRET` was set.
2. **First (wrong) diagnosis, from an earlier session:** "the secret is a
   placeholder, get the real one from the dashboard." Reasonable-sounding,
   and wrong — but nothing had actually confirmed the secret mismatched
   Supabase's real value yet.
3. **Confirming it, this session:** walked through Supabase's dashboard —
   Settings → API → JWT Keys → "Legacy JWT Secret" tab — and revealed the
   real value. **It matched the `.env` value byte-for-byte.** The secret
   was never wrong.
4. **So why the 401s?** The dashboard's own banner said it: *"Legacy JWT
   secret... used to **only** verify... the `anon` and `service_role`"*
   keys. That's the tell — it's not used to sign session tokens anymore.
5. **Confirmed independently:** `curl
   https://<project>.supabase.co/auth/v1/.well-known/jwks.json` returned a
   published `ES256` key. Real login tokens are signed asymmetrically now,
   not with the shared HS256 secret at all.
6. **Why the earlier self-signed-token test never caught this:**
   `scripts/make_test_token.py` minted a token with the *same* HS256 secret
   the backend verified with — a test that signs and verifies with the same
   key can prove the verification *logic* works, but can never prove that
   key is the one the real issuer actually uses. Only a token from the real
   issuer can prove that.

**The fix** — [ADR-018](adr/0018-jwt-verification-via-jwks.md), on
`docs/adr-018-jwt-jwks`, code on `main` (already merged, from an earlier
push): `core/security.py` rewritten to use PyJWT's `PyJWKClient`, fetching
and caching Supabase's public signing key, verifying with
`algorithms=["ES256"]` instead of a stored secret. `SUPABASE_JWT_SECRET`
removed from config entirely, replaced by `SUPABASE_URL` (not sensitive —
same value the frontend already exposes as `NEXT_PUBLIC_SUPABASE_URL`).
Added `cryptography` as a dependency (`pyjwt[crypto]`) — pure-Python PyJWT
only implements HS256.

**Casualty:** `scripts/make_test_token.py` was deleted. It can no longer
produce a token that verifies — only Supabase holds the ES256 private key —
and there's no way to repair that without a live Supabase project, which
[ADR-014](adr/0014-direct-supabase-dev-solo.md) already commits this
project to using anyway. Every backend test written after this point had to
go through `NoteService`/`TagService` directly instead of an HTTP-level
test token (see §7, §8).

**The actual lesson** (from the ADR): *a test that signs and verifies with
the same key can never detect that the key itself is wrong for the job.*

---

## 3. OAuth sign-in (Google, GitHub) + profile page

- `frontend/src/components/auth/oauth-buttons.tsx` — Google and GitHub
  buttons on both login and signup, calling
  `supabase.auth.signInWithOAuth({ provider, options: { redirectTo } })`.
- `frontend/src/app/(auth)/auth/callback/page.tsx` — the OAuth redirect
  target. Waits for `supabase-js` to finish the code exchange
  (`detectSessionInUrl: true`, already configured), then routes to
  `/workspaces`; shows a retry state if nothing arrives within 8s.
- Backend: `PATCH /users/me` added (the schema, `UserUpdate`, already
  existed — no endpoint had ever used it).
- Setup that had to happen outside the codebase, walked through
  step-by-step: registering OAuth apps in Google Cloud Console and GitHub
  Developer Settings, both pointing their redirect URI at Supabase's own
  callback (`https://<project>.supabase.co/auth/v1/callback` — **not** the
  frontend), then pasting the resulting client ID/secret into Supabase's
  own provider settings, plus adding `http://localhost:3000/auth/callback`
  to Supabase's redirect-URL allowlist.
- Profile page later gained a "Sign out" action directly on the page
  (previously only reachable from the sidebar corner) — a small, explicitly
  requested addition, not a bug fix.

---

## 4. UI/UX pass (`feature/ui-overhaul` — see §11 for merge status)

Four distinct fixes bundled under one "make it industry-grade" request:

**a. The wrong "Next.js logo."** First request to "remove the Next.js
symbol" was answered by fixing the browser-tab *favicon* — a real bug
(`next/og`'s `ImageResponse` can't parse `oklch()` colors, only hex/rgb/hsl)
but the wrong bug. The actual complaint was Next.js's floating **dev-mode
overlay badge** (bottom-left "N" circle, separate from the favicon
entirely). Fixed with `devIndicators: false` in `next.config.ts`. Also
deleted five unused `create-next-app` boilerplate SVGs still sitting in
`public/`.

**b. Cards: dropdown menu on its own line, and dead-zone clicking.**
Reported as two symptoms ("the three dots aren't top-right" and "I can't
click into the workspace") — these are **two independent defects**, not one
shared root cause (an earlier draft of this log said otherwise; corrected
here). `CardHeader` (shadcn) is a CSS grid that only becomes two-column
(title-left, action-right) when the action button is wrapped in the
library's own `CardAction` slot — the code had the dropdown as a plain
sibling instead, so with no second grid column defined it fell onto its
own row. Separately, only the title text was wrapped in a `Link`, so the
rest of the card's surface had no click handler at all. Fixed by switching
to `CardAction` (workspaces, notebooks, the notebook note list) and, quite
separately, making the whole card clickable via `onClick`/`onKeyDown`
instead of only the title text, with the dropdown trigger calling
`stopPropagation()` so delete/archive still works independently. Full
write-up: [ADR-019](adr/0019-card-action-slot-and-full-row-click.md) —
written later than the fix itself, once the same bug reappeared (§11).

**c. Dark/light theme.** `next-themes` was already an installed dependency,
just never wired up. Added a toggle (top-right of the landing page, the
auth screens, and a new slim topbar in the authenticated app) plus
`ThemeProvider`/`TooltipProvider` in the root layout. The color tokens for
both modes already existed from an earlier design pass — this was mostly
plumbing.

**d. Icon and sidebar polish.** Colored icon chips on workspace/notebook
cards (notebooks use each notebook's own chosen color), icons on sidebar
nav items that were previously bare text.

---

## 5. Rich-text editor toolbar (`feature/rich-text-editor` — see §11 for merge status)

Tiptap was already integrated but had no UI on top of it — it rendered as
an unstyled `contenteditable` div, indistinguishable from a plain textarea.

**Built:**
- A formatting toolbar: bold/italic/underline/strike/highlight/inline code,
  H1–H3, bullet/numbered/task lists, quote, code block, a link popover,
  undo/redo. Uses shadcn's `Toggle` for pressed-state buttons.
- A **bubble menu** (select text → floating format toolbar) — built first,
  then removed.
- A **floating menu** (cursor on an empty line → block-insert buttons) —
  the lighter-weight stand-in for a Notion-style `/` command menu, which
  would need a custom suggestion-popup extension.
- Task lists, highlight marks, a live word/character count.

**What the user changed by hand, mid-session, before I got back to their
feedback:** two things I hadn't yet addressed — "the bubble menu is
disturbing when I highlight text" and "the writing area is too small" —
were fixed directly in the IDE: `editor-bubble-menu.tsx` was deleted along
with its import and usage in `note-editor.tsx`; the editor's padding grew
from `px-1 py-2` / `min-h-96` to `px-6 py-6` / `min-h-[32rem]`, `prose-sm`
became `prose`, and the note detail page's container widened from
`max-w-3xl` to `max-w-4xl`. Discovered mid-commit when
`editor-bubble-menu.tsx` turned out not to exist on disk anymore — the
on-disk state was treated as authoritative, nothing was reverted, and the
now-unused `@tiptap/extension-bubble-menu` package was removed to match.

---

## 6. Unfiled notes (`feature/unfiled-notes`, **merged** — PR #12)

**The gap:** deleting a notebook sets its notes' `notebook_id` to `NULL`
rather than deleting them (`ondelete="SET NULL (notebook_id)"` on the
composite FK in `backend/app/models/note.py`) — the delete confirmation
even says so ("Notes inside become unfiled, not deleted"). But nothing in
the UI could actually find those notes again afterward. Safe in the
database, invisible to the user.

**Backend:** `GET /notes` gained an `unfiled` query flag, separate from
`notebook_id`. `notebook_id=None` already means "don't filter by notebook"
(every note); it can't also mean "only notes with no notebook" (`IS NULL`)
without the two meanings colliding.

**Frontend:** a new "Unfiled" page in the sidebar nav, same
create/open/archive pattern as every other note list. Notes have no
`workspace_id` (only a nullable `notebook_id`), so once unfiled, a note has
no path back to any workspace — this is necessarily an account-wide view,
not a per-workspace one.

---

## 7. Automatic note version history + rollback

The one feature this session that came from an **already-written design**
rather than being invented on the spot — `docs/phases/New/03-SQL-LAYER.md`
had fully specified the trigger and rollback procedure (§T1, §P1) back when
the project's architecture docs were written; nothing had ever implemented
them. `note_versions` was a live table with a unique constraint and an
index plan and zero code writing to it.

**Built, faithfully from that spec:**
- `fn_create_note_version()` — `BEFORE UPDATE ON notes`, snapshots `OLD`
  (not `NEW` — the point is to preserve the state *before* this edit, or
  version 1 would be unreachable) whenever title or content actually
  changed (`IS DISTINCT FROM`, NULL-safe).
- `sp_rollback_note_version(note_id, version_num, actor_id)` — a stored
  procedure, not a function, since it performs a self-contained unit of
  work with no return value. Re-checks ownership itself (defence in depth —
  it can be `CALL`ed from `psql` directly, bypassing the API entirely).
  Restores via an ordinary `UPDATE`, which means **the rollback fires the
  same trigger and gets versioned too** — a rollback is never destructive;
  you can always roll back a rollback.
- `idx_note_versions_note_id_version_num` on `(note_id, version_num DESC)`.

**The bug this testing surfaced:** the very first live test —
create a note, edit it twice, check `note_versions` — failed with
`null value in column "id" of relation "note_versions" violates not-null
constraint`. `NoteVersion.id` had only a **Python-side** default
(`default=uuid4`), which SQLAlchemy applies when *it* builds an `INSERT`.
The trigger's own `INSERT INTO note_versions` runs entirely inside
Postgres, never through SQLAlchemy — so the column arrived empty. Fixed by
adding `server_default=func.gen_random_uuid()` alongside the existing
Python default (both coexist safely: ORM-issued inserts still use the
Python value; the trigger's insert, which omits the column entirely, now
falls back to the server-side one). This is very likely the same gap on
`notes.id`, `workspaces.id`, etc. — just never exercised, because nothing
before this trigger ever inserted into those tables from outside the ORM.

**Verification:** with `scripts/make_test_token.py` gone (§2), tested
through `NoteService` directly — create, edit twice, list versions
(`[2, 1]` in descending order, correct), roll back to version 1, confirm
content restored, confirm the rollback itself created version 3, reject a
rollback to a nonexistent version (`NotFoundError`), reject a rollback
attempted by a different user (`PermissionDeniedError`).

**A second, unrelated bug, hit while wiring the API:** `NoteService` has a
method literally named `list()`. Any method defined *after* it in the same
class body that also annotates a return type as `list[...]` fails at
import time with `TypeError: 'function' object is not subscriptable` —
Python resolves `list` against the class namespace being built, and once
`list` the method exists in it, it shadows the builtin for everything
written afterward in that same class body. `list_versions()` was moved to
sit *above* `list()` instead of being renamed, with a comment explaining
why, so no public method name changed.

**Frontend:** a "History" button on the note detail page, listing versions
with a "Restore" action. Restoring exposed one more gap: Tiptap's `content`
option only seeds the editor once, at creation — it never reacts to prop
changes. Typing already keeps `note.content` in sync via the debounced
autosave, so this had never mattered before; a rollback changes
`note.content` from *outside* the editor, which had no way to notice.
Fixed with an effect that compares `note.content` against
`editor.getHTML()` before calling `setContent()`, so it only actually fires
for an external change, not every render after an ordinary save.

---

## 8. Tags

`Tag` and `NoteTag` models existed with a full constraint set (unique
`(user_id, slug)`, a composite-FK junction table scoped so "tag someone
else's note with your tag" isn't a bug to prevent, it's a row that cannot
be stored) — no API, no UI, ever.

**Built:** `GET/POST /tags`, `PATCH/DELETE /tags/{id}`;
`GET/POST/DELETE /notes/{id}/tags/{tag_id}` for the note association.
Attaching an already-attached tag is treated as a no-op rather than an
error — the composite primary key on `note_tags` would otherwise turn a
double-click into a 500. A Tags page (create with the same color-swatch
picker UX as notebooks, list as colored pills, delete) and a `TagPicker` on
the note detail page (current tags as removable chips, a popover to attach
an existing one — no inline tag creation there on purpose, to avoid
duplicating the Tags page's own form).

**The exact same `list()`-shadowing bug from §7, independently, in a
different class.** `TagService` also has a method named `list()`;
`list_for_note()`, added after it, hit the identical
`TypeError: 'function' object is not subscriptable` at import time. Same
fix — reordered above `list()`, with a comment pointing at the earlier
occurrence.

**Known, deliberate gap, not fixed:** creating a tag with a slug you
already have surfaces as a raw 500 from the database's `UNIQUE` constraint,
not a clean `ConflictError`. Matches `WorkspaceService.create`'s
already-documented, already-accepted state — Stage 3's tracked follow-up,
not something newly introduced for tags.

**Also noticed, not fixed:** `NoteTag`'s two `ForeignKeyConstraint`s carry
explicit `name="note_id_owner_id"` / `name="tag_id_owner_id"`, bypassing
the project's naming-convention template
(`db/base.py`'s `NAMING_CONVENTION["fk"]`) — the same *class* of issue as
[ADR-016](adr/0016-uniqueconstraint-naming.md), but not the same bug:
ADR-016 was about unique *indexes*, which share one schema-wide namespace
in Postgres, so an unprefixed name could collide across tables. Plain FK
constraint names only need to be unique within their own table, so this is
a style inconsistency, not a live defect — left alone to avoid an
unnecessary migration against a table already in production.

---

## 9. Infrastructure and environment

**Direct Postgres blocked on this network.** Applying the very first
migration this session failed with `ConnectionRefusedError`. Diagnosed with
`Test-NetConnection`: ports 5432 *and* 6543 both refused outright, while
443 worked fine — a network-level block (common on campus/office
firewalls that only allow standard web traffic), not a code or credentials
problem. Two resolutions used across the session: switching networks
(mobile hotspot) to run `alembic upgrade head` directly; and, offered as a
fallback that was never actually needed once the network issue turned out
to be transient, running the equivalent SQL by hand through Supabase's own
SQL Editor (which goes over HTTPS from the browser, unaffected by the same
block) followed by manually updating `alembic_version` so a later real
`alembic upgrade head` wouldn't try to redo it and fail on
already-exists.

**A killed dev server that didn't die.** After stopping the frontend's
background task, restarting it reported *"Port 3000 is in use by process
25068"* — the underlying `next dev` (Node) process had survived the task
stop, a known gap on Windows where the process tree isn't always fully
torn down. Found via `Get-NetTCPConnection -LocalPort 3000` /
`Get-Process`, killed directly with `taskkill /PID ... /F`. Happened twice
in the session (once for the frontend, once again later for a second
stray Node process) — same diagnosis and fix both times.

---

## 10. Git / branch state as of end of session

Four branches were cut over the course of this session, three of which were
**still local-only and unmerged**:

| Branch | Status | Contents |
|---|---|---|
| `feature/unfiled-notes` | **merged** (PR #12) | unfiled-notes feature, plus a follow-up commit for note version history's backend (§7) |
| `docs/adr-018-jwt-jwks` | unmerged, local | ADR-018 write-up only (the code was already on `main` from an earlier push) |
| `feature/ui-overhaul` | unmerged, local | §4 |
| `feature/rich-text-editor` | unmerged, local | §5, plus a follow-up commit for note version history's frontend (§7) |
| `feature/tags` | unmerged, local | §8, cut fresh off `main` after it picked up the `feature/unfiled-notes` merge |

**Why note version history is split across two of these branches instead
of living on one:** by the time it was built, `feature/unfiled-notes` and
`feature/rich-text-editor` already existed, unmerged, each already owning
changes to files this feature also needed (`notes.py`/`services/note.py`
on one side, `note-editor.tsx`/the note detail page on the other).
Building it fresh off `main` would have forked those files three ways
instead. Landing each half on the branch that already owned its files was
the smaller cost — the trade-off is that "note version history" doesn't
correspond to exactly one branch in the history.

**Worth doing soon:** merging the three still-local branches. The longer
they sit, the more any *next* feature risks the same fragmentation this
one hit. (This warning turned out to be right — see §11.)

---

## 11. The bug that exposed the orphaned branches — and consolidating them

`feature/tags` and this log's own branch were merged shortly after §10 was
written (PRs #13, #14). `feature/ui-overhaul`, `feature/rich-text-editor`,
and `docs/adr-018-jwt-jwks` were not — and the warning at the end of §10
("worth doing soon") sat unactioned long enough for the consequence to show
up as a live bug report instead of a checklist item.

**What happened.** The user tested the deployed app against `main` and hit
exactly the two symptoms described in §4b — three-dot menu on its own line,
cards not clickable outside the title. Both had already been fixed, once,
weeks earlier. But the fix lived on `feature/ui-overhaul`, which `main`
had never merged. `main`'s actual running code still had the pre-fix
version of every file that branch touched. Fixing a bug on a branch does
not fix the bug anywhere it isn't merged — see the new
[ADR-019](adr/0019-card-action-slot-and-full-row-click.md) for the full
diagnosis of the CSS bug itself, now written up properly since it had to
be re-diagnosed from scratch against `main`.

**Checking whether `feature/ui-overhaul` was alone in this.** Since one
approved, already-built feature had been sitting unmerged, the obvious next
question was whether others were too. It was: `feature/rich-text-editor`
(the formatting toolbar, tooltips, and note version history's frontend from
§5 and §7) was in the exact same state — built, approved, never merged.
Its absence wasn't yet reported as a bug only because nobody had gone
looking for the toolbar specifically; it would have surfaced the moment
someone tried to bold a word.

**The fix: a consolidation branch, not three separate PRs.** Cut
`fix/merge-ui-overhaul` off current `main`, then merged all three orphaned
branches into it in sequence, each as its own merge commit so the history
stays legible about what came from where:

1. `feature/ui-overhaul` — one real conflict, in `sidebar.tsx`: `main` had
   since added a "Tags" nav item on the same line this branch was adding
   icons and an "Unfiled" item to. Resolved by keeping all four items
   (Workspaces, Unfiled, Tags, Profile), all with icons.
2. `feature/rich-text-editor` — two conflicts, both cosmetic import-ordering
   clashes (`types/api.ts` and the note detail page) between this branch's
   version-history types/imports and `main`'s tags work. No actual logic
   overlapped in either file; both additions were kept.
3. `docs/adr-018-jwt-jwks` — no conflicts at all; it only ever touched two
   files that nothing else had since touched.

**Why merge commits instead of rebasing each branch onto `main` first.**
Rebasing would rewrite each branch's commit hashes and require force-pushing
anything already pushed — unnecessary risk for branches that were only
ever local. A straight three-way merge preserves each branch's original
commits exactly as they were, with the merge commit itself as the only new
history, and this repo's own convention (visible throughout §§1–8) is
already "PRs merge with a merge commit," not squash-and-rebase.

**Verification, before handing this off for the user to push and merge:**
`pnpm install` (the rich-text-editor branch's
`@tiptap/*` toolbar dependencies were in `package.json` but not yet in
`node_modules`, since a merge doesn't run install hooks), then
`tsc --noEmit`, `next build`, and `eslint src --max-warnings=0` — all three
clean, and `next build`'s route table confirmed every page (`/tags`,
`/unfiled`, `/notes/[noteId]`, etc.) still compiled.

**State at the end of this: `fix/merge-ui-overhaul` exists locally, three
commits ahead of `main`, not yet pushed** — same handoff pattern as every
other branch this session: built and verified here, pushed and merged by
the user when ready. Once it lands, `feature/ui-overhaul`,
`feature/rich-text-editor`, and `docs/adr-018-jwt-jwks` are fully absorbed
and safe to delete.

*(This claim was wrong in one respect — see §12. `feature/rich-text-editor`
carried the version-history **frontend**, but its **backend** had been
committed separately, after `feature/unfiled-notes` was already merged, and
that trailing commit was still missing. Correcting it here rather than
rewriting this section, since the mistake — and catching it — is itself
part of the record.)*

---

## 12. One more orphan, one layer deeper: a commit stranded on an already-merged branch

Minutes after §11 was written and handed off, the user opened a note's
version history and got a blank dialog plus a global "That wasn't found —
it may have been deleted" toast — the app-wide 404 handler in
`app/providers.tsx`, firing for a query the dialog itself doesn't check
`isError` for, so a failed fetch renders as nothing rather than an error
message.

**Why:** `GET /notes/{id}/versions` didn't exist on `fix/merge-ui-overhaul`
at all. `feature/rich-text-editor` — merged in §11 — only ever held the
version-history **frontend** (`VersionHistoryDialog`, the hooks, the types);
its own commit message said so explicitly: *"the version-history dialog UI
lives on feature/rich-text-editor... [the backend] Landing it here would
fork those files across two branches."* The backend half
(`NoteVersionRepository`, the `list_versions`/`rollback_version` service
methods, the trigger + rollback-procedure migration, the two API routes)
was committed to `feature/unfiled-notes` — but *after* that branch had
already been merged as PR #12. A commit added to a branch post-merge isn't
part of that PR; it just sits there, unpushed, unmerged, easy to miss
because the branch as a whole shows up as "already merged." `git branch -vv`
doesn't distinguish "fully merged" from "merged except for one trailing
commit" — both just look like a branch with nothing new to do.

**Caught by re-running the same check §11 should have run in the first
place:** comparing every session-cut branch against its own `origin/`
counterpart with `git branch -vv`, not just checking whether *a* PR existed
for it. `feature/unfiled-notes` showed `ahead 1` — one local commit
(`a8f1a9e`) its own already-merged remote didn't have.

**Fix:** `git cherry-pick -n a8f1a9e` onto `fix/merge-ui-overhaul` (not a
full-branch merge — everything below that commit was already in `main`).
Two more trivial conflicts, both against this branch's own tags work
(`notes.py`'s route list, `types/api.ts`'s interfaces) — additive on both
sides, nothing overlapped in meaning. The migration itself needed no
changes: its `down_revision` already chained onto the current head, and
`alembic current` against the live database showed the migration was
**already applied** — this backend work had been fully built and tested
against real Postgres before; only the application code around it had
gone missing.

**Verification:** `alembic current` (already at head, confirming no
migration to run), a direct Python import of the notes router listing all
ten registered routes including both `/versions` endpoints, `ruff check`
on every touched backend file, and a repeat of the frontend's `tsc --noEmit`
since `types/api.ts` changed again.

**The actual lesson, on top of §11's:** merging "the branch" isn't the same
as merging "everything that branch's author considered part of the
feature." A feature can span a trailing commit on a *different*, already-
merged branch, invisible to any check that stops at "is this branch merged
— yes/no." The only check that would have caught this the first time is
the one that caught it the second time: diff every session branch against
its own remote, not just against `main`.

---

## What's still open

- The four subsystems with schema but still no API/UI at all: **flashcards**
  (`study.py`), **collections** (`collections`/`collection_items`),
  **knowledge links** (`link.py` + `relationship_types` — the actual graph
  feature), **notifications**.
- **Full-text search** — `Note.search_vector` is a computed, indexed
  `tsvector` column that nothing queries yet.
- **Moving a note between notebooks** — no such action exists anywhere,
  filed or unfiled.
- **Viewing a public note** — `is_public` is a real, working toggle in the
  UI; there's no actual public-facing page that renders one.
- Tag creation's duplicate-slug 500 (§8), matching the same known gap on
  workspaces/notebooks.
- The `NoteTag` FK-naming style inconsistency (§8) — cosmetic, not urgent.
- **`fix/merge-ui-overhaul` (§11, §12) is built, verified, and pushed but
  not yet merged** — merge it. Until that happens, `main` still has both
  card bugs, is still missing the editor toolbar, and version history still
  404s.
- The `fix/merge-ui-overhaul` push itself is one commit behind local as of
  §12's fix — the cherry-picked version-history backend hasn't been pushed
  yet.
- No shared `ListItemCard` component yet (ADR-019's trade-off) — the
  `CardAction` + full-row-click pattern is copied by hand into four files.
  Worth extracting if a fifth list gains a card with a trailing action.
