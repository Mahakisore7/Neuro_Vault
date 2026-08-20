# Viva SQL practice — insert, retrieve, and "show me it enforcing a rule"

Every query below was run against the live NeuroVault database (in a transaction that
was rolled back afterward) before this file was written, so the output shown next to
each one is real, not guessed. Run these in the Supabase SQL Editor, or `psql` against
the same connection string as `DATABASE_URL_SYNC`.

**Before you start:** decide whether you want the rows to stick around afterward.
- **To keep them** (so you can also show the note appearing in the running app): just
  run each block as-is.
- **To leave no trace:** wrap the whole session in
  `BEGIN;` ... `ROLLBACK;` — everything below still runs and returns the same output,
  nothing is kept. A cleanup block is also given at the end either way.

---

## 0. Warm-up — what tables exist

```sql
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
ORDER BY table_name;
```

15 rows: `users`, `workspaces`, `notebooks`, `notes`, `note_versions`,
`relationship_types`, `knowledge_links`, `tags`, `note_tags`, `collections`,
`collection_items`, `flashcards`, `resources`, `activity_logs`, `notifications`.

---

## 1. Insert a user

```sql
INSERT INTO users (id, email, display_name, bio)
VALUES (gen_random_uuid(), 'viva.demo@example.com', 'Viva Demo User',
        'Created live for the mentor demo');
```

**Say out loud while typing this:** `id` has no default at the database level on
purpose — a real signup's `id` has to equal the `sub` claim from a Supabase-issued JWT
(ADR-013), never a value the database invents. `gen_random_uuid()` stands in for that
here. In the real app, this row is written automatically by a trigger the moment
someone signs up — nobody ever runs this `INSERT` by hand.

**Gotcha to know before you type it:** if your mentor asks you to insert a **note**
later (§4), `is_public`, `pinned`, and `archived` are `NOT NULL` with *no* default at
the SQL level — only the app's ORM supplies `false` for them. Leave any of the three out
of a raw `INSERT` and Postgres rejects it:

```
null value in column "is_public" of relation "notes" violates not-null constraint
```

That's not a bug — it's the same shape of thing as the trigger-versus-ORM default gap
covered in ADR territory elsewhere in this project: a default declared in Python only
ever applies to inserts the ORM itself builds.

---

## 2. Insert a workspace

```sql
INSERT INTO workspaces (id, owner_id, name, slug, description)
VALUES (
  gen_random_uuid(),
  (SELECT id FROM users WHERE email = 'viva.demo@example.com'),
  'Semester 5', 'sem-5', 'DBMS coursework'
);
```

**One line worth saying:** `slug` has a `CHECK` constraint —
`slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'` — lowercase, digits, single hyphens between words.
§9 below breaks it on purpose to show what happens.

---

## 3. Insert a notebook

```sql
INSERT INTO notebooks (id, workspace_id, owner_id, name, color)
VALUES (
  gen_random_uuid(),
  (SELECT id FROM workspaces WHERE slug = 'sem-5'),
  (SELECT id FROM users WHERE email = 'viva.demo@example.com'),
  'DBMS', '#4CAF50'
);
```

**Worth pointing at:** `workspace_id` and `owner_id` together are a **composite foreign
key** into `workspaces(id, owner_id)` — not two separate single-column FKs. §8 shows
exactly what that buys you.

---

## 4. Insert a note

```sql
INSERT INTO notes (id, creator_id, notebook_id, title, content, is_public, pinned, archived)
VALUES (
  gen_random_uuid(),
  (SELECT id FROM users WHERE email = 'viva.demo@example.com'),
  (SELECT id FROM notebooks WHERE name = 'DBMS'),
  'Normalization', '<p>1NF, 2NF, 3NF basics</p>',
  false, false, false
);
```

```sql
SELECT id, title, word_count FROM notes WHERE title = 'Normalization';
```

```
title           | word_count
Normalization   | 4
```

**Say this:** `word_count` was never set — it's a `GENERATED ALWAYS ... STORED` column.
Postgres strips the HTML tags out of `content`, counts the words, and stores the result
itself. There is no code path, anywhere in the app, that can write a stale value into
it, because there's no code path that can write to it at all.

---

## 5. Retrieve — the basics

```sql
SELECT id, email, display_name, created_at FROM users ORDER BY created_at;
```

```sql
SELECT * FROM notes WHERE creator_id = (SELECT id FROM users WHERE email = 'viva.demo@example.com');
```

```sql
SELECT title FROM notes WHERE title ILIKE '%normal%';
```

---

## 6. Retrieve — a real JOIN across the hierarchy

```sql
SELECT w.name AS workspace, nb.name AS notebook, n.title AS note, n.word_count
FROM notes n
JOIN notebooks nb ON nb.id = n.notebook_id
JOIN workspaces w ON w.id = nb.workspace_id
WHERE n.creator_id = (SELECT id FROM users WHERE email = 'viva.demo@example.com');
```

```
workspace   | notebook | note          | word_count
Semester 5  | DBMS     | Normalization | 4
```

