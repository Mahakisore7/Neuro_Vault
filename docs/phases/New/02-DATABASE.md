# Phase 2 — Database Schema

**Goal:** 15 tables that make invalid data *impossible to store*, not merely unlikely.

**Time:** ~5 hours · **Prerequisite:** [`01-FOUNDATION.md`](01-FOUNDATION.md)

**Done when:**

```
alembic upgrade head    → 15 tables + alembic_version on a clean database
alembic downgrade base  → removes all of them, cleanly
uv run python -m scripts.seed → a demo graph you can query
```

This is the phase your grade depends on most. Everything after it is engineering;
this is the DBMS course.

---

## 2.1 How to read this phase

Every table below answers five questions, and you should be able to answer all five
out loud for any of them:

1. **Why does this table exist?** (What entity or relationship does it represent?)
2. **What is its primary key, and why that one?**
3. **What can it never contain?** (Which constraints enforce that?)
4. **What normal form is it in, and how do you prove it?**
5. **Where does it deliberately break a rule, and what did that buy?**

The last question is the one that separates a memorised answer from an understood one.
Every real schema violates textbook normalization somewhere. Knowing *where* and being
able to defend *why* is the whole skill.

---

## 2.2 The entity–relationship model

> Rendered version with full attribute lists, keys, and delete-behaviour annotations:
> [`SCHEMA-DIAGRAMS.md`](SCHEMA-DIAGRAMS.md) §1. This ASCII sketch is the one to redraw
> from memory in a viva; the Mermaid version is the one to project on a screen.

```
                    ┌─────────┐
                    │  users  │  id = Supabase `sub` claim (ADR-013)
                    └────┬────┘
                         │ 1:N
              ┌──────────┼──────────┬──────────────┐
              │          │          │              │
        ┌─────▼─────┐    │     ┌────▼───┐   ┌──────▼──────┐
        │workspaces │    │     │  tags  │   │ collections │
        └─────┬─────┘    │     └────┬───┘   └──────┬──────┘
              │ 1:N      │          │              │
        ┌─────▼─────┐    │          │              │
        │ notebooks │    │          │              │
        └─────┬─────┘    │          │              │
              │ 1:N      │ 1:N      │ M:N          │ M:N
              │          │          │              │
        ┌─────▼──────────▼──────────▼──────────────▼─────┐
        │                    notes                        │ ← the centre
        └──┬──────────┬──────────┬──────────┬────────────┘
           │ 1:N      │ 1:N      │ 1:N      │  M:N (self-referencing)
    ┌──────▼─────┐ ┌──▼───────┐ ┌▼─────────┐ │
    │note_       │ │flashcards│ │resources │ │
    │versions    │ └──────────┘ └──────────┘ │
    └────────────┘                            │
                              ┌───────────────▼───────────────┐
                              │      knowledge_links          │  THE GRAPH
                              │  source_note_id → notes.id    │
                              │  target_note_id → notes.id    │
                              │  rel_type_id → relationship_  │
                              └───────────────────────────────┘  types

    AUDIT (written by triggers, never by the application):
        activity_logs   users 1:N
        notifications   users 1:N
```

**The one structure that matters most:** `knowledge_links` is a *self-referencing
many-to-many* relationship on `notes`. Two foreign keys, both pointing back at the same
table. That single design choice is what makes this a knowledge **graph** rather than a
notes app, and it is what `WITH RECURSIVE` traverses in Phase 3.

> **Viva question:** *What is a self-referencing many-to-many relationship?*
>
> "A many-to-many relationship where both sides are the same entity. A note can link to
> many notes, and be linked from many notes. Like any M:N it needs a junction table —
> the difference is that both of its foreign keys reference `notes`. That also means the
> relationship can carry its own attributes: ours has a type, a strength, and a
> description, which a plain M:N junction would not need."

---

## 2.3 Three principles this schema is built on

Before the tables, the three ideas that recur. Understand these and the 15 tables
follow naturally.

### Principle 1 — Composite foreign keys carry tenancy

**The problem.** In a multi-user system, "put *my* note into *your* notebook" must be
impossible. The obvious approach is a service-layer check:

```python
notebook = await repo.get(notebook_id)
if notebook.owner_id != user.id:
    raise HTTPException(403)
```

That works until someone writes a second code path. Then a third. Then a background
job, a seed script, an admin tool, a bulk import. **Every one of them must remember.**
One that forgets is a cross-tenant data leak, and nothing in the database objects.

**The fix.** Carry the owner down the hierarchy and make the foreign key composite:

```sql
-- notebooks declares a unique pair to be referenced
CONSTRAINT uq_notebooks_id_owner UNIQUE (id, owner_id)

-- notes references the pair, not just the id
CONSTRAINT fk_notes_notebook FOREIGN KEY (notebook_id, creator_id)
    REFERENCES notebooks (id, owner_id)
```

Now `INSERT INTO notes (creator_id, notebook_id) VALUES (alice, bobs_notebook)` asks
PostgreSQL to find a `notebooks` row where `id = bobs_notebook AND owner_id = alice`.
No such row exists. The insert fails with a foreign key violation.

**It is no longer possible to write that bug.** Not in a route, not in a script, not in
`psql` at 2 a.m. That is the difference between a rule you document and a rule you
enforce.

> **Viva question:** *Why is `creator_id` on `notes` when you could join through
> `notebooks` to find the owner?*
>
> "Two reasons. First, `notebook_id` is nullable — a note can exist outside any
> notebook — so there is not always a path to join through. Second, and more
> importantly, having `creator_id` on the row is what lets the foreign key to
> `notebooks` be composite. The database compares the two owner columns itself, which
> makes a cross-tenant write structurally impossible rather than merely forbidden.
> It is a deliberate, controlled redundancy: I am storing the owner twice and paying
> for it with a constraint that guarantees the two copies agree."

That last sentence is the answer to the follow-up your examiner is *actually* waiting
for, which is "isn't that denormalized?" — covered properly in §2.9.

### Principle 2 — Derived data is computed by the database

`word_count` and `search_vector` are functions of `content`. Three ways to keep them
correct:

| Approach | Fails when |
|---|---|
| Compute in Python before insert | Anyone writes via `psql`, the seed script, or a second service |
| A `BEFORE INSERT OR UPDATE` trigger | Never fails, but is ~15 lines of PL/pgSQL per column plus a `downgrade()` |
| `GENERATED ALWAYS AS (...) STORED` | Never — the column cannot be written directly |

We use generated columns. One declaration, correct on every write path forever, and
the column is *physically stored* so reads cost nothing extra.

```sql
word_count INTEGER GENERATED ALWAYS AS (...) STORED
```

**The catch, and it is the interesting part:** every function in a generated-column
expression must be `IMMUTABLE` — same inputs, same output, forever. PostgreSQL enforces
this because the stored value is only recomputed on write; if the function's result
could change, the column would silently go stale.

