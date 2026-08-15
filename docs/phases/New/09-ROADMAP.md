# Roadmap — Feature Improvements

**These are not cancelled.** They are sequenced after the core ships, each with its
schema delta specified so the work is additive rather than a rewrite.

**Read this before Phase 2**, not after. The core schema was designed knowing these were
coming — that is why none of them requires altering an existing column.

---

## Why these are deferred

The original plan had 18 phases. For two people in one semester alongside four other
courses, that is roughly three to four times too much work. Something had to move, and
the question was *what*, not *whether*.

The rule used: **cut breadth, never depth.** A knowledge graph with recursive traversal,
trigger-maintained versioning, full-text search, and row-level security — finished,
deployed, and defensible — beats the same thing plus half-built collaborative editing.
An examiner marks what works. A half-finished feature is worse than an absent one,
because it invites questions you cannot answer well.

Each item below states what it demonstrates that the core does not, so you can pick up
the one that adds the most if time appears.

---

## FI-1 — Collaborative editing

**Adds:** presence, soft locking, and conflict handling.
**Demonstrates:** concurrency control, optimistic locking, lock expiry — genuine CO3
material that the core touches only lightly.
**Estimate:** 8–12 hours for the lock-based version. Weeks for the CRDT version.

### Schema delta

```sql
-- Purely additive. No existing column changes.
CREATE TABLE note_editing_sessions (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    note_id     UUID        NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
    user_id     UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    started_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    cursor_pos  INTEGER,

    CONSTRAINT uq_note_editing_sessions_note_id_user_id UNIQUE (note_id, user_id)
);

CREATE INDEX idx_note_editing_sessions_note_id_last_seen_at
    ON note_editing_sessions (note_id, last_seen_at DESC);

-- Optimistic locking on notes.
ALTER TABLE notes ADD COLUMN lock_version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE notes ADD COLUMN locked_by    UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE notes ADD COLUMN locked_until TIMESTAMPTZ;
```

### The mechanism

**Optimistic locking.** Every read returns `lock_version`. Every write sends it back:

```sql
UPDATE notes
   SET content = :content, lock_version = lock_version + 1
 WHERE id = :id AND lock_version = :expected_version;
-- 0 rows affected ⇒ someone else wrote first ⇒ return 409 Conflict
```

The client then shows a diff and lets the user merge. This is the same mechanism
SQLAlchemy calls `version_id_col` and Rails calls optimistic locking, and it is worth
being able to name.

**Soft locks with expiry.** `locked_until` is a timestamp, not a boolean. A hard lock
with no expiry deadlocks the document the moment someone closes their laptop mid-edit;
a lock that expires degrades to the optimistic path automatically. **Any lock a human
can hold must be able to expire.**

**Presence** is `last_seen_at` heartbeated every 10 seconds, with sessions older than 30
seconds swept. Polling is fine at this scale — WebSockets are not required for
"who else is here".

### Why not real-time character-by-character sync

Because it needs CRDTs or operational transformation, and neither is a weekend. If you
want it, use Yjs with `y-prosemirror` (Tiptap is ProseMirror underneath) and treat the
CRDT document as the source of truth, with PostgreSQL storing periodic snapshots. That
is a different architecture, not an addition to this one — which is exactly why it is
here and not in the core.

> **Viva-ready even unbuilt:** *"How would you handle two users editing the same note?"*
> — "Optimistic locking on a version column. The `UPDATE` includes the expected version
> in its `WHERE`; zero rows affected means someone wrote first, and the client gets a
> 409 with a diff to merge. For character-level real-time you'd need a CRDT, which is a
> different architecture — the database stops being the source of truth and becomes a
> snapshot store."

---

## FI-2 — AI-suggested links

**Adds:** embeddings, vector similarity, suggestion review.
**Demonstrates:** `pgvector`, approximate nearest neighbour indexing, a fundamentally
different index type from B-tree and GIN.
**Estimate:** 6–10 hours.