Three tables, one query, following `notes → notebooks → workspaces` up the hierarchy
the composite foreign keys were built to protect.

---

## 7. Update the note — and watch the trigger fire

```sql
UPDATE notes
SET content = '<p>1NF, 2NF, 3NF, and BCNF</p>'
WHERE title = 'Normalization';
```

```sql
SELECT version_num, title, content
FROM note_versions
WHERE note_id = (SELECT id FROM notes WHERE title = 'Normalization');
```

```
version_num | title         | content
1           | Normalization | <p>1NF, 2NF, 3NF basics</p>
```

**This is the one to slow down on.** Nobody ran an `INSERT INTO note_versions` — that
statement doesn't exist anywhere in the app. `trg_notes_create_version` fires
`BEFORE UPDATE ON notes`, sees the content actually changed
(`IS DISTINCT FROM`, NULL-safe), and writes the row that was about to be overwritten —
*before* it's gone. If your mentor asks "what if two people edit the same note at the
exact same instant?": the `UPDATE` itself already holds a row lock on that note, so the
trigger's `MAX(version_num) + 1` can't race.

---

## 8. Constraint demo — a composite FK rejecting a cross-tenant insert

```sql
INSERT INTO notebooks (id, workspace_id, owner_id, name, color)
VALUES (
  gen_random_uuid(),
  (SELECT id FROM workspaces WHERE slug = 'sem-5'),
  gen_random_uuid(),  -- a user who does NOT own that workspace
  'Hijack attempt', '#000000'
);
```

```
ERROR: insert or update on table "notebooks" violates foreign key constraint
       "workspace_id_owner_id"
```

**The point:** this isn't a bug caught by a validation check somewhere in
`app/services/`. There is no `if notebook.owner != workspace.owner: raise ...` for this
case. The row is rejected because `(workspace_id, owner_id)` together don't exist as a
pair in `workspaces(id, owner_id)` — the same mechanism that made the correct insert in
§3 succeed is what makes this one fail. One rule, both directions.

---

## 9. Constraint demo — a `CHECK` rejecting bad data

```sql
INSERT INTO workspaces (id, owner_id, name, slug)
VALUES (
  gen_random_uuid(),
  (SELECT id FROM users WHERE email = 'viva.demo@example.com'),
  'Bad Slug', 'Not A Valid Slug!'
);
```

```
ERROR: new row for relation "workspaces" violates check constraint
       "ck_workspaces_slug_format"
```

Uppercase letters and a `!` both fail the regex. This one *would* also be caught by the
frontend's form validation — the point of asking your mentor to imagine curling the API
directly, or running this exact `INSERT` from `psql`, is that the database enforces it
regardless of whether any application code runs at all.

---

## 10. "Delete" a note — and why it isn't a real delete

Picking up from the actual product decision (see `docs/adr/`): the API's delete route
never issues a SQL `DELETE`. It archives.

```sql
UPDATE notes SET archived = true WHERE title = 'Normalization';
SELECT id, title, archived FROM notes WHERE title = 'Normalization';
```

```
title         | archived
Normalization | t
```

The row is still there — still joinable, still has all 1 version of history intact.
**If your mentor asks "so show me an actual `DELETE`"**, this is a good moment to
demonstrate cascade behaviour honestly:

```sql
-- Don't run this on the row above unless you mean to lose its history —
-- run it on a disposable row instead, to show what CASCADE really does:
DELETE FROM notes WHERE title = 'Normalization';
-- note_versions rows for this note vanish too: ON DELETE CASCADE.
-- That's the exact reason the API route doesn't do this.
```

---

## 11. Aggregate — GROUP BY

```sql
SELECT nb.name, COUNT(n.id) AS note_count
FROM notebooks nb
LEFT JOIN notes n ON n.notebook_id = nb.id
WHERE nb.owner_id = (SELECT id FROM users WHERE email = 'viva.demo@example.com')
GROUP BY nb.name;
```

```
name | note_count
DBMS | 1
```

`LEFT JOIN`, not `JOIN` — a notebook with zero notes should still show `0`, not
disappear from the results.

---

## Cleanup

If you ran everything without wrapping it in `BEGIN`/`ROLLBACK`, this removes it all in
one statement — `workspaces → notebooks → notes → note_versions` all cascade from the
top:

```sql
DELETE FROM users WHERE email = 'viva.demo@example.com';
```

(`workspaces.owner_id`, `notes.creator_id`, and everything under them are all
`ON DELETE CASCADE` back to `users` — deleting the demo user is enough.)

---

## If asked "what is X" on the spot

Full glossary: [`docs/phases/New/FUNCTIONALITIES-AND-UML.md` §4](phases/New/FUNCTIONALITIES-AND-UML.md).
The two most likely follow-ups from what's above:

- **Composite key** — a key made of two columns together, not one. Used here so a
  foreign key can check "does the parent exist *and* belong to this exact user" as one
  inseparable rule, instead of two.
- **Trigger** — code that runs automatically inside the database itself when a table
  changes, without any application ever calling it.