This is why the expression uses `to_tsvector('english', ...)` with the config named
explicitly. The single-argument `to_tsvector(text)` reads the
`default_text_search_config` session setting, which makes it **`STABLE`, not
`IMMUTABLE`** — and PostgreSQL rejects it in a generated column. Naming the
configuration removes the dependency on session state.

> **Viva question:** *What does IMMUTABLE mean and why does PostgreSQL demand it here?*
>
> "It is a promise that the function returns the same output for the same input every
> time — no reads of tables, no session settings, no clock. A stored generated column
> is computed once at write time, so if the function's result could change afterwards
> the stored value would be silently wrong. `now()` is `VOLATILE`, one-argument
> `to_tsvector` is `STABLE` because it reads a session setting, and both are rejected.
> `IMMUTABLE` is also what lets PostgreSQL use a function in an index expression, for
> exactly the same reason."

### Principle 3 — Every application rule has a database constraint

Pydantic validates `strength` is 1–10. So does a `CHECK`. That is not duplication:

- **Pydantic** produces a good error message for the user: field name, constraint, value.
- **`CHECK`** guarantees correctness against `psql`, the seed script, a migration, a
  future mobile client, and any code path that has not been written yet.

They serve different purposes at different boundaries. Drop the Pydantic layer and users
get opaque 500s from constraint violations. Drop the `CHECK` and the guarantee is only
as good as the least careful writer.

---

## 2.4 The tables

### Group A — Identity and hierarchy

```sql
-- ─── users ────────────────────────────────────────────────────────────────────
-- A local mirror of Supabase Auth. See ADR-013.
CREATE TABLE users (
    id            UUID         PRIMARY KEY,   -- ← NO DEFAULT. This is the JWT `sub`.
    email         CITEXT       NOT NULL UNIQUE,
    display_name  VARCHAR(100) NOT NULL,
    avatar_url    TEXT,
    bio           TEXT,
    last_seen_at  TIMESTAMPTZ,
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT ck_users_display_name_not_blank CHECK (btrim(display_name) <> '')
);

-- ─── workspaces ───────────────────────────────────────────────────────────────
-- Top-level container. "Semester 5", "Research", "Personal".
CREATE TABLE workspaces (
    id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id    UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name        VARCHAR(255) NOT NULL,
    slug        VARCHAR(100) NOT NULL,
    description TEXT,
    icon        VARCHAR(50),
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),

    CONSTRAINT uq_workspaces_owner_id_slug UNIQUE (owner_id, slug),
    CONSTRAINT uq_workspaces_id_owner_id   UNIQUE (id, owner_id),   -- composite FK target
    CONSTRAINT ck_workspaces_slug_format CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$')
);

-- ─── notebooks ────────────────────────────────────────────────────────────────
-- Second level. owner_id is carried down so the FK below can be composite.
CREATE TABLE notebooks (
    id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID         NOT NULL,
    owner_id     UUID         NOT NULL,      -- denormalized on purpose — Principle 1
    name         VARCHAR(255) NOT NULL,
    description  TEXT,
    color        CHAR(7)      NOT NULL DEFAULT '#4CAF50',
    created_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),

    CONSTRAINT fk_notebooks_workspace_id_owner_id
        FOREIGN KEY (workspace_id, owner_id)
        REFERENCES workspaces (id, owner_id) ON DELETE CASCADE,
    CONSTRAINT uq_notebooks_id_owner_id       UNIQUE (id, owner_id),
    CONSTRAINT uq_notebooks_workspace_id_name UNIQUE (workspace_id, name),
    CONSTRAINT ck_notebooks_color_format CHECK (color ~ '^#[0-9A-Fa-f]{6}$')
);
```

**`CITEXT` for email.** Case-insensitive text. `Alice@example.com` and
`alice@example.com` are the same string to both `=` and the `UNIQUE` constraint.
The alternative — `UNIQUE (lower(email))` as a functional index — works but requires
every query to remember `lower()`. `CITEXT` makes the *type* carry the semantics, so
it is impossible to forget. Requires `CREATE EXTENSION citext`.

**No direct FK from `notebooks.owner_id` to `users.id`.** It does not need one. The
composite FK to `workspaces (id, owner_id)` already guarantees `notebooks.owner_id`
equals some `workspaces.owner_id`, which is itself a valid user. Adding a second FK
would be redundant, and — usefully — it also avoids an ambiguity in the ORM about which
relationship owns the column.

**`slug` with a format `CHECK`.** Slugs appear in URLs. Constraining the character set
in the database means no code path can create a workspace whose URL is broken.

### Group B — Notes, the centre of the schema

```sql
CREATE TABLE notes (
    id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    creator_id  UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    notebook_id UUID,                        -- nullable: a note can be unfiled
    title       VARCHAR(255) NOT NULL,
    content     TEXT,
    is_public   BOOLEAN      NOT NULL DEFAULT FALSE,
    pinned      BOOLEAN      NOT NULL DEFAULT FALSE,
    archived    BOOLEAN      NOT NULL DEFAULT FALSE,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),

    -- Derived, maintained by PostgreSQL, unwritable by any client. Principle 2.
    word_count INTEGER GENERATED ALWAYS AS (
        CASE
            WHEN btrim(regexp_replace(COALESCE(content, ''), '<[^>]+>', ' ', 'g')) = ''
            THEN 0
            ELSE array_length(
                regexp_split_to_array(
                    btrim(regexp_replace(COALESCE(content, ''), '<[^>]+>', ' ', 'g')),
                    '\s+'
                ), 1)
        END
    ) STORED,

    search_vector tsvector GENERATED ALWAYS AS (
        setweight(to_tsvector('english', COALESCE(title, '')), 'A') ||
        setweight(to_tsvector('english',
            COALESCE(regexp_replace(content, '<[^>]+>', ' ', 'g'), '')), 'B')
    ) STORED,

    -- Composite FK: tenancy enforced by the database. Principle 1.
    -- The column list on SET NULL is PostgreSQL 15+ and is essential — see below.
    CONSTRAINT fk_notes_notebook_id_creator_id
        FOREIGN KEY (notebook_id, creator_id)
        REFERENCES notebooks (id, owner_id) ON DELETE SET NULL (notebook_id),

    CONSTRAINT uq_notes_id_creator_id UNIQUE (id, creator_id),   -- composite FK target
    CONSTRAINT ck_notes_title_not_blank CHECK (btrim(title) <> '')
);
```

**`ON DELETE SET NULL (notebook_id)` — read that column list carefully.** It is the
single most subtle line in the schema.

Deleting a notebook should orphan its notes, not destroy them. `ON DELETE SET NULL`
does that — but on a *composite* foreign key, plain `SET NULL` nulls **every column in
the constraint**, which here means `notebook_id` *and* `creator_id`. `creator_id` is
`NOT NULL`. The delete fails with a not-null violation, and the failure only appears the
first time a user deletes a notebook that contains notes.