### Schema delta

```sql
CREATE EXTENSION IF NOT EXISTS vector;

-- Separate table, not a column on notes. Rationale below.
CREATE TABLE note_embeddings (
    note_id     UUID        PRIMARY KEY REFERENCES notes(id) ON DELETE CASCADE,
    embedding   vector(1536) NOT NULL,
    model       VARCHAR(50)  NOT NULL,
    computed_at TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- HNSW: approximate nearest neighbour. Trades exactness for speed.
CREATE INDEX idx_note_embeddings_embedding
    ON note_embeddings USING hnsw (embedding vector_cosine_ops);

CREATE TABLE ai_link_suggestions (
    id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    source_note_id UUID        NOT NULL,
    target_note_id UUID        NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
    owner_id       UUID        NOT NULL,
    similarity     REAL        NOT NULL,
    suggested_type SMALLINT    REFERENCES relationship_types(id),
    status         VARCHAR(20) NOT NULL DEFAULT 'pending',
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- Same composite-FK tenancy pattern as the core. ADR-001 keeps applying.
    CONSTRAINT fk_ai_link_suggestions_source_note_id_owner_id
        FOREIGN KEY (source_note_id, owner_id)
        REFERENCES notes (id, creator_id) ON DELETE CASCADE,
    CONSTRAINT uq_ai_link_suggestions_source_note_id_target_note_id
        UNIQUE (source_note_id, target_note_id),
    CONSTRAINT ck_ai_link_suggestions_status
        CHECK (status IN ('pending', 'accepted', 'rejected')),
    CONSTRAINT ck_ai_link_suggestions_similarity_range
        CHECK (similarity BETWEEN -1 AND 1)
);
```

**A separate `note_embeddings` table, not a column on `notes`.** Three reasons: a 1536-
dimension vector is ~6 KB and would bloat every `SELECT * FROM notes`; embeddings are
recomputed on a different schedule than notes are edited; and changing model means
changing the column *type*, which on a separate table is a drop-and-rebuild rather than
an `ALTER` on your busiest table.

**Suggestions are proposals, not edges.** They land in their own table with a `status`,
and only become rows in `knowledge_links` when the user accepts. The AI never silently
writes to the user's graph. That is a product decision with a real justification:
a knowledge graph the user does not trust is worthless, and one bad automatic edge
destroys that trust permanently.

This mirrors how every comparable product actually ships the feature, not just how this
one plays it safe. Mem.ai, Tana, and RemNote all layer AI-suggested connections on top
of an explicit, user-driven linking model — never as the primary mechanism, and always
reviewable rather than silent. [ADR-011](../../adr/0011-postgresql-not-graph-database.md) has the wider
version of this: no product in this category lets an automated process write the graph
directly, the same way none of them runs a native graph database. `[[wiki-links]]` are
the core's automatic mechanism precisely because they're deterministic — the user typed
the exact title, so there's nothing to review. A similarity score is a guess, and guesses
get a review step.

### The query

```sql
-- Cosine distance. <=> is pgvector's operator; 1 - distance = similarity.
SELECT n.id, n.title, 1 - (e.embedding <=> :query_embedding) AS similarity
FROM note_embeddings e
JOIN notes n ON n.id = e.note_id
WHERE n.creator_id = :user_id
  AND n.id <> :source_note_id
  AND NOT EXISTS (
      SELECT 1 FROM knowledge_links kl
      WHERE kl.source_note_id = :source_note_id AND kl.target_note_id = n.id
  )
ORDER BY e.embedding <=> :query_embedding      -- ORDER BY is what uses the HNSW index
LIMIT 5;
```

> **The detail that gets marks:** the HNSW index is only used by the `ORDER BY`, not by
> a `WHERE similarity > 0.8`. Vector indexes accelerate *nearest-neighbour ordering*;
> filtering on a computed distance forces an exact scan over every row. This is the most
> common pgvector mistake, and knowing it demonstrates you understand what the index
> actually does.

