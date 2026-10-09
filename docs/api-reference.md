# API reference

Every route is served under `/api/v1` and requires a Supabase session token:

```
Authorization: Bearer <Supabase JWT>
```

The backend verifies the token's ES256 signature against Supabase's published JWKS
([ADR-018](adr/0018-jwt-verification-via-jwks.md)). There are no login or signup routes
here: Supabase Auth handles both.

When the backend runs with `ENVIRONMENT` set to anything other than `production`,
interactive OpenAPI docs are served at [`/docs`](http://localhost:8000/docs). They are
generated from the code, so they are always current. This page is the curated overview.

## Errors

Services raise domain exceptions, which are mapped to status codes in one place
(`app/main.py`). Every error body has the same shape: `{"detail": "<message>"}`.

Every response carries an `X-Request-ID` header (a well-formed one sent by the caller is
reused). It is also on each line of the JSON access log, so a reported failure can be
traced. An unexpected server error returns `500` with `{"detail": ..., "request_id": ...}`
and never a stack trace.

| Status | Meaning |
|---|---|
| `401` | Missing, expired, or invalid token |
| `403` | You can read this resource but not change it (e.g. someone else's public note) |
| `404` | Doesn't exist, **or isn't visible to you**. Private resources answer 404 rather than 403, so an id can't be probed for existence |
| `409` | Conflicts with existing data (e.g. a duplicate collection name) |
| `422` | Request validation failed, or a business rule was broken (e.g. permanently deleting a note that isn't in Trash) |
| `429` | Rate limit: 300 requests/minute per client IP by default, and tighter limits on export (5), account deletion (5) and Empty Trash (10). `Retry-After` gives the seconds to wait. See [ADR-024](adr/0024-in-process-rate-limiting.md) |

## Endpoints

### Users

| Method | Path | Notes |
|---|---|---|
| `GET` | `/users/me` | The signed-in user's profile |
| `PATCH` | `/users/me` | Update display name, bio, or avatar URL |
| `GET` | `/users/me/export` | Everything you own as one JSON document (a download), built by a single SQL statement |
| `DELETE` | `/users/me` | Permanently delete the account: the app row (cascading to all your data) and the Supabase login, in one transaction |

### Dashboard

| Method | Path | Notes |
|---|---|---|
| `GET` | `/dashboard` | Totals, most-connected notes, unlinked notes, recent edits — read from database views |

### Workspaces and notebooks

| Method | Path | Notes |
|---|---|---|
| `GET` | `/workspaces` | Your workspaces |
| `POST` | `/workspaces` | Create |
| `GET` | `/workspaces/{id}` | |
| `PATCH` | `/workspaces/{id}` | |
| `DELETE` | `/workspaces/{id}` | Cascades to its notebooks and notes |
| `GET` | `/notebooks?workspace_id=` | |
| `POST` | `/notebooks` | |
| `GET` | `/notebooks/{id}` | |
| `PATCH` | `/notebooks/{id}` | |
| `DELETE` | `/notebooks/{id}` | Its notes become unfiled, not deleted |

### Notes

| Method | Path | Notes |
|---|---|---|
| `GET` | `/notes?notebook_id=&unfiled=&archived=&tag_id=&limit=&offset=` | Your notes; `archived=true` lists Trash, `tag_id` keeps notes carrying that tag. Pages of up to 100 (`limit`, default 50) |
| `GET` | `/notes/search?q=&limit=` | Full-text search over your notes and public ones: ranked and highlighted, with a similar-titles fallback for typos (`fuzzy: true`) |
| `POST` | `/notes` | |
| `GET` | `/notes/{id}` | |
| `PATCH` | `/notes/{id}` | A real title or content change is versioned automatically; `archived: false` restores from Trash |
| `DELETE` | `/notes/{id}` | Moves to Trash |
| `DELETE` | `/notes/{id}/permanent` | Only for a note already in Trash; cascades to everything attached to it |
| `DELETE` | `/notes/trash` | Empty Trash: permanently deletes every note of yours in Trash, in one statement. Returns `{"deleted": n}` |
| `GET` | `/notes/{id}/versions` | Owner only |
| `POST` | `/notes/{id}/versions/{version_num}/rollback` | Restores a version; the restore is itself versioned |
| `GET` | `/notes/{id}/tags` | |
| `POST` | `/notes/{id}/tags/{tag_id}` | Attach; idempotent |
| `DELETE` | `/notes/{id}/tags/{tag_id}` | Detach |

### Knowledge graph

| Method | Path | Notes |
|---|---|---|
| `GET` | `/notes/{id}/links` | Incoming and outgoing links |
| `POST` | `/notes/{id}/links` | From a note you own, to any note you can read ([ADR-007](adr/0007-links-originate-from-owned-notes.md)) |
| `DELETE` | `/notes/{id}/links/{link_id}` | |
| `GET` | `/notes/{id}/graph?max_depth=` | Every note within N hops (1–6), found by breadth-first search ([ADR-021](adr/0021-graph-traversal-is-breadth-first.md)) |
| `GET` | `/notes/{id}/path?to=` | Shortest route between two notes; empty if none |
| `GET` | `/notes/{id}/stats` | Links in and out, version count, distance to the farthest reachable note |
| `GET` | `/relationship-types` | The seeded link vocabulary (*supports*, *contradicts*, …) |

### Tags

| Method | Path | Notes |
|---|---|---|
| `GET` | `/tags` | |
| `POST` | `/tags` | |
| `PATCH` | `/tags/{id}` | |
| `DELETE` | `/tags/{id}` | |

### Collections

| Method | Path | Notes |
|---|---|---|
| `GET` | `/collections` | With item counts |
| `POST` | `/collections` | `409` on a duplicate name |
| `GET` | `/collections/{id}` | With ordered items |
| `PATCH` | `/collections/{id}` | |
| `DELETE` | `/collections/{id}` | The notes themselves are untouched |
| `POST` | `/collections/{id}/items` | Add a note you own; idempotent |
| `DELETE` | `/collections/{id}/items/{note_id}` | |
| `PUT` | `/collections/{id}/items/order` | The full member list, in the new order |

### Flashcards

| Method | Path | Notes |
|---|---|---|
| `GET` | `/flashcards?note_id=` | Cards on one note |
| `GET` | `/flashcards/due?limit=` | Most overdue first |
| `GET` | `/flashcards/summary` | Total, due now, next due |
| `POST` | `/flashcards` | |
| `PATCH` | `/flashcards/{id}` | Rewording keeps the schedule |
| `DELETE` | `/flashcards/{id}` | |
| `POST` | `/flashcards/{id}/review` | `{"quality": 0–5}`; reschedules with SM-2 |

### Activity and notifications

| Method | Path | Notes |
|---|---|---|
| `GET` | `/activity?limit=` | Your timeline; consecutive identical events merged |
| `GET` | `/notifications` | Recent, read and unread |
| `GET` | `/notifications/unread-count` | The bell badge |
| `POST` | `/notifications/{id}/read` | |
| `POST` | `/notifications/read-all` | |