PostgreSQL 15 added the column list so you can name which columns to null. Without it,
the choices are `ON DELETE CASCADE` (deleting a notebook silently destroys the user's
notes — unacceptable) or `RESTRICT` (notebooks with notes can never be deleted).

> **Viva question:** *Why does the SET NULL name a column?*
>
> "Because the constraint spans two columns. Plain `SET NULL` on a composite foreign key
> nulls all of them, and `creator_id` is `NOT NULL`, so deleting a notebook would raise
> a not-null violation instead of orphaning the notes. PostgreSQL 15 added the column
> list precisely for this case. It is a good example of a feature that only exists
> because composite foreign keys make the naive behaviour wrong."

**`archived` and `pinned` as booleans, not a `status` enum.** They are independent —
a note can be both. One enum column would have to enumerate the product of the states.

**Stripping HTML in both generated expressions.** Tiptap stores HTML. Without
`regexp_replace(content, '<[^>]+>', ' ', 'g')`, searching for "strong" would match every
note containing bold text, and `word_count` would count `<p>` as a word. The regex is
deliberately crude — it is not an HTML parser and does not need to be, because the input
is Tiptap's own well-formed output, not arbitrary user HTML.

```sql
-- ─── note_versions ────────────────────────────────────────────────────────────
-- Append-only history. Written by a trigger (Phase 3), never by the application.
CREATE TABLE note_versions (
    id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    note_id      UUID         NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
    version_num  INTEGER      NOT NULL,
    title        VARCHAR(255) NOT NULL,
    content      TEXT,
    edited_by    UUID         REFERENCES users(id) ON DELETE SET NULL,
    change_note  VARCHAR(255),
    created_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),

    CONSTRAINT uq_note_versions_note_id_version_num UNIQUE (note_id, version_num),
    CONSTRAINT ck_note_versions_version_num_positive CHECK (version_num > 0)
);
```

**`UNIQUE (note_id, version_num)`** makes it impossible for one note to have two
version 3s. The trigger computes `MAX(version_num) + 1`; this constraint is the backstop
that guarantees the result even if the trigger is ever rewritten carelessly.

**`edited_by` is `ON DELETE SET NULL`, not `CASCADE`.** A deleted user must not erase
the history of notes they edited. The version row survives with a null author, which is
what an audit trail is for.

### Group C — The graph

```sql
-- ─── relationship_types ───────────────────────────────────────────────────────
-- Lookup table. Seven seeded rows. Why a table and not an enum: see below.
CREATE TABLE relationship_types (
    id           SMALLINT    GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name         VARCHAR(50) NOT NULL UNIQUE,
    description  TEXT,
    color        CHAR(7)     NOT NULL DEFAULT '#888888',
    is_symmetric BOOLEAN     NOT NULL DEFAULT FALSE,

    CONSTRAINT ck_relationship_types_color_format CHECK (color ~ '^#[0-9A-Fa-f]{6}$')
);

-- ─── knowledge_links ──────────────────────────────────────────────────────────
-- THE GRAPH. A self-referencing M:N junction carrying its own attributes.
CREATE TABLE knowledge_links (
    id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    source_note_id UUID        NOT NULL,
    target_note_id UUID        NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
    rel_type_id    SMALLINT    NOT NULL REFERENCES relationship_types(id) ON DELETE RESTRICT,
    created_by     UUID        NOT NULL,
    strength       SMALLINT    NOT NULL DEFAULT 5,
    description    TEXT,
    -- How this edge came to exist. Determines who is allowed to delete it.
    origin         VARCHAR(10) NOT NULL DEFAULT 'manual',
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- ADR-007: an edge may only originate from a note you own.
    CONSTRAINT fk_knowledge_links_source_note_id_created_by
        FOREIGN KEY (source_note_id, created_by)
        REFERENCES notes (id, creator_id) ON DELETE CASCADE,

    CONSTRAINT uq_knowledge_links_source_note_id_target_note_id_rel_type_id
        UNIQUE (source_note_id, target_note_id, rel_type_id),
    CONSTRAINT ck_knowledge_links_no_self_link CHECK (source_note_id <> target_note_id),
    CONSTRAINT ck_knowledge_links_strength_range CHECK (strength BETWEEN 1 AND 10),
    CONSTRAINT ck_knowledge_links_origin CHECK (origin IN ('manual', 'wiki', 'ai'))
);
```

*(The index that serves `origin`-filtered lookups is listed with the other nine in
[`03-SQL-LAYER.md`](03-SQL-LAYER.md) §3.2, alongside the rest of the schema's indexes —
one place to look for all ten, not indexes scattered across two documents.)*

**`origin` is what makes automatic linking safe.** Notes support `[[wiki-link]]` syntax:
typing `[[BCNF]]` in a note's body creates an edge to the note titled "BCNF". On every
save the application recomputes the set of `[[...]]` targets and reconciles the graph.

Without `origin`, that reconciliation is destructive. Deleting `[[BCNF]]` from your text
would remove *any* edge to BCNF — including one you created by hand, gave a relationship
type, and set a strength on. **The reconciler must only ever touch rows it created**, so
the row has to record who created it. Rows with `origin = 'manual'` are invisible to it,
and `'ai'` is reserved for [FI-2](09-ROADMAP.md) so suggested edges get the same
protection for free.

> **Viva question:** *Why store how a row was created?*
>
> "Because two different processes write to this table with different authority. The
> wiki-link reconciler runs on every save and computes a whole desired set, so it deletes
> edges that are no longer in the text. If it could not distinguish its own rows from
> hand-made ones, it would delete a user's deliberate work as a side effect of them
> editing a sentence. Recording provenance turns 'delete everything not in this set' into
> 'delete everything not in this set *that I own*', which is the difference between a
> destructive operation and a safe one."

**Why `relationship_types` is a table, not a PostgreSQL `ENUM`.** Three reasons, and
this is a classic exam question:

1. **Attributes.** Each type carries a colour for the graph canvas and an
   `is_symmetric` flag. An enum is a bare label — there is nowhere to put those.
2. **Modification cost.** Adding an enum value is `ALTER TYPE ... ADD VALUE`, which
   cannot run inside a transaction block in older PostgreSQL and cannot be removed at
   all. Adding a row is an `INSERT`.
3. **Referential integrity.** `ON DELETE RESTRICT` means a type in use cannot be
   deleted. An enum offers no equivalent protection.

`SMALLINT` because seven rows will never approach 32,767, and the column is repeated in
every edge row — where a 2-byte key against a 4-byte one is a real saving at scale.

**The asymmetry between the two foreign keys is the security model.** Look carefully:

- `source_note_id` uses a **composite** FK including `created_by` → you may only draw an
  edge *out of* a note you own.
- `target_note_id` is a **plain** FK → you may point at any note, including someone
  else's public note.

That is [ADR-007](../../adr/0007-links-originate-from-owned-notes.md) expressed as DDL, and it is what makes the
notification trigger coherent: when someone links to *your* public note, you get
notified, and the database guarantees they could not have done it in reverse.