**Cost control:** embed on write, debounced, not on read. Cache by content hash so an
unchanged note is never re-embedded. Both are cheap and both are the difference between
a demo and a bill.

---

## FI-3 — Desktop application

**Adds:** offline-first operation and sync.
**Demonstrates:** heterogeneous databases, conflict resolution, sync protocol design.
**Estimate:** 15–20 hours. Realistically a separate project.

### The honest assessment

This is the largest of the three and adds the least *database-course* value per hour.
It is here because it was in the original plan, and because the core was built so it
remains possible — but if time appears, FI-1 or FI-2 is the better investment.

**What makes it possible at all:** the frontend is a static export
([ADR-010](../../adr/0010-static-export-frontend.md)). Tauri wraps static files, so there is no Node
server to eliminate first. That was a deliberate consequence of the ADR, not luck.

### Schema delta

```sql
-- Server side: sync bookkeeping.
ALTER TABLE notes ADD COLUMN client_id     UUID;
ALTER TABLE notes ADD COLUMN synced_at     TIMESTAMPTZ;
ALTER TABLE notes ADD COLUMN device_origin VARCHAR(100);

CREATE TABLE sync_log (
    id          BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id     UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    entity_type VARCHAR(50) NOT NULL,
    entity_id   UUID        NOT NULL,
    operation   VARCHAR(10) NOT NULL,
    payload     JSONB       NOT NULL,
    client_ts   TIMESTAMPTZ NOT NULL,
    server_ts   TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT ck_sync_log_operation CHECK (operation IN ('insert', 'update', 'delete'))
);

CREATE INDEX idx_sync_log_user_id_server_ts ON sync_log (user_id, server_ts);
```

### The hard part, named honestly

The local database is SQLite; the server is PostgreSQL. **The features this project is
built on do not exist in SQLite** — no recursive CTE with array cycle detection, no
`tsvector`, no PL/pgSQL triggers, no generated columns with the same semantics. So the
desktop build needs either:

- **A reduced local mode** — local editing and search via SQLite FTS5; graph traversal
  only when online. Recommended.
- **A reimplementation** of traversal and versioning in Rust, against SQLite. Correct,
  and a large amount of work to maintain two implementations of the same invariants.

**Conflict resolution:** last-write-wins on `client_ts`, with the loser preserved as a
`note_versions` row rather than discarded. Never destroy a user's writing to resolve a
conflict — keep both and let them choose. The version table already exists for exactly
this, which is a nice example of a design paying off in a use case it was not built for.

---

## Sequencing

| Order | Item | Why this position |
|---|---|---|
| 1 | **Ship the core** | Nothing below matters if the core is not deployed and defensible |
| 2 | FI-2 — AI links | Highest DBMS value per hour: a new index type, a new query shape |
| 3 | FI-1 — Collaboration | Real concurrency-control content, and the lock-based version is genuinely finishable |
| 4 | FI-3 — Desktop | Largest effort, least course value, needs a second implementation |

**Do not start any of these until the Phase 7 checklist is fully green.** The most
common way a good project gets a mediocre mark is a half-finished fourth feature
displacing polish on the three that worked.

---

## What was dropped outright

**`projects`.** The original schema had a `projects` table with no foreign keys to
anything, no API routes, no UI, and no appearance in any query. It was a table because
someone thought a project management app should have one.
[ADR-009](../../adr/0009-dropping-projects.md) records the removal.

> **If asked why there is no `projects` table:** "It had no relationships, no queries,
> and no interface. A table that nothing references and nothing reads is not a feature,
> it is schema debt — every migration has to carry it and every ER diagram has to
> explain it. Workspaces already provide the grouping it was meant to provide."

That answer is worth having ready. **Removing something and being able to say why is a
stronger signal than having built it** — it shows the schema was designed rather than
accumulated.