**`CHECK (source_note_id <> target_note_id)`** blocks self-loops. Without it, the
recursive CTE in Phase 3 would find a one-node cycle immediately.

**`UNIQUE (source, target, rel_type)`, not `UNIQUE (source, target)`.** Note A may
"reference" *and* "contradict" note B. Those are different edges. Making the type part
of the key permits that while still preventing exact duplicates.

> **Viva question:** *Your graph is directed. How do you find everything connected to a
> note regardless of direction?*
>
> "The recursive CTE unions both directions at each step — it follows edges where the
> current node is the source, and edges where it is the target. The `is_symmetric` flag
> on the relationship type tells the UI whether to draw an arrowhead. Storage is
> directed because 'A contradicts B' and 'B contradicts A' are genuinely different
> claims; traversal is undirected because connection is what the user cares about."

### Group D — Classification and grouping

```sql
-- ─── tags ─────────────────────────────────────────────────────────────────────
CREATE TABLE tags (
    id      INTEGER     GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name    VARCHAR(50) NOT NULL,
    slug    VARCHAR(50) NOT NULL,
    color   CHAR(7)     NOT NULL DEFAULT '#6366F1',

    CONSTRAINT uq_tags_user_id_slug UNIQUE (user_id, slug),
    CONSTRAINT uq_tags_id_user_id   UNIQUE (id, user_id),        -- composite FK target
    CONSTRAINT ck_tags_slug_format  CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
    CONSTRAINT ck_tags_color_format CHECK (color ~ '^#[0-9A-Fa-f]{6}$')
);

-- ─── note_tags ────────────────────────────────────────────────────────────────
-- M:N junction. owner_id carried so BOTH sides are tenancy-checked.
CREATE TABLE note_tags (
    note_id  UUID    NOT NULL,
    tag_id   INTEGER NOT NULL,
    owner_id UUID    NOT NULL,

    PRIMARY KEY (note_id, tag_id),
    CONSTRAINT fk_note_tags_note_id_owner_id
        FOREIGN KEY (note_id, owner_id) REFERENCES notes (id, creator_id) ON DELETE CASCADE,
    CONSTRAINT fk_note_tags_tag_id_owner_id
        FOREIGN KEY (tag_id, owner_id)  REFERENCES tags  (id, user_id)    ON DELETE CASCADE
);

-- ─── collections ──────────────────────────────────────────────────────────────
-- Manually curated, ordered sets of notes. "Exam revision", "To read".
CREATE TABLE collections (
    id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name        VARCHAR(255) NOT NULL,
    description TEXT,
    is_public   BOOLEAN      NOT NULL DEFAULT FALSE,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),

    CONSTRAINT uq_collections_user_id_name UNIQUE (user_id, name),
    CONSTRAINT uq_collections_id_user_id   UNIQUE (id, user_id)
);

-- ─── collection_items ─────────────────────────────────────────────────────────
CREATE TABLE collection_items (
    collection_id UUID        NOT NULL,
    note_id       UUID        NOT NULL,
    owner_id      UUID        NOT NULL,
    position      INTEGER     NOT NULL DEFAULT 0,
    added_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

    PRIMARY KEY (collection_id, note_id),
    CONSTRAINT fk_collection_items_collection_id_owner_id
        FOREIGN KEY (collection_id, owner_id)
        REFERENCES collections (id, user_id) ON DELETE CASCADE,
    CONSTRAINT fk_collection_items_note_id_owner_id
        FOREIGN KEY (note_id, owner_id)
        REFERENCES notes (id, creator_id) ON DELETE CASCADE,
    CONSTRAINT ck_collection_items_position_non_negative CHECK (position >= 0)
);
```

**`note_tags` is the schema's best single example of Principle 1.** The `owner_id`
column appears once and is referenced by *both* foreign keys. For a row to exist,
PostgreSQL must find a note owned by `owner_id` **and** a tag owned by the same
`owner_id`. Tagging your note with someone else's tag is not a bug to prevent — it is a
row that cannot be stored.

**The composite primary key `(note_id, tag_id)`** is the natural key: a note either has
a tag or it does not. A surrogate `id` here would add a column, an index, and the
possibility of duplicate pairs.

**`tags.id` is `INTEGER IDENTITY`, not `UUID`.** Tags are dense, per-user, and never
exposed in a URL that must be unguessable. A 4-byte key in a junction table indexed
twice beats a 16-byte one. `notes.id` is a UUID because it *does* appear in URLs and
must not be enumerable.

> **Viva question:** *Why UUID for notes but INTEGER for tags?*
>
> "It is a per-table decision, not a house style. UUIDs are 16 bytes and randomly
> ordered, which fragments B-tree index inserts, but they are unguessable and can be
> generated client-side without a round trip. Note IDs appear in shareable URLs, so
> enumerability is a real risk. Tag IDs never leave the API, are dense, and are stored
> in a junction table where the key size is repeated — so the smaller sequential integer
> wins there."

### Group E — Study aids

```sql
-- ─── flashcards ───────────────────────────────────────────────────────────────
-- Spaced repetition, SM-2 style scheduling fields.
CREATE TABLE flashcards (
    id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    note_id        UUID        NOT NULL,
    owner_id       UUID        NOT NULL,
    question       TEXT        NOT NULL,
    answer         TEXT        NOT NULL,
    ease_factor    NUMERIC(4,2) NOT NULL DEFAULT 2.50,
    interval_days  INTEGER     NOT NULL DEFAULT 1,
    repetitions    INTEGER     NOT NULL DEFAULT 0,
    due_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_result    SMALLINT,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT fk_flashcards_note_id_owner_id
        FOREIGN KEY (note_id, owner_id) REFERENCES notes (id, creator_id) ON DELETE CASCADE,
    CONSTRAINT ck_flashcards_question_not_blank CHECK (btrim(question) <> ''),
    CONSTRAINT ck_flashcards_answer_not_blank   CHECK (btrim(answer)   <> ''),
    CONSTRAINT ck_flashcards_ease_factor_range  CHECK (ease_factor BETWEEN 1.30 AND 2.50),
    CONSTRAINT ck_flashcards_interval_positive  CHECK (interval_days >= 1),
    CONSTRAINT ck_flashcards_repetitions_non_negative CHECK (repetitions >= 0),
    CONSTRAINT ck_flashcards_last_result_range  CHECK (last_result BETWEEN 0 AND 5)
);

-- ─── resources ────────────────────────────────────────────────────────────────
CREATE TABLE resources (
    id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    note_id       UUID         NOT NULL,
    owner_id      UUID         NOT NULL,
    resource_type VARCHAR(20)  NOT NULL,
    title         VARCHAR(255) NOT NULL,
    url           TEXT         NOT NULL,
    file_size     BIGINT,
    mime_type     VARCHAR(100),
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),

    CONSTRAINT fk_resources_note_id_owner_id
        FOREIGN KEY (note_id, owner_id) REFERENCES notes (id, creator_id) ON DELETE CASCADE,
    CONSTRAINT ck_resources_type_allowed
        CHECK (resource_type IN ('pdf', 'link', 'video', 'image', 'audio')),
    CONSTRAINT ck_resources_file_size_non_negative CHECK (file_size IS NULL OR file_size >= 0)
);
```

**`NUMERIC(4,2)` for `ease_factor`, never `FLOAT`.** The SM-2 algorithm repeatedly
adjusts this value; binary floating point accumulates representation error, so a card
that should sit at exactly 2.50 drifts to 2.4999999999. `NUMERIC` is exact decimal
arithmetic. The same reasoning applies to money — and it is the reason
`CHECK (ease_factor BETWEEN 1.30 AND 2.50)` can be trusted at all.

**`ease_factor`'s bounds are the algorithm's, not arbitrary.** SM-2 defines 1.3 as the
floor (below it, intervals stop growing usefully) and 2.5 as the initial value. Encoding
the algorithm's invariants as constraints means a buggy scheduling update fails loudly
instead of quietly producing a card due in the year 3000.

**`resource_type` as `VARCHAR` + `CHECK`, not an `ENUM`.** Changing the allowed set is
`ALTER TABLE ... DROP CONSTRAINT ... ADD CONSTRAINT` inside a normal transaction, and
it is reversible. Enum values cannot be removed.

### Group F — Audit

```sql
-- ─── activity_logs ────────────────────────────────────────────────────────────
-- Written by a trigger. Append-only.
CREATE TABLE activity_logs (
    id          BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id     UUID        REFERENCES users(id) ON DELETE SET NULL,
    action_type VARCHAR(50) NOT NULL,
    entity_type VARCHAR(50) NOT NULL,
    entity_id   UUID,
    metadata    JSONB       NOT NULL DEFAULT '{}'::jsonb,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT ck_activity_logs_action_type_allowed
        CHECK (action_type IN ('create', 'update', 'delete', 'link', 'unlink'))
);

-- ─── notifications ────────────────────────────────────────────────────────────
CREATE TABLE notifications (
    id         BIGINT       GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id    UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type       VARCHAR(50)  NOT NULL,
    title      VARCHAR(255) NOT NULL,
    body       TEXT,
    link_url   TEXT,
    is_read    BOOLEAN      NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ  NOT NULL DEFAULT now(),

    CONSTRAINT ck_notifications_type_allowed
        CHECK (type IN ('link_created', 'note_shared', 'review_due', 'system'))
);
```

**The column is named `metadata`.** This matters more than it looks. In SQLAlchemy,
`metadata` is a reserved attribute on `DeclarativeBase` — you cannot have a mapped
attribute with that name. The correct resolution is to name the *Python attribute*
`metadata_` while keeping the *column* `metadata`:

```python
metadata_: Mapped[dict] = mapped_column("metadata", JSONB, ...)
```

The previous doc set did exactly this, and then wrote all three triggers against a
column called `metadata_` — which does not exist. Every trigger would have failed at
runtime with `column "metadata_" of relation "activity_logs" does not exist`. **The
Python name and the SQL name are different things, and triggers live in SQL.** Phase 3
writes them against `metadata`.

**`BIGINT IDENTITY` for the audit tables.** These grow without bound — one row per
write, forever. `INTEGER` tops out at 2.1 billion; on an append-only log that is a
future outage with a known date. `BIGINT` costs 4 extra bytes and removes the problem
permanently.

**`activity_logs.user_id` is `ON DELETE SET NULL`.** An audit log that disappears when
the actor is deleted is not an audit log.

---

## 2.5 The SQLAlchemy models

Eight modules under `app/models/`. Below are the two most instructive; the remainder
follow the same patterns exactly and are mechanical translations of the DDL above.

### `backend/app/models/user.py`

```python
from datetime import datetime
from uuid import UUID

from sqlalchemy import CheckConstraint, DateTime, String, Text
from sqlalchemy.dialects.postgresql import CITEXT
from sqlalchemy.dialects.postgresql import UUID as PgUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin


class User(Base, TimestampMixin):
    __tablename__ = "users"
    __table_args__ = (
        CheckConstraint("btrim(display_name) <> ''", name="display_name_not_blank"),
    )

    # No default. This value is the `sub` claim from the Supabase JWT — the row is
    # created from a verified token, never minted locally. See ADR-013.
    id: Mapped[UUID] = mapped_column(PgUUID(as_uuid=True), primary_key=True)

    email: Mapped[str] = mapped_column(CITEXT, nullable=False, unique=True)
    display_name: Mapped[str] = mapped_column(String(100), nullable=False)
    avatar_url: Mapped[str | None] = mapped_column(Text)
    bio: Mapped[str | None] = mapped_column(Text)
    last_seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    workspaces: Mapped[list["Workspace"]] = relationship(
        back_populates="owner", cascade="all, delete-orphan", lazy="raise_on_sql"
    )
    notes: Mapped[list["Note"]] = relationship(
        back_populates="creator", cascade="all, delete-orphan", lazy="raise_on_sql"
    )
```

> **`lazy="raise_on_sql"` on every relationship.** In async SQLAlchemy, a lazy load
> triggered outside an active session raises `MissingGreenlet` — an error whose message
> says nothing about the actual mistake. `raise_on_sql` converts it into an immediate,
> explicit failure at the point of access: *this relationship was not eagerly loaded.*
> It turns a confusing production bug into an obvious development one, and it forces
> every query to declare what it needs via `selectinload()`. This is the standard
> defence against N+1 queries.

### `backend/app/models/note.py`

```python
from uuid import UUID, uuid4

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Computed,
    ForeignKey,
    ForeignKeyConstraint,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import TSVECTOR
from sqlalchemy.dialects.postgresql import UUID as PgUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin

# Kept as module constants because Phase 3's search view and GIN index must use the
# byte-identical expression. In the previous doc set the index expression and the query
# expression drifted apart, so PostgreSQL silently never used the index — a full
# sequential scan on every search, with no error to indicate it.
_STRIP_HTML = "regexp_replace({col}, '<[^>]+>', ' ', 'g')"

_WORD_COUNT_SQL = r"""
CASE
    WHEN btrim(regexp_replace(COALESCE(content, ''), '<[^>]+>', ' ', 'g')) = ''
    THEN 0
    ELSE array_length(
        regexp_split_to_array(
            btrim(regexp_replace(COALESCE(content, ''), '<[^>]+>', ' ', 'g')), '\s+'
        ), 1)
END
"""

# to_tsvector MUST name the configuration explicitly. The single-argument form reads
# default_text_search_config from the session, which makes it STABLE rather than
# IMMUTABLE — and PostgreSQL rejects non-IMMUTABLE functions in generated columns.
_SEARCH_VECTOR_SQL = """
setweight(to_tsvector('english', COALESCE(title, '')), 'A') ||
setweight(to_tsvector('english',
    COALESCE(regexp_replace(content, '<[^>]+>', ' ', 'g'), '')), 'B')
"""


class Note(Base, TimestampMixin):
    __tablename__ = "notes"
    __table_args__ = (
        ForeignKeyConstraint(
            ["notebook_id", "creator_id"],
            ["notebooks.id", "notebooks.owner_id"],
            # PostgreSQL 15+ column list: null ONLY notebook_id. Plain SET NULL would
            # also null creator_id, which is NOT NULL, so the delete would fail.
            ondelete="SET NULL (notebook_id)",
            name="notebook_id_creator_id",
        ),
        UniqueConstraint("id", "creator_id", name="id_creator_id"),
        CheckConstraint("btrim(title) <> ''", name="title_not_blank"),
    )

    id: Mapped[UUID] = mapped_column(PgUUID(as_uuid=True), primary_key=True, default=uuid4)
    creator_id: Mapped[UUID] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    notebook_id: Mapped[UUID | None] = mapped_column(PgUUID(as_uuid=True))

    title: Mapped[str] = mapped_column(String(255), nullable=False)
    content: Mapped[str | None] = mapped_column(Text)
    is_public: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    pinned: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    archived: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    # Generated columns. init=False semantics: never assign to these.
    word_count: Mapped[int] = mapped_column(Integer, Computed(_WORD_COUNT_SQL, persisted=True))
    search_vector: Mapped[str] = mapped_column(
        TSVECTOR, Computed(_SEARCH_VECTOR_SQL, persisted=True)
    )

    creator: Mapped["User"] = relationship(back_populates="notes", lazy="raise_on_sql")

    # viewonly: this relationship traverses the composite FK, whose creator_id column is
    # also written by `creator`. Two writable relationships sharing a column make
    # SQLAlchemy's unit of work ambiguous. We always assign notebook_id explicitly —
    # the service layer has to check ownership anyway — so read-only is honest here.
    notebook: Mapped["Notebook | None"] = relationship(
        back_populates="notes", viewonly=True, lazy="raise_on_sql"
    )

    versions: Mapped[list["NoteVersion"]] = relationship(
        back_populates="note",
        cascade="all, delete-orphan",
        order_by="desc(NoteVersion.version_num)",
        lazy="raise_on_sql",
    )
    outgoing_links: Mapped[list["KnowledgeLink"]] = relationship(
        foreign_keys="[KnowledgeLink.source_note_id, KnowledgeLink.created_by]",
        viewonly=True,
        lazy="raise_on_sql",
    )
    incoming_links: Mapped[list["KnowledgeLink"]] = relationship(
        foreign_keys="KnowledgeLink.target_note_id", viewonly=True, lazy="raise_on_sql"
    )
```

> **The rule for this schema: relationships that traverse a composite tenancy foreign
> key are `viewonly=True`, and the ID columns are assigned directly.** Composite FKs
> deliberately share a column (`creator_id`, `owner_id`) between two constraints. That
> is the whole point — but SQLAlchemy's unit of work cannot decide which relationship
> owns a shared column, and warns about it. Since the service layer must validate
> ownership before setting these IDs anyway, assigning them explicitly is clearer than
> relying on ORM cascade behaviour. Read through the relationship; write through the ID.

### `backend/app/db/base.py` — the import that makes Alembic work

Append to the file from Phase 1:

```python
# ─── Model registry ───────────────────────────────────────────────────────────
# Alembic autogenerate compares Base.metadata against the live database. A model
# only enters that metadata when its module is imported. Miss one and autogenerate
# produces a migration that DROPS the table it cannot see. These imports are the
# registry; noqa because they are unused by name and essential by side effect.
from app.models.audit import ActivityLog, Notification        # noqa: E402, F401
from app.models.collection import Collection, CollectionItem  # noqa: E402, F401
from app.models.link import KnowledgeLink, RelationshipType   # noqa: E402, F401
from app.models.note import Note, NoteVersion                 # noqa: E402, F401
from app.models.study import Flashcard, Resource              # noqa: E402, F401
from app.models.tag import NoteTag, Tag                       # noqa: E402, F401
from app.models.user import User                              # noqa: E402, F401
from app.models.workspace import Notebook, Workspace          # noqa: E402, F401
```

---

## 2.6 The first migration

Per [ADR-014](../../adr/0014-direct-supabase-dev-solo.md), this project develops
directly against Supabase rather than a local Docker Postgres — `docker compose up -d
db` is not part of this project's actual workflow. `DATABASE_URL` /
`DATABASE_URL_SYNC` already point at Supabase's session pooler, set once in `.env` and
`backend/.env`.

```bash
cd backend
uv run alembic revision --autogenerate -m "create core schema"
```

**Then open the generated file and fix what autogenerate cannot know.**

**1. Extensions must be created before the tables.** `CITEXT` is a type provided by an
extension. Add at the very top of `upgrade()`:

```python
def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS citext")
    # ... autogenerated create_table calls follow
```

Only `citext` — not `pgcrypto` or `pg_trgm`. `pgcrypto` provides `gen_random_uuid()`,
but every `id` column here defaults Python-side (`default=uuid4`, in
`mapped_column(...)`), never `server_default=text('gen_random_uuid()')`, so nothing in
this schema calls a `pgcrypto` function. `pg_trgm` is for fuzzy search, which belongs
to the deferred [`03-SQL-LAYER.md`](03-SQL-LAYER.md). Add either only when something
actually uses it — an unused extension is a line that looks load-bearing and isn't.

Do **not** drop extensions in `downgrade()` unconditionally — other schemas in the same
database may depend on them, and `DROP EXTENSION` cascades. It's safe here specifically
because `users.email` is the *only* column anywhere in this schema typed `CITEXT`, so
once `downgrade()` has dropped every table, nothing depends on the extension anymore:

```python
def downgrade() -> None:
    # ... autogenerated drop_table calls, then, last:
    op.execute("DROP EXTENSION IF EXISTS citext")
```

**2. `UniqueConstraint` must never carry a short, unprefixed `name=`.** Explicit names
like `name="id_user_id"` bypass `NAMING_CONVENTION` entirely (unlike `CheckConstraint`,
whose convention re-wraps any given name with a table prefix automatically) — and
Postgres scopes a `UNIQUE` constraint's implicit index **schema-wide**, not per-table,
so the same name on two tables is a hard `DuplicateTableError` at migration time, not a
lint warning. Omit `name=` on every `UniqueConstraint` and let the convention generate
`uq_<table>_<columns>`. Full story: [ADR-016](../../adr/0016-uniqueconstraint-naming.md).

**3. Verify the four things autogenerate gets wrong or omits.** Read the file and
confirm each:

| Check | What to look for |
|---|---|
| Composite FKs are composite | `ForeignKeyConstraint(['notebook_id', 'creator_id'], ...)` — two columns, not two separate constraints |
| The column-list `SET NULL` survived | `ondelete='SET NULL (notebook_id)'` — verbatim, parentheses intact |
| Generated columns are `STORED` | `sa.Computed(..., persisted=True)` on `word_count` and `search_vector` |
| Table creation order | `relationship_types` and `users` before anything referencing them |

Then apply, and — this is the part people skip — prove it reverses:

```bash
uv run alembic upgrade head
uv run alembic downgrade base      # must succeed and leave an empty schema
uv run alembic upgrade head
```

A `downgrade()` that has never been executed is a `downgrade()` that does not work.
Backend CI runs this cycle on every push for exactly that reason.

**If you're on Windows:** the async migration runner builds its engine directly from
`settings.database_url` (asyncpg) rather than routing the URL through
`config.set_main_option()`/`configparser`, and rather than using the `psycopg` driver
in async mode. Two independent, real errors hit while building this against Supabase —
`configparser`'s `%`-interpolation colliding with a percent-encoded password character,
and psycopg3's async mode refusing Windows' default `ProactorEventLoop`. Full story:
[ADR-015](../../adr/0015-alembic-async-engine-direct.md).

### Verify the schema is what you think it is

No local `db` container to `docker compose exec` into — connect with `psql` directly
against `DATABASE_URL_SYNC` (works because that string is deliberately the
`psql`-compatible one, see [ADR-004](../../adr/0004-two-database-urls.md)), or run the
same checks from Python if `psql` isn't installed locally:

```bash
psql "$DATABASE_URL_SYNC"
```

```sql
\dt                        -- 15 tables + alembic_version
\d notes                   -- confirm the generated columns and the composite FK

-- Prove the generated column works and is unwritable:
INSERT INTO users (id, email, display_name)
VALUES (gen_random_uuid(), 'a@b.com', 'Test') RETURNING id;

INSERT INTO notes (creator_id, title, content)
VALUES ('<that id>', 'Hello', '<p>one two three</p>')
RETURNING word_count, search_vector;
--  word_count | 3
--  search_vector | 'hello':1A 'one':2B 'three':4B 'two':3B

UPDATE notes SET word_count = 999;
-- ERROR:  column "word_count" can only be updated to DEFAULT
```

That error is the feature. The column is not merely computed by default — it is
**unwritable by anyone**, which is what "correct on every write path" actually means.

### Prove tenancy is enforced

The single most valuable thing to demo in a viva:

```sql
-- Alice creates a workspace and a notebook
INSERT INTO workspaces (id, owner_id, name, slug)
VALUES ('11111111-1111-1111-1111-111111111111', '<alice>', 'Alice WS', 'alice-ws');
INSERT INTO notebooks (id, workspace_id, owner_id, name)
VALUES ('22222222-2222-2222-2222-222222222222',
        '11111111-1111-1111-1111-111111111111', '<alice>', 'Alice NB');

-- Bob tries to put HIS note into ALICE's notebook
INSERT INTO notes (creator_id, notebook_id, title)
VALUES ('<bob>', '22222222-2222-2222-2222-222222222222', 'Sneaky');

-- ERROR:  insert or update on table "notes" violates foreign key constraint
--         "fk_notes_notebook_id_creator_id"
-- DETAIL: Key (notebook_id, creator_id)=(2222…, <bob>) is not present
--         in table "notebooks".
```

No application code ran. No `if` statement was evaluated. The database refused, because
the row it was asked to reference does not exist.

---

## 2.7 Seed data

`backend/scripts/seed.py` — a small connected graph you can demo and test against.

```python
"""Seed a demo knowledge graph. Idempotent: safe to run repeatedly."""

import asyncio
from uuid import UUID

from sqlalchemy import select

from app.db.session import AsyncSessionLocal
from app.models.link import KnowledgeLink, RelationshipType
from app.models.note import Note
from app.models.user import User
from app.models.workspace import Notebook, Workspace

DEMO_USER_ID = UUID("00000000-0000-0000-0000-000000000001")

RELATIONSHIP_TYPES = [
    ("references",  "Cites or points to",                "#3B82F6", False),
    ("elaborates",  "Expands on an idea",                "#10B981", False),
    ("contradicts", "Presents an opposing view",         "#EF4444", False),
    ("prerequisite","Must be understood first",          "#F59E0B", False),
    ("related",     "Loosely associated",                "#8B5CF6", True),
    ("example-of",  "A concrete instance",               "#EC4899", False),
    ("summarizes",  "Condenses another note",            "#14B8A6", False),
]


async def seed() -> None:
    async with AsyncSessionLocal() as db:
        # 1. Relationship types — a fixed vocabulary, inserted only if absent.
        existing = set(
            (await db.execute(select(RelationshipType.name))).scalars().all()
        )
        for name, desc, color, symmetric in RELATIONSHIP_TYPES:
            if name not in existing:
                db.add(RelationshipType(
                    name=name, description=desc, color=color, is_symmetric=symmetric
                ))
        await db.flush()

        # 2. Demo user. Fixed UUID so the seed is idempotent and tests can rely on it.
        user = await db.get(User, DEMO_USER_ID)
        if user is None:
            user = User(
                id=DEMO_USER_ID, email="demo@neurovault.app", display_name="Demo User"
            )
            db.add(user)
            await db.flush()

        # 3. Hierarchy
        workspace = Workspace(
            owner_id=user.id, name="Semester 5", slug="semester-5",
            description="DBMS, OS, and Networks",
        )
        db.add(workspace)
        await db.flush()

        notebook = Notebook(
            workspace_id=workspace.id, owner_id=user.id,
            name="Database Systems", color="#4CAF50",
        )
        db.add(notebook)
        await db.flush()

        # 4. Notes — a connected subgraph, deep enough that recursive traversal
        #    at depth 3 returns something interesting.
        titles_and_content = [
            ("Normalization",        "<p>Organizing tables to reduce redundancy.</p>"),
            ("Functional Dependency","<p>X determines Y when each X has one Y.</p>"),
            ("Third Normal Form",    "<p>No transitive dependency on the key.</p>"),
            ("BCNF",                 "<p>Every determinant is a candidate key.</p>"),
            ("Denormalization",      "<p>Trading redundancy for read speed.</p>"),
            ("Indexing",             "<p>B-trees, GIN, and partial indexes.</p>"),
        ]
        notes = [
            Note(creator_id=user.id, notebook_id=notebook.id, title=t, content=c)
            for t, c in titles_and_content
        ]
        db.add_all(notes)
        await db.flush()

        # 5. Edges. Note the shape: a chain plus a contradiction, so the graph has
        #    both depth and an interesting branch to show off.
        types = {
            rt.name: rt.id
            for rt in (await db.execute(select(RelationshipType))).scalars()
        }
        edges = [
            (0, 1, "prerequisite"),   # Normalization ← Functional Dependency
            (1, 2, "elaborates"),     # Functional Dependency → 3NF
            (2, 3, "elaborates"),     # 3NF → BCNF
            (0, 4, "contradicts"),    # Normalization ↔ Denormalization
            (4, 5, "references"),     # Denormalization → Indexing
        ]
        for src, tgt, rel in edges:
            db.add(KnowledgeLink(
                source_note_id=notes[src].id,
                target_note_id=notes[tgt].id,
                rel_type_id=types[rel],
                created_by=user.id,
                strength=7,
            ))

        await db.commit()
        print(f"Seeded {len(notes)} notes and {len(edges)} links "
              f"for user {DEMO_USER_ID}")


if __name__ == "__main__":
    asyncio.run(seed())
```

```bash
uv run python -m scripts.seed
```

**The seed is deliberately a connected chain with one branch.** A star graph or a set
of disconnected notes would let a broken recursive CTE look correct. This shape has a
path of length 3 from `Normalization` to `BCNF`, so depth-limiting is observable, and
`Denormalization → Indexing` gives the traversal somewhere to go in a second direction.

---

## 2.8 Normalization analysis

This is the section to rehearse. Your examiner will pick a table and ask you to prove
its normal form.

### The definitions, stated so you can apply them

| Form | Requirement |
|---|---|
| **1NF** | Every attribute is atomic; no repeating groups |
| **2NF** | 1NF, and no non-key attribute depends on *part* of a composite key |
| **3NF** | 2NF, and no non-key attribute depends on another non-key attribute |
| **BCNF** | For every functional dependency X → Y, X is a superkey |

### `notes` — BCNF

Functional dependencies:

```
id → creator_id, notebook_id, title, content, is_public, pinned, archived,
     created_at, updated_at
content → word_count, search_vector          (generated columns)
```

**1NF:** every column holds one value. `content` is a long string, but a string is
atomic — it is not a repeating group, and we never parse it with SQL to find a
sub-element. ✅

**2NF:** the key is a single column, so no partial dependency is possible. ✅

**3NF:** does any non-key attribute determine another? `content → word_count` looks
like one. It is not a violation, because `word_count` is a **generated column**: it has
no independent existence and cannot be updated separately, so the update anomaly that
3NF exists to prevent is structurally impossible. Textbook normalization analyses
*stored, independently writable* attributes. ✅

**BCNF:** the only determinant is `id`, which is the primary key and therefore a
superkey. ✅

> **Viva question:** *Isn't `word_count` a transitive dependency, violating 3NF?*
>
> "Formally there is a dependency `content → word_count`. Normalization exists to
> prevent update anomalies — the case where you change one copy of a fact and not the
> other. Here that cannot happen: `word_count` is `GENERATED ALWAYS AS ... STORED`, so
> PostgreSQL recomputes it on every write and rejects any attempt to set it directly.
> The dependency is enforced by the database rather than merely asserted by the schema,
> so the anomaly 3NF protects against has no way to occur. If it were an ordinary
> `INTEGER` column maintained by application code, it *would* be a 3NF violation and a
> real bug."

### `knowledge_links` — BCNF

```
id → source_note_id, target_note_id, rel_type_id, created_by, strength, description
(source_note_id, target_note_id, rel_type_id) → id        (the UNIQUE constraint)
```

Two candidate keys: the surrogate `id`, and the natural triple. Every determinant is a
candidate key, so BCNF holds. ✅

This table also demonstrates something worth naming: **a junction table with its own
attributes.** `strength` and `description` describe the *relationship*, not either note.
That is precisely why the M:N cannot be collapsed into a foreign key on `notes`.

### The two deliberate 3NF violations

**Be the one who raises these before the examiner does.** Knowing where your schema
breaks the rules — and why — is the strongest possible signal that you designed it
rather than copied it.

#### Violation 1 — `notebooks.owner_id`

```
workspace_id → owner_id
```

`owner_id` is a non-key attribute determined by another non-key attribute. Textbook 3NF
violation. The normalized form would drop the column and join through `workspaces`.

**What it buys:** the composite foreign key on `notes`. Without `owner_id` on
`notebooks`, `notes` cannot reference `notebooks (id, owner_id)`, and cross-tenant
writes become an application-layer responsibility again.

**Why the anomaly cannot occur:** the redundancy is *enforced*, not merely present. The
composite FK `(workspace_id, owner_id) → workspaces (id, owner_id)` means the two copies
of the owner cannot disagree — an `UPDATE` that desynchronised them would violate the
constraint. This is redundancy with a guarantee attached, which is a different thing
from redundancy.

#### Violation 2 — `note_tags.owner_id` and `collection_items.owner_id`

Identical reasoning. `note_id → owner_id` transitively via `notes.creator_id`. The
column exists so that *both* foreign keys can be tenancy-checked in one row, and both
FKs together guarantee it stays consistent.

> **Viva question:** *Is your schema in 3NF?*
>
> "Thirteen of the fifteen tables are in BCNF. Two carry a deliberate transitive
> dependency — `notebooks.owner_id` and the `owner_id` on the two junction tables —
> and I can show you exactly what it buys and why it is safe.
>
> Each of those columns exists so a foreign key can be *composite*, which is how
> multi-tenant isolation is enforced by the database rather than by application code.
> The usual objection to a transitive dependency is the update anomaly: two copies of
> a fact drifting apart. Here that is impossible, because the same composite foreign
> key that needs the column also constrains it — the two copies of the owner cannot
> disagree without violating the constraint.
>
> So it is not unnormalized by accident. It is a controlled denormalization where the
> database enforces the invariant that normalization would otherwise be protecting."

That answer is worth rehearsing verbatim. It demonstrates the three things an examiner
is actually testing: that you know the rule, that you know why the rule exists, and that
you know when the reason for the rule does not apply.

---

## 2.9 Phase 2 checklist

```
□ 15 tables created by `alembic upgrade head` on a clean database
□ `alembic downgrade base` removes all of them without error
□ `\d notes` shows both generated columns marked "generated always as ... stored"
□ UPDATE on word_count is rejected by PostgreSQL
□ The cross-tenant INSERT in §2.6 fails with a foreign key violation
□ Deleting a notebook nulls notebook_id on its notes and does NOT delete them
□ Deleting a user cascades to their workspaces, notes, tags, and collections
□ The seed script runs twice with no error and no duplicate relationship types
□ `uv run ruff check .` and `uv run pyright` are clean
□ You can state the normal form of any table, and both deliberate violations
```

The sixth line is worth testing by hand — it is the `ON DELETE SET NULL (notebook_id)`
behaviour, and it is the constraint most likely to have been transcribed incorrectly:

```sql
DELETE FROM notebooks WHERE id = '2222…';
SELECT id, title, notebook_id FROM notes WHERE creator_id = '<alice>';
-- notebook_id is NULL; the notes still exist.
```

---

**Next:** [`03-SQL-LAYER.md`](03-SQL-LAYER.md) — indexes, views, triggers, procedures,
the recursive CTE, and the 15 queries.
