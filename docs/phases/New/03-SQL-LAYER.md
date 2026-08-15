# Phase 3 — The SQL Layer

**Goal:** the advanced SQL that makes this a database project rather than an app with a
database behind it — indexes, views, triggers, stored procedures, recursive traversal,
and row-level security.

**Time:** ~6 hours · **Prerequisite:** [`02-DATABASE.md`](02-DATABASE.md)

**Done when:**

```
\di  → 10 indexes       \dv  → 4 views        \df  → 6 routines
Editing a note creates a version row with no application code involved
EXPLAIN ANALYZE shows Index Scan, not Seq Scan, on search and traversal
The recursive CTE returns the correct subgraph and terminates on a cyclic graph
```

---

## 3.1 Everything here lives in an Alembic migration

Not in loose `.sql` files you run by hand. This is [ADR-003](../../adr/0003-sql-objects-in-migrations.md),
and it is worth restating because it is the decision most often got wrong.

A view, a trigger, and an index are **schema**, exactly as much as a table is. If they
exist only in a `.sql` file someone remembers to run, then:

- a fresh clone has tables but no triggers, and the versioning "just doesn't work"
- CI's test database has no indexes, so nothing catches a query that stopped using one
- there is no record of *when* a trigger changed, or what it looked like before
- rolling back a deploy rolls back the tables and leaves the triggers from the new version

`op.execute()` puts raw SQL inside a migration. Every environment gets it from one
command, in the right order, with a recorded history and a working `downgrade()`.

> **The rule:** if a fresh `alembic upgrade head` on an empty database does not produce
> it, it is not part of your schema — it is a thing you have to remember, and you will
> not.

We use three migrations so each is reviewable on its own:

| Migration | Contents |
|---|---|
| `002_indexes` | 10 indexes |
| `003_views_functions_triggers` | 4 views, 6 routines, 3 triggers |
| `004_rls` | Row Level Security policies |

**Every `upgrade()` below has a matching `downgrade()`.** They are shown once, in full,
for the first migration, then summarised — but you must write them all. CI runs
`downgrade base` on every push (§1.12), so an incomplete one fails the build.

---

## 3.2 Indexes

### The concept, in the form you need for the viva

A table with no index is a **sequential scan** — PostgreSQL reads every row and discards
the ones that do not match. Cost grows linearly with table size. An index is a separate,
ordered data structure that turns "find the matching rows" into a tree descent.

The trade-off is not free, and stating it is what distinguishes a real answer:

- Every index must be **updated on every INSERT, UPDATE, and DELETE** to the columns it
  covers. Write throughput drops.
- Every index consumes **disk and cache memory**. An index competing for cache with the
  table it serves can make things slower.
- The planner **chooses** whether to use one. An index that exists but is never chosen
  is pure cost — which is exactly what happened in the previous doc set, twice.

> **Viva question:** *When would you NOT add an index?*
>
> "Three cases. On a low-cardinality column where most rows match — the planner will
> correctly prefer a sequential scan, because random I/O for half the table is slower
> than reading it in order. On a write-heavy table where the query it serves is rare.
> And when an existing composite index already covers the query as a prefix — an index
> on `(a, b)` already serves queries filtering on `a` alone, so a separate index on `a`
> is redundant."

### `backend/alembic/versions/002_indexes.py`

```python
"""Indexes for the access patterns the application actually has.

Revision ID: 0002_indexes
Revises: 0001_create_core_schema
"""

from alembic import op

revision = "0002_indexes"
down_revision = "0001_create_core_schema"


def upgrade() -> None:
    # ── 1. Full-text search ───────────────────────────────────────────────────
    # GIN on the GENERATED search_vector column. Because the column is generated,
    # the index and the query reference the same identifier — they cannot drift.
    # The previous doc set indexed an inline to_tsvector(...) expression that did
    # not match the one in the search query, so the index was never used and no
    # error was ever raised. Indexing the column removes that entire failure mode.
    op.execute("""
        CREATE INDEX idx_notes_search_vector
            ON notes USING GIN (search_vector)
    """)

    # ── 2. The note list: "my notes, newest first, excluding archived" ────────
    # PARTIAL: the WHERE clause means archived notes are not in the index at all.
    # Smaller index, and the planner only uses it for queries whose predicate
    # implies the index predicate.
    op.execute("""
        CREATE INDEX idx_notes_creator_id_updated_at
            ON notes (creator_id, updated_at DESC)
            WHERE archived = FALSE
    """)

    # ── 3 & 4. Graph traversal — the two that matter most ─────────────────────
    # The recursive CTE joins knowledge_links on source OR target at every level.
    # Without both of these, each iteration is a sequential scan over all edges,
    # and traversal cost becomes O(depth x edges) instead of O(result size).
    op.execute("""
        CREATE INDEX idx_knowledge_links_source_note_id
            ON knowledge_links (source_note_id, rel_type_id)
    """)
    op.execute("""
        CREATE INDEX idx_knowledge_links_target_note_id
            ON knowledge_links (target_note_id)
    """)

    # ── 5. Version history: "latest version of this note" ─────────────────────
    # DESC matches the ORDER BY in the rollback procedure and the history endpoint,
    # so the sort is satisfied by the index instead of a separate sort node.
    op.execute("""
        CREATE INDEX idx_note_versions_note_id_version_num
            ON note_versions (note_id, version_num DESC)
    """)

    # ── 6. Unread notifications — the bell badge, polled frequently ───────────
    # PARTIAL on is_read = FALSE. Read notifications accumulate forever and are
    # never queried this way; excluding them keeps the index permanently small.
    op.execute("""
        CREATE INDEX idx_notifications_user_id_created_at
            ON notifications (user_id, created_at DESC)
            WHERE is_read = FALSE
    """)

    # ── 7. Notes within a notebook ────────────────────────────────────────────
    # PARTIAL on NOT NULL: unfiled notes are a large fraction of rows and are
    # never found by notebook_id.
    op.execute("""
        CREATE INDEX idx_notes_notebook_id
            ON notes (notebook_id)
            WHERE notebook_id IS NOT NULL
    """)

    # ── 8. Flashcards due for review ──────────────────────────────────────────
    op.execute("""
        CREATE INDEX idx_flashcards_owner_id_due_at
            ON flashcards (owner_id, due_at)
    """)

    # ── 9. Fuzzy title matching, for typo-tolerant search ─────────────────────
    # GIN + pg_trgm supports LIKE '%foo%' and the similarity operator, neither of
    # which a B-tree can accelerate — a B-tree can only seek on a known prefix.
    op.execute("""
        CREATE INDEX idx_notes_title_trgm
            ON notes USING GIN (title gin_trgm_ops)
    """)

    # ── 10. Wiki-link reconciliation ──────────────────────────────────────────
    # Every save that touches content runs the reconciler in app/services/
    # wiki_link.py (Phase 4), which deletes and re-inserts this note's
    # origin='wiki' edges. Composite on (source_note_id, origin) because that
    # reconciliation query is always "this note's wiki edges", never origin
    # alone — origin has three values and is not selective by itself.
    op.execute("""
        CREATE INDEX idx_knowledge_links_source_note_id_origin
            ON knowledge_links (source_note_id, origin)
    """)


def downgrade() -> None:
    for name in (
        "idx_knowledge_links_source_note_id_origin",
        "idx_notes_title_trgm",
        "idx_flashcards_owner_id_due_at",
        "idx_notes_notebook_id",
        "idx_notifications_user_id_created_at",
        "idx_note_versions_note_id_version_num",
        "idx_knowledge_links_target_note_id",
        "idx_knowledge_links_source_note_id",
        "idx_notes_creator_id_updated_at",
        "idx_notes_search_vector",
    ):
        op.execute(f"DROP INDEX IF EXISTS {name}")
```

### The four index types, and why each was chosen

| # | Type | Why not a plain B-tree |
|---|---|---|
| 1 | **GIN** on `tsvector` | One row contains many lexemes. GIN is an inverted index: lexeme → list of rows. A B-tree indexes one value per row and cannot answer "which rows contain this word". |
| 2, 6, 7 | **Partial B-tree** | The `WHERE` excludes rows the query never wants. Smaller index, better cache residency, cheaper writes for excluded rows. |
| 3, 5, 8 | **Composite B-tree** | Leftmost-prefix rule: `(a, b)` serves `a` and `(a, b)`, never `b` alone. Column order is chosen by which is filtered on. |
| 9 | **GIN + trigram** | Splits text into 3-character grams so `%substring%` becomes an index lookup. A B-tree is useless without a known prefix. |

> **Viva question:** *Why does index column order matter?*
>
> "A composite index is sorted by the first column, then the second within that. You can
> seek on a leftmost prefix — `(creator_id, updated_at)` serves a filter on `creator_id`,
> and a filter on `creator_id` combined with a sort or range on `updated_at`. It cannot
> serve a filter on `updated_at` alone, because those values are scattered across the
> whole index. It is the same reason a phone book sorted by surname then first name
> cannot find everyone named 'Priya'."

### Prove the index is used — do not assume it

This is the part to actually run, and to show in the demo.

```sql
-- Make the planner's numbers meaningful first.
ANALYZE notes;

-- BEFORE: drop the index and watch the plan
DROP INDEX idx_notes_search_vector;
EXPLAIN ANALYZE
SELECT id, title FROM notes
WHERE search_vector @@ websearch_to_tsquery('english', 'normalization');
--  Seq Scan on notes  (cost=0.00..1834.00 rows=6 width=48)
--    Filter: (search_vector @@ ...)
--    Rows Removed by Filter: 9994

-- AFTER
CREATE INDEX idx_notes_search_vector ON notes USING GIN (search_vector);
ANALYZE notes;
EXPLAIN ANALYZE
SELECT id, title FROM notes
WHERE search_vector @@ websearch_to_tsquery('english', 'normalization');
--  Bitmap Heap Scan on notes  (cost=12.02..34.18 rows=6 width=48)
--    Recheck Cond: (search_vector @@ ...)
--    ->  Bitmap Index Scan on idx_notes_search_vector  (cost=0.00..12.01 rows=6)
```

**Read the two words that matter: `Seq Scan` became `Bitmap Index Scan`.** On a seeded
database of six notes the timings will be indistinguishable — PostgreSQL may even
correctly prefer the sequential scan, because for six rows it *is* faster. To see the
difference, generate volume first:

```sql
INSERT INTO notes (creator_id, title, content)
SELECT '00000000-0000-0000-0000-000000000001',
       'Note ' || i,
       '<p>' || md5(random()::text) || ' normalization dependency</p>'
FROM generate_series(1, 10000) AS i;
ANALYZE notes;
```

> **A planner honesty note.** `EXPLAIN` shows the *estimated* plan; `EXPLAIN ANALYZE`
> actually runs the query and reports real times and real row counts. Compare
> `rows=` (estimate) against `actual rows=` — a large divergence means the statistics
> are stale and the planner is choosing badly on bad information. `ANALYZE` fixes it.
> That comparison is the single most useful debugging skill in query tuning.

---

## 3.3 Views

A view is a stored query with a name. It is not a copy of the data — PostgreSQL
substitutes the definition into your query at plan time.

**Why they earn their place here:** the graph statistics query is a triple aggregation
that appears in the note detail page, the dashboard, and the orphan report. Written
three times it drifts three ways. Written once as a view, the definition is in the
migration and every caller gets the same answer.

### `backend/alembic/versions/003_views_functions_triggers.py` — views

```python
def upgrade() -> None:
    # ── V1. Per-note graph statistics ─────────────────────────────────────────
    # Correlated scalar subqueries rather than two LEFT JOINs and a GROUP BY:
    # joining both link directions to the same note multiplies the rows
    # (a note with 3 in and 4 out yields 12 rows), and the counts come out wrong
    # unless you use COUNT(DISTINCT ...). Scalar subqueries avoid the fan-out
    # entirely and read closer to the question being asked.
    op.execute("""
        CREATE OR REPLACE VIEW v_note_graph_stats AS
        SELECT
            n.id                AS note_id,
            n.creator_id,
            n.title,
            n.is_public,
            n.word_count,
            n.updated_at,
            (SELECT COUNT(*) FROM knowledge_links kl
              WHERE kl.source_note_id = n.id)          AS outgoing_count,
            (SELECT COUNT(*) FROM knowledge_links kl
              WHERE kl.target_note_id = n.id)          AS incoming_count,
            (SELECT COUNT(*) FROM knowledge_links kl
              WHERE kl.source_note_id = n.id
                 OR kl.target_note_id = n.id)          AS degree,
            (SELECT COUNT(*) FROM note_versions v
              WHERE v.note_id = n.id)                  AS version_count
        FROM notes n
    """)

    # ── V2. Ranked search ─────────────────────────────────────────────────────
    # ts_rank_cd weights title matches above body matches, because the generated
    # column applied setweight 'A' to the title and 'B' to the content.
    # The array is {D, C, B, A} — so B = 0.4, A = 1.0.
    op.execute("""
        CREATE OR REPLACE VIEW v_note_search AS
        SELECT
            n.id,
            n.creator_id,
            n.title,
            n.is_public,
            n.updated_at,
            n.search_vector,
            ts_headline('english',
                        regexp_replace(COALESCE(n.content, ''), '<[^>]+>', ' ', 'g'),
                        websearch_to_tsquery('english', ''),
                        'MaxWords=30, MinWords=15') AS snippet
        FROM notes n
        WHERE n.archived = FALSE
    """)

    # ── V3. User dashboard ────────────────────────────────────────────────────
    # FILTER is the cleaner form of COUNT(CASE WHEN ... THEN 1 END) and is
    # SQL-standard. One pass over the table produces every counter.
    op.execute("""
        CREATE OR REPLACE VIEW v_user_dashboard AS
        SELECT
            u.id                                             AS user_id,
            u.display_name,
            COUNT(DISTINCT n.id)                             AS total_notes,
            COUNT(DISTINCT n.id) FILTER (WHERE n.pinned)     AS pinned_notes,
            COUNT(DISTINCT n.id) FILTER (WHERE n.archived)   AS archived_notes,
            COUNT(DISTINCT n.id) FILTER (WHERE n.is_public)  AS public_notes,
            COALESCE(SUM(n.word_count), 0)                   AS total_words,
            COUNT(DISTINCT w.id)                             AS workspace_count,
            COUNT(DISTINCT kl.id)                            AS link_count,
            MAX(n.updated_at)                                AS last_edited_at
        FROM users u
        LEFT JOIN notes            n  ON n.creator_id = u.id
        LEFT JOIN workspaces       w  ON w.owner_id   = u.id
        LEFT JOIN knowledge_links  kl ON kl.created_by = u.id
        GROUP BY u.id, u.display_name
    """)

    # ── V4. Orphan notes — connected to nothing ───────────────────────────────
    # NOT EXISTS rather than NOT IN: NOT IN returns NO ROWS AT ALL if the
    # subquery yields a single NULL, because NULL comparison is unknown, not
    # false. That is a classic silent-wrong-answer bug. NOT EXISTS is immune.
    op.execute("""
        CREATE OR REPLACE VIEW v_orphan_notes AS
        SELECT n.id, n.creator_id, n.title, n.created_at, n.word_count
        FROM notes n
        WHERE n.archived = FALSE
          AND NOT EXISTS (
              SELECT 1 FROM knowledge_links kl
              WHERE kl.source_note_id = n.id OR kl.target_note_id = n.id
          )
    """)
```

> **Viva question:** *Why `NOT EXISTS` and not `NOT IN`?*
>
> "If the subquery returns even one NULL, `NOT IN` evaluates to unknown for every row
> and the whole query returns nothing — silently, with no error. `x NOT IN (1, NULL)`
> is not false, it is unknown, because SQL cannot prove `x <> NULL`. `NOT EXISTS` tests
> whether rows exist, which is a plain boolean, so NULLs are irrelevant. It is also
> usually planned as an anti-join, which is faster."

> **Viva question:** *Does a view improve performance?*
>
> "A regular view does not — it is a macro that is substituted into the query before
> planning, so the same work happens. What it improves is correctness and maintenance:
> one definition, one place to fix. A **materialized** view *does* improve performance
> because it stores the result, but the result goes stale until `REFRESH MATERIALIZED
> VIEW`. I chose regular views because this data changes constantly and must be current.
> If the dashboard aggregate became slow at scale, a materialized view refreshed every
> few minutes would be the right next step — trading freshness for speed deliberately."

---

## 3.4 Triggers

A trigger is a function PostgreSQL runs automatically when a table changes. It is the
strongest available guarantee that a rule applies to *every* writer.

> **The design rule for this project:** a trigger is right when the invariant must hold
> regardless of who writes. It is wrong when it hides business logic that a reader of
> the application code needs to see. Version history, notifications, and audit logging
> are all "must happen no matter what" — so they are triggers. Authorization is not,
> because a reader of the route must be able to see it.

### T1 — Automatic version history

```python
    op.execute("""
        CREATE OR REPLACE FUNCTION fn_create_note_version()
        RETURNS TRIGGER
        LANGUAGE plpgsql
        AS $$
        BEGIN
            -- Only version real content changes. IS DISTINCT FROM is NULL-safe:
            -- plain <> returns NULL when either side is NULL, and a NULL condition
            -- is not true, so a note gaining its first content would never version.
            IF NEW.title   IS DISTINCT FROM OLD.title
            OR NEW.content IS DISTINCT FROM OLD.content THEN

                INSERT INTO note_versions (note_id, version_num, title, content, edited_by)
                VALUES (
                    OLD.id,
                    COALESCE(
                        (SELECT MAX(version_num) FROM note_versions WHERE note_id = OLD.id),
                        0
                    ) + 1,
                    OLD.title,      -- the PREVIOUS state — this is what rollback restores
                    OLD.content,
                    OLD.creator_id
                );
            END IF;
            RETURN NEW;
        END;
        $$
    """)

    op.execute("""
        CREATE TRIGGER trg_notes_create_version
            BEFORE UPDATE ON notes
            FOR EACH ROW
            EXECUTE FUNCTION fn_create_note_version()
    """)
```

**The version stores `OLD`, not `NEW`.** A version row is a snapshot of what the note
looked like *before* this edit. That is what makes rollback meaningful: restoring
version 3 restores the state that existed before edit 4. Storing `NEW` would duplicate
the current row and make version 1 unreachable.

> **Viva question — and this one is a trap worth being ready for:** *Two users edit the
> same note simultaneously. `MAX(version_num) + 1` reads then writes. Isn't that a lost
> update race?*
>
> "No, and the reason is the trigger's timing. It is `BEFORE UPDATE ... FOR EACH ROW` on
> `notes`, so it only runs inside an `UPDATE` that has already acquired a **row-level
> exclusive lock** on that note. A second transaction updating the same note blocks at
> the `UPDATE` — before its trigger ever fires — until the first commits. The two
> `MAX()` reads are therefore serialized by the lock the UPDATE already holds; they
> cannot interleave.
>
> The unique constraint `(note_id, version_num)` is still there as a backstop, so if
> anyone later rewrites this as an `AFTER` trigger or a separate statement, the failure
> is a loud constraint violation rather than a silently overwritten version."

*(This project's own audit initially flagged this as a race. It is not one. Working out
why is more instructive than the fix would have been — and being able to explain why a
plausible-sounding bug is not a bug is exactly what a viva is testing.)*

### T2 — Notify on inbound link

```python
    op.execute("""
        CREATE OR REPLACE FUNCTION fn_notify_on_link()
        RETURNS TRIGGER
        LANGUAGE plpgsql
        AS $$
        DECLARE
            v_target_owner UUID;
            v_target_title VARCHAR(255);
            v_source_title VARCHAR(255);
        BEGIN
            SELECT creator_id, title INTO v_target_owner, v_target_title
            FROM notes WHERE id = NEW.target_note_id;

            -- Do not notify people about their own actions.
            IF v_target_owner IS NOT NULL AND v_target_owner <> NEW.created_by THEN
                SELECT title INTO v_source_title FROM notes WHERE id = NEW.source_note_id;

                INSERT INTO notifications (user_id, type, title, body, link_url)
                VALUES (
                    v_target_owner,
                    'link_created',
                    'Someone linked to your note',
                    format('"%s" now links to your note "%s"',
                           COALESCE(v_source_title, 'A note'), v_target_title),
                    format('/notes/%s', NEW.target_note_id)
                );
            END IF;
            RETURN NEW;
        END;
        $$
    """)

    op.execute("""
        CREATE TRIGGER trg_knowledge_links_notify
            AFTER INSERT ON knowledge_links
            FOR EACH ROW
            EXECUTE FUNCTION fn_notify_on_link()
    """)
```

**`AFTER INSERT`, not `BEFORE`.** The notification should only exist if the link
actually got stored. A `BEFORE` trigger runs before constraints are checked — including
the composite FK enforcing [ADR-007](../../adr/0007-links-originate-from-owned-notes.md) — so a rejected link
would still have produced a notification. `AFTER` runs once the row is committed to the
statement.

**This trigger is the reason ADR-007 matters.** Because edges can only originate from
notes you own, "someone linked to your note" is always true when this fires. If anyone
could create an edge in either direction, the notification would be meaningless.

### T3 — Activity log

```python
    op.execute("""
        CREATE OR REPLACE FUNCTION fn_log_note_activity()
        RETURNS TRIGGER
        LANGUAGE plpgsql
        AS $$
        DECLARE
            v_action VARCHAR(50);
            v_row    notes%ROWTYPE;
        BEGIN
            IF TG_OP = 'DELETE' THEN
                v_action := 'delete';
                v_row    := OLD;
            ELSIF TG_OP = 'UPDATE' THEN
                v_action := 'update';
                v_row    := NEW;
            ELSE
                v_action := 'create';
                v_row    := NEW;
            END IF;

            -- NOTE: the column is "metadata". The SQLAlchemy ATTRIBUTE is metadata_
            -- only because `metadata` is reserved on DeclarativeBase. Triggers are
            -- SQL and must use the SQL name. Getting this wrong makes every write
            -- to notes fail at runtime.
            INSERT INTO activity_logs (user_id, action_type, entity_type, entity_id, metadata)
            VALUES (
                v_row.creator_id,
                v_action,
                'note',
                v_row.id,
                jsonb_build_object(
                    'title',      v_row.title,
                    'word_count', v_row.word_count,
                    'is_public',  v_row.is_public
                )
            );

            RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
        END;
        $$
    """)

    op.execute("""
        CREATE TRIGGER trg_notes_activity_log
            AFTER INSERT OR UPDATE OR DELETE ON notes
            FOR EACH ROW
            EXECUTE FUNCTION fn_log_note_activity()
    """)
```

**`TG_OP` lets one function serve three events.** Three near-identical functions would
drift; this is the same one-definition instinct as the views.

**A `DELETE` trigger must `RETURN OLD`.** Returning `NEW` — which is `NULL` during a
delete — in a `BEFORE` trigger silently cancels the operation. Here the trigger is
`AFTER`, so the return value is ignored, but writing it correctly means the function
still behaves if someone later changes the timing.

### Prove the trigger fires

```sql
UPDATE notes SET content = '<p>Rewritten entirely.</p>'
WHERE title = 'Normalization';

SELECT version_num, title, left(content, 40) AS content_preview, created_at
FROM note_versions
WHERE note_id = (SELECT id FROM notes WHERE title = 'Normalization');
--  version_num |    title      |          content_preview
--  ------------+---------------+-----------------------------------
--            1 | Normalization | <p>Organizing tables to reduce red

SELECT action_type, entity_type, metadata->>'title' AS title
FROM activity_logs ORDER BY id DESC LIMIT 1;
--  update | note | Normalization
```

**No application code ran.** That single fact is the most persuasive thing you can
demonstrate in the viva, and Phase 6 turns it into an automated test.

---

## 3.5 Stored procedures and functions

> **Terminology, because examiners ask.** PostgreSQL has both. A **function** (`CREATE
> FUNCTION`) returns a value and runs inside the caller's transaction. A **procedure**
> (`CREATE PROCEDURE`, PostgreSQL 11+) returns nothing, is invoked with `CALL`, and can
> manage transactions itself with `COMMIT`/`ROLLBACK`. Use a function when you want a
> result; a procedure when you want a self-contained unit of work.

### P1 — Rollback a note to a previous version

```python
    op.execute("""
        CREATE OR REPLACE PROCEDURE sp_rollback_note_version(
            p_note_id     UUID,
            p_version_num INTEGER,
            p_actor_id    UUID
        )
        LANGUAGE plpgsql
        AS $$
        DECLARE
            v_title   VARCHAR(255);
            v_content TEXT;
            v_owner   UUID;
        BEGIN
            SELECT creator_id INTO v_owner FROM notes WHERE id = p_note_id;
            IF v_owner IS NULL THEN
                RAISE EXCEPTION 'Note % does not exist', p_note_id
                    USING ERRCODE = 'no_data_found';
            END IF;

            -- Defence in depth. The service layer checks this too; a procedure that
            -- can be CALLed from psql must not rely on the caller having checked.
            IF v_owner <> p_actor_id THEN
                RAISE EXCEPTION 'User % may not roll back note %', p_actor_id, p_note_id
                    USING ERRCODE = 'insufficient_privilege';
            END IF;

            SELECT title, content INTO v_title, v_content
            FROM note_versions
            WHERE note_id = p_note_id AND version_num = p_version_num;

            IF NOT FOUND THEN
                RAISE EXCEPTION 'Version % of note % does not exist',
                    p_version_num, p_note_id USING ERRCODE = 'no_data_found';
            END IF;

            -- This UPDATE fires trg_notes_create_version, so the state being
            -- replaced is itself versioned first. Rollback is never destructive.
            UPDATE notes
               SET title = v_title, content = v_content, updated_at = now()
             WHERE id = p_note_id;
        END;
        $$
    """)
```

**The rollback is itself versioned.** Because the procedure performs an ordinary
`UPDATE`, the versioning trigger fires and captures the pre-rollback state. You can roll
back a rollback. Composing a procedure out of operations that already carry their own
guarantees is the point of putting the logic in the database at all.

### P2 — Maximum reachable depth from a note

```python
    op.execute("""
        CREATE OR REPLACE FUNCTION fn_max_graph_depth(p_note_id UUID)
        RETURNS INTEGER
        LANGUAGE sql
        STABLE
        AS $$
            WITH RECURSIVE reachable AS (
                SELECT n.id, 0 AS depth, ARRAY[n.id] AS path
                FROM notes n WHERE n.id = p_note_id

                UNION ALL

                SELECT nxt.id, r.depth + 1, r.path || nxt.id
                FROM reachable r
                JOIN knowledge_links kl
                  ON kl.source_note_id = r.id OR kl.target_note_id = r.id
                JOIN notes nxt
                  ON nxt.id = CASE WHEN kl.source_note_id = r.id
                                   THEN kl.target_note_id
                                   ELSE kl.source_note_id END
                WHERE r.depth < 10
                  AND nxt.id <> ALL(r.path)
            )
            SELECT COALESCE(MAX(depth), 0) FROM reachable;
        $$
    """)
```

**`LANGUAGE sql` and `STABLE`.** A pure-SQL function can be inlined by the planner,
which a PL/pgSQL one cannot. `STABLE` tells PostgreSQL the result does not change within
a single statement, permitting further optimisation. Declaring volatility correctly is
free performance, and getting it wrong (`VOLATILE` when it need not be) silently blocks
the planner.

### P3 — Shortest path between two notes

```python
    op.execute("""
        CREATE OR REPLACE FUNCTION fn_shortest_path(p_from UUID, p_to UUID)
        RETURNS TABLE (step INTEGER, note_id UUID, title VARCHAR(255))
        LANGUAGE plpgsql
        STABLE
        AS $$
        DECLARE
            v_path UUID[];
        BEGIN
            WITH RECURSIVE search AS (
                SELECT n.id, 0 AS depth, ARRAY[n.id] AS path
                FROM notes n WHERE n.id = p_from

                UNION ALL

                SELECT nxt.id, s.depth + 1, s.path || nxt.id
                FROM search s
                JOIN knowledge_links kl
                  ON kl.source_note_id = s.id OR kl.target_note_id = s.id
                JOIN notes nxt
                  ON nxt.id = CASE WHEN kl.source_note_id = s.id
                                   THEN kl.target_note_id
                                   ELSE kl.source_note_id END
                WHERE s.depth < 10
                  AND nxt.id <> ALL(s.path)
            )
            SELECT path INTO v_path
            FROM search WHERE id = p_to
            ORDER BY depth LIMIT 1;      -- breadth-first order ⇒ first hit is shortest

            IF v_path IS NULL THEN
                RETURN;                  -- no path: empty result, not an error
            END IF;

            RETURN QUERY
            SELECT ordinality::INTEGER - 1, n.id, n.title
            FROM unnest(v_path) WITH ORDINALITY AS u(nid, ordinality)
            JOIN notes n ON n.id = u.nid
            ORDER BY ordinality;
        END;
        $$
    """)
```

**Why `ORDER BY depth LIMIT 1` gives the shortest path.** A recursive CTE expands
breadth-first: every node at depth *k* is produced before any node at depth *k+1*. So
the first row reaching the target carries a minimum-length path. This is
breadth-first search, expressed declaratively — and it is exactly why BFS finds shortest
paths in an unweighted graph.

**`unnest(...) WITH ORDINALITY`** turns the path array back into ordered rows.
Without `WITH ORDINALITY` the array order is lost, because SQL result sets are unordered
unless you say otherwise.

```sql
CALL sp_rollback_note_version('<note-id>', 1, '<user-id>');
SELECT fn_max_graph_depth('<note-id>');
SELECT * FROM fn_shortest_path('<normalization-id>', '<bcnf-id>');
--  step | note_id | title
--     0 |   ...   | Normalization
--     1 |   ...   | Functional Dependency
--     2 |   ...   | Third Normal Form
--     3 |   ...   | BCNF
```

---

## 3.6 The recursive CTE — the heart of the project

This is the query to be able to write on a whiteboard and explain line by line.

```sql
WITH RECURSIVE connected_graph AS (
    -- ANCHOR: the starting note, at depth 0.
    SELECT
        n.id,
        n.title,
        n.is_public,
        n.creator_id,
        0                AS depth,
        ARRAY[n.id]      AS visited_path,
        NULL::UUID       AS via_link_id
    FROM notes n
    WHERE n.id = :root_id

    UNION ALL

    -- RECURSIVE TERM: everything one hop from what we already have.
    SELECT
        nxt.id,
        nxt.title,
        nxt.is_public,
        nxt.creator_id,
        g.depth + 1,
        g.visited_path || nxt.id,
        kl.id
    FROM connected_graph g
    JOIN knowledge_links kl
      ON kl.source_note_id = g.id OR kl.target_note_id = g.id
    JOIN notes nxt
      ON nxt.id = CASE WHEN kl.source_note_id = g.id
                       THEN kl.target_note_id
                       ELSE kl.source_note_id END
    WHERE g.depth < :max_depth              -- (1) bound the work
      AND nxt.id <> ALL(g.visited_path)     -- (2) never revisit — prevents cycles
)
SELECT DISTINCT ON (id)
    id, title, is_public, creator_id, depth
FROM connected_graph
ORDER BY id, depth;                          -- (3) keep the shallowest occurrence
```

### How it executes

PostgreSQL evaluates this iteratively, not by magic:

```
1. Run the anchor.  Working table = {Normalization(d0)}.  Result = that.
2. Run the recursive term against the WORKING TABLE only (not the whole result).
   New rows = {Functional Dependency(d1), Denormalization(d1)}.
   Append to result; these become the new working table.
3. Repeat.  New rows = {Third Normal Form(d2), Indexing(d2)}.
4. Repeat.  New rows = {BCNF(d3)}.
5. depth < 3 is now false for every row → no new rows → the working table is empty
   → STOP.
```

> **The single most common misunderstanding:** the recursive term reads the rows added
> by the *previous iteration*, not the accumulated result. That is why it terminates,
> and why "recursive" is arguably a misnomer — it is iteration to a fixed point.

### The three clauses that make it safe

**(1) `g.depth < :max_depth`** bounds the work. A densely connected graph explodes
combinatorially; `GRAPH_MAX_DEPTH` is capped at 6 in settings (§1.6) so a request cannot
ask for unbounded traversal.

**(2) `nxt.id <> ALL(g.visited_path)`** is cycle prevention, and it is not optional.
The graph is genuinely cyclic — A references B, B references C, C references A is a
normal thing for a user to create. Without this line, that triangle produces rows
forever until the query is killed or the server runs out of memory. Carrying the path as
an array and refusing to revisit any node in it is the standard technique.

**(3) `DISTINCT ON (id) ... ORDER BY id, depth`** collapses duplicates. A note reachable
by two different routes appears twice, at two depths. `DISTINCT ON` is a PostgreSQL
extension that keeps the first row per group *as ordered*, so ordering by `depth`
ascending keeps the shortest distance. Standard SQL would need a window function:
`ROW_NUMBER() OVER (PARTITION BY id ORDER BY depth) = 1`.

> **Viva question:** *What happens without the cycle check?*
>
> "Infinite recursion. The graph is user-created and genuinely cyclic — three notes
> referencing each other in a loop is normal. Each iteration would rediscover nodes
> already visited and the working table would never empty. PostgreSQL has no automatic
> depth limit on a recursive CTE, so the query runs until it exhausts memory or is
> cancelled. I prevent it by carrying the visited nodes as an array and requiring each
> new node to not be in it. The depth limit is a second, independent bound — belt and
> braces, because they fail differently."

> **Viva question:** *Why `UNION ALL` and not `UNION`?*
>
> "`UNION` deduplicates, which means sorting or hashing every intermediate result on
> every iteration — expensive, and here it would also hide the depth information I want,
> since the same note at two depths are different rows. `UNION ALL` just concatenates.
> The cycle check already prevents the runaway duplication that `UNION` would otherwise
> be suppressing, so I get correctness from the `WHERE` clause and speed from
> `UNION ALL`. Using `UNION` to control recursion instead would be relying on a side
> effect rather than saying what I mean."

---

## 3.7 The fifteen queries

Every CO1 construct, one query each. These go in `docs/queries.sql` **and** are
referenced from [`08-VIVA.md`](08-VIVA.md) by number.

> The previous doc set cited "Q4" twice in its learning guide while asserting that all
> fifteen queries were written out in full. Q4 did not exist. Every query below is
> present, numbered, and runnable against the seeded database.

### Q1 — Multi-table INNER JOIN

```sql
-- Notes with their notebook and workspace. Three-table join.
SELECT w.name AS workspace, nb.name AS notebook, n.title, n.word_count
FROM notes n
JOIN notebooks  nb ON nb.id = n.notebook_id
JOIN workspaces w  ON w.id  = nb.workspace_id
WHERE n.creator_id = :user_id
ORDER BY w.name, nb.name, n.title;
```

### Q2 — LEFT JOIN with COUNT and GROUP BY

```sql
-- Every notebook, including empty ones. LEFT JOIN is what includes the zeros.
SELECT nb.id, nb.name, COUNT(n.id) AS note_count
FROM notebooks nb
LEFT JOIN notes n ON n.notebook_id = nb.id AND n.archived = FALSE
WHERE nb.owner_id = :user_id
GROUP BY nb.id, nb.name
ORDER BY note_count DESC;
```

**`AND n.archived = FALSE` is in the `ON`, not the `WHERE`.** In the `WHERE` clause it
would filter out the `NULL` rows that `LEFT JOIN` produces for empty notebooks, silently
turning the outer join back into an inner one. This is the classic LEFT JOIN mistake and
a very likely exam question.

### Q3 — GROUP BY with HAVING

```sql
-- Notebooks that are actually substantial: 3+ notes averaging over 50 words.
SELECT nb.name, COUNT(n.id) AS note_count, ROUND(AVG(n.word_count), 1) AS avg_words
FROM notebooks nb
JOIN notes n ON n.notebook_id = nb.id
WHERE nb.owner_id = :user_id
GROUP BY nb.id, nb.name
HAVING COUNT(n.id) >= 3 AND AVG(n.word_count) > 50
ORDER BY avg_words DESC;
```

**`WHERE` filters rows before grouping; `HAVING` filters groups after.** You cannot put
`COUNT(*)` in a `WHERE` because the count does not exist yet.

### Q4 — Scalar subquery in the SELECT list

```sql
-- Each note against the user's own average, as a percentage.
SELECT
    n.title,
    n.word_count,
    (SELECT ROUND(AVG(word_count), 1) FROM notes WHERE creator_id = :user_id)
        AS user_average,
    ROUND(
        100.0 * n.word_count
        / NULLIF((SELECT AVG(word_count) FROM notes WHERE creator_id = :user_id), 0),
        1
    ) AS percent_of_average
FROM notes n
WHERE n.creator_id = :user_id
ORDER BY n.word_count DESC;
```

**`NULLIF(..., 0)` prevents division by zero.** If the user has no notes the average is
`NULL`; if every note is empty it is 0 and the division raises. `NULLIF` turns the 0
into `NULL`, and `NULL` division yields `NULL` rather than an error.

### Q5 — Correlated subquery

```sql
-- Notes edited more often than the average for their own notebook.
-- Correlated: the inner query references n1 from the outer, so it is
-- conceptually re-evaluated per row.
SELECT n1.title, n1.notebook_id,
       (SELECT COUNT(*) FROM note_versions v WHERE v.note_id = n1.id) AS versions
FROM notes n1
WHERE n1.creator_id = :user_id
  AND (SELECT COUNT(*) FROM note_versions v WHERE v.note_id = n1.id) >
      (SELECT AVG(vc) FROM (
           SELECT COUNT(*) AS vc
           FROM note_versions v2
           JOIN notes n2 ON n2.id = v2.note_id
           WHERE n2.notebook_id = n1.notebook_id      -- ← the correlation
           GROUP BY v2.note_id
       ) AS per_note)
ORDER BY versions DESC;
```

### Q6 — EXISTS

```sql
-- Notes that have at least one outgoing link. EXISTS stops at the first match.
SELECT n.id, n.title
FROM notes n
WHERE n.creator_id = :user_id
  AND EXISTS (SELECT 1 FROM knowledge_links kl WHERE kl.source_note_id = n.id);
```

**`SELECT 1`, not `SELECT *`.** `EXISTS` only tests whether a row is produced; the
columns are never read. Either works, but `SELECT 1` says what you mean.

### Q7 — CASE expression

```sql
-- Bucket notes by length.
SELECT
    n.title,
    n.word_count,
    CASE
        WHEN n.word_count = 0            THEN 'empty'
        WHEN n.word_count < 100          THEN 'short'
        WHEN n.word_count < 500          THEN 'medium'
        ELSE                                  'long'
    END AS length_category
FROM notes n
WHERE n.creator_id = :user_id
ORDER BY n.word_count DESC;
```

### Q8 — Non-recursive CTE

```sql
-- Two named subresults, composed. Readable top-to-bottom instead of nested inside-out.
WITH note_stats AS (
    SELECT creator_id, COUNT(*) AS note_count, SUM(word_count) AS total_words
    FROM notes WHERE archived = FALSE GROUP BY creator_id
),
link_stats AS (
    SELECT created_by, COUNT(*) AS link_count
    FROM knowledge_links GROUP BY created_by
)
SELECT u.display_name,
       COALESCE(ns.note_count, 0)  AS notes,
       COALESCE(ns.total_words, 0) AS words,
       COALESCE(ls.link_count, 0)  AS links,
       ROUND(COALESCE(ls.link_count, 0)::numeric
             / NULLIF(ns.note_count, 0), 2) AS links_per_note
FROM users u
LEFT JOIN note_stats ns ON ns.creator_id = u.id
LEFT JOIN link_stats ls ON ls.created_by = u.id
ORDER BY notes DESC;
```

### Q9 — Window function: ROW_NUMBER with PARTITION BY

```sql
-- The three longest notes in EACH notebook. Not the three longest overall.
SELECT * FROM (
    SELECT
        nb.name AS notebook,
        n.title,
        n.word_count,
        ROW_NUMBER() OVER (PARTITION BY n.notebook_id ORDER BY n.word_count DESC) AS rn
    FROM notes n
    JOIN notebooks nb ON nb.id = n.notebook_id
    WHERE n.creator_id = :user_id
) ranked
WHERE rn <= 3
ORDER BY notebook, rn;
```

**The subquery is required.** A window function is evaluated *after* `WHERE`, so you
cannot filter on `rn` in the same query level. This "why do I need the wrapper" question
is asked constantly.

### Q10 — Window function: RANK vs DENSE_RANK

```sql
-- The difference matters when there are ties.
SELECT
    n.title,
    n.word_count,
    RANK()       OVER (ORDER BY n.word_count DESC) AS rank,        -- 1,2,2,4
    DENSE_RANK() OVER (ORDER BY n.word_count DESC) AS dense_rank,  -- 1,2,2,3
    ROW_NUMBER() OVER (ORDER BY n.word_count DESC) AS row_number   -- 1,2,3,4
FROM notes n
WHERE n.creator_id = :user_id;
```

> **Viva question:** *Difference between RANK, DENSE_RANK, and ROW_NUMBER?*
>
> "All three number the rows. `ROW_NUMBER` is always 1,2,3,4 — ties are broken
> arbitrarily. `RANK` gives tied rows the same number then *skips*: 1,2,2,4. `DENSE_RANK`
> gives tied rows the same number and does not skip: 1,2,2,3. Use `RANK` for competition
> standings where two silver medals mean no bronze; `DENSE_RANK` when you want
> consecutive levels; `ROW_NUMBER` when you need a unique number per row."

### Q11 — Window function: running total with a frame

```sql
-- Cumulative words written over time.
SELECT
    n.created_at::date AS day,
    n.title,
    n.word_count,
    SUM(n.word_count) OVER (
        ORDER BY n.created_at
        ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
    ) AS running_total
FROM notes n
WHERE n.creator_id = :user_id
ORDER BY n.created_at;
```

**The frame clause is explicit on purpose.** With `ORDER BY` and no frame, the default
is `RANGE BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW`, which includes *all peer rows
with the same ORDER BY value* — so notes created in the same instant would all show the
same total. `ROWS` counts physical rows instead. The `RANGE` vs `ROWS` distinction is a
favourite exam question precisely because the default surprises people.

### Q12 — Window function: LAG for change over time

```sql
-- How much each edit changed the note, comparing consecutive versions.
SELECT
    v.version_num,
    length(v.content)                                AS length,
    LAG(length(v.content)) OVER w                    AS previous_length,
    length(v.content) - LAG(length(v.content)) OVER w AS delta,
    v.created_at
FROM note_versions v
WHERE v.note_id = :note_id
WINDOW w AS (ORDER BY v.version_num)
ORDER BY v.version_num;
```

**The `WINDOW` clause names a window definition** so it is written once and reused
three times. Repeating `OVER (ORDER BY v.version_num)` three times is how the three
copies eventually disagree.

### Q13 — Aggregate FILTER and self-join

```sql
-- For each relationship type: how many links, and how many are reciprocated
-- (A→B where B→A also exists). The self-join is knowledge_links to itself.
SELECT
    rt.name                                                   AS relationship,
    COUNT(*)                                                  AS total,
    COUNT(*) FILTER (WHERE reciprocal.id IS NOT NULL)         AS reciprocated,
    ROUND(AVG(kl.strength), 2)                                AS avg_strength,
    COUNT(*) FILTER (WHERE kl.strength >= 8)                  AS strong_links
FROM knowledge_links kl
JOIN relationship_types rt ON rt.id = kl.rel_type_id
LEFT JOIN knowledge_links reciprocal
       ON reciprocal.source_note_id = kl.target_note_id
      AND reciprocal.target_note_id = kl.source_note_id
WHERE kl.created_by = :user_id
GROUP BY rt.id, rt.name
ORDER BY total DESC;
```

**`FILTER` versus `COUNT(CASE WHEN ...)`.** Both work. `FILTER` is SQL-standard, reads
as what it is, and cannot be accidentally written as `COUNT(CASE WHEN x THEN 0 END)` —
which counts *every* non-null result including the zero, and is a real bug people ship.

### Q14 — JSONB operators

```sql
-- Query inside the activity log's JSONB payload.
SELECT
    al.action_type,
    al.metadata ->> 'title'                    AS note_title,      -- ->> returns text
    (al.metadata ->> 'word_count')::int        AS word_count,      -- -> returns jsonb
    al.metadata -> 'is_public'                 AS is_public_json,
    al.created_at
FROM activity_logs al
WHERE al.user_id = :user_id
  AND al.metadata ? 'word_count'                                    -- key exists
  AND (al.metadata ->> 'word_count')::int > 100
  AND al.metadata @> '{"is_public": true}'::jsonb                   -- containment
ORDER BY al.created_at DESC
LIMIT 20;
```

> **Viva question:** *`->` versus `->>`?*
>
> "`->` returns JSONB, so it can be chained: `metadata -> 'a' -> 'b'`. `->>` returns
> text, so it is terminal but can be cast or compared to a string. Using `->` where you
> meant `->>` gives you `"value"` with the quotes included, which then fails to compare
> equal to `value` — a bug that looks like a data problem."

> **Viva question:** *JSONB or JSON?*
>
> "`JSON` stores the text verbatim and reparses on every access. `JSONB` stores a parsed
> binary form: slightly slower to write, much faster to read, supports indexing with
> GIN, and supports the containment operator `@>`. It does not preserve key order or
> whitespace and deduplicates keys. For anything you query, `JSONB`. `JSON` only if you
> must reproduce the original document byte for byte."

### Q15 — Full-text search with ranking

```sql
-- Weighted, ranked search with highlighted snippets.
SELECT
    n.id,
    n.title,
    ts_rank_cd(n.search_vector, q.query) AS rank,
    ts_headline('english',
                regexp_replace(COALESCE(n.content, ''), '<[^>]+>', ' ', 'g'),
                q.query,
                'StartSel=<mark>, StopSel=</mark>, MaxWords=30, MinWords=15') AS snippet
FROM notes n,
     websearch_to_tsquery('english', :search_term) AS q(query)
WHERE n.search_vector @@ q.query                    -- @@ uses the GIN index
  AND n.archived = FALSE
  AND (n.creator_id = :user_id OR n.is_public = TRUE)
ORDER BY rank DESC
LIMIT 20;
```

**`websearch_to_tsquery`, not `to_tsquery`.** `to_tsquery` requires strict syntax and
raises a syntax error on ordinary user input like `hello world` — an unquoted space is
invalid. `websearch_to_tsquery` accepts what people actually type, including quoted
phrases and `or`/`-` operators, and never raises on malformed input.

**`ts_rank_cd` rather than `ts_rank`.** The `cd` variant accounts for *cover density* —
how close the matched terms are to each other — so a note where both search terms appear
in the same sentence ranks above one where they appear in different paragraphs.

**`(n.creator_id = :user_id OR n.is_public = TRUE)`** — the authorization predicate is
in the query, not applied afterwards in Python. Filtering in the database means the
`LIMIT 20` applies to rows the user may actually see; filtering afterwards would return
fewer than 20 results and leak the *existence* of other users' notes through the count.

---

## 3.8 Row Level Security

### Why this is not optional

The Supabase `anon` key ships to every browser. Anyone can open DevTools, take it, and
query your database directly with `supabase-js` — no FastAPI in the path, no service
layer, none of your authorization code.

**RLS is the boundary that still holds when the application is bypassed.** Without it,
`SELECT * FROM notes` from a browser returns every note belonging to every user. This
is [ADR-008](../../adr/0008-row-level-security.md), and it is the difference between a project
that demonstrates security and one that only demonstrates intent.

### `backend/alembic/versions/004_rls.py`

```python
def upgrade() -> None:
    # ── Every table that holds user data ──────────────────────────────────────
    for table in (
        "users", "workspaces", "notebooks", "notes", "knowledge_links",
        "note_versions", "tags", "note_tags", "collections", "collection_items",
        "flashcards", "resources", "activity_logs", "notifications",
    ):
        op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")

    # relationship_types is a shared lookup table: readable by all, writable by none.
    op.execute("ALTER TABLE relationship_types ENABLE ROW LEVEL SECURITY")
    op.execute("""
        CREATE POLICY relationship_types_read ON relationship_types
            FOR SELECT USING (TRUE)
    """)

    # ── notes ─────────────────────────────────────────────────────────────────
    # auth.uid() is a Supabase function returning the `sub` claim of the caller's
    # JWT. Because users.id IS that claim (ADR-013), it compares directly to
    # creator_id with no lookup.
    op.execute("""
        CREATE POLICY notes_select ON notes
            FOR SELECT USING (creator_id = auth.uid() OR is_public = TRUE)
    """)
    op.execute("""
        CREATE POLICY notes_insert ON notes
            FOR INSERT WITH CHECK (creator_id = auth.uid())
    """)
    op.execute("""
        CREATE POLICY notes_update ON notes
            FOR UPDATE USING (creator_id = auth.uid())
                       WITH CHECK (creator_id = auth.uid())
    """)
    op.execute("""
        CREATE POLICY notes_delete ON notes
            FOR DELETE USING (creator_id = auth.uid())
    """)

    # ── workspaces / notebooks ────────────────────────────────────────────────
    op.execute("""
        CREATE POLICY workspaces_all ON workspaces
            FOR ALL USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid())
    """)
    op.execute("""
        CREATE POLICY notebooks_all ON notebooks
            FOR ALL USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid())
    """)

    # ── knowledge_links: read either endpoint you can see; write only your own ─
    op.execute("""
        CREATE POLICY knowledge_links_select ON knowledge_links
            FOR SELECT USING (
                created_by = auth.uid()
                OR EXISTS (SELECT 1 FROM notes n
                            WHERE n.id = knowledge_links.target_note_id
                              AND (n.creator_id = auth.uid() OR n.is_public))
            )
    """)
    op.execute("""
        CREATE POLICY knowledge_links_write ON knowledge_links
            FOR ALL USING (created_by = auth.uid())
                       WITH CHECK (created_by = auth.uid())
    """)

    # ── Audit tables: readable by the subject, writable only by triggers ──────
    # No INSERT policy at all. The trigger functions run as SECURITY DEFINER
    # (owner rights), so they bypass RLS; no client can forge an audit row.
    op.execute("""
        CREATE POLICY activity_logs_select ON activity_logs
            FOR SELECT USING (user_id = auth.uid())
    """)
    op.execute("""
        CREATE POLICY notifications_select ON notifications
            FOR SELECT USING (user_id = auth.uid())
    """)
    op.execute("""
        CREATE POLICY notifications_update ON notifications
            FOR UPDATE USING (user_id = auth.uid())
                       WITH CHECK (user_id = auth.uid())
    """)

    # ── The remaining owner-scoped tables follow one shape ────────────────────
    for table, col in (
        ("tags", "user_id"), ("collections", "user_id"),
        ("note_tags", "owner_id"), ("collection_items", "owner_id"),
        ("flashcards", "owner_id"), ("resources", "owner_id"),
    ):
        op.execute(f"""
            CREATE POLICY {table}_all ON {table}
                FOR ALL USING ({col} = auth.uid())
                           WITH CHECK ({col} = auth.uid())
        """)

    # ── users: read yourself; the backend creates rows via the service role ───
    op.execute("""
        CREATE POLICY users_select ON users FOR SELECT USING (id = auth.uid())
    """)
    op.execute("""
        CREATE POLICY users_update ON users
            FOR UPDATE USING (id = auth.uid()) WITH CHECK (id = auth.uid())
    """)
```

> **`USING` versus `WITH CHECK` — expect to be asked.**
>
> `USING` filters rows the statement can **see** (SELECT, UPDATE, DELETE). `WITH CHECK`
> validates rows the statement tries to **write** (INSERT, UPDATE). `UPDATE` needs both:
> `USING` decides which rows you may target, `WITH CHECK` decides what they may become.
> With only `USING`, you could take a row you own and set `creator_id` to someone else's
> ID — giving your row away, or worse, moving someone else's row to yourself.

**A local-development caveat.** `auth.uid()` is defined by Supabase, not by stock
PostgreSQL, so these policies fail on the local container from [ADR-012](../../adr/0012-local-postgres-dev-supabase-prod.md).
Provide a local stand-in at the top of the migration:

```python
    # Locally, auth.uid() reads a session GUC. On Supabase, the real function
    # already exists and CREATE SCHEMA IF NOT EXISTS / OR REPLACE is a no-op change.
    op.execute("CREATE SCHEMA IF NOT EXISTS auth")
    op.execute("""
        CREATE OR REPLACE FUNCTION auth.uid() RETURNS UUID
        LANGUAGE sql STABLE
        AS $$ SELECT NULLIF(current_setting('request.jwt.claim.sub', TRUE), '')::UUID $$
    """)
```

**The backend connects as the table owner, which bypasses RLS.** That is intentional —
FastAPI has already verified the JWT and every service enforces ownership. RLS exists to
protect the *direct* path from the browser. Understanding that there are two paths, with
two different enforcement points, is the actual security model:

```
Browser ──(anon key)──────────────────► PostgreSQL     ← RLS enforces
Browser ──(JWT)──► FastAPI ──(owner)──► PostgreSQL     ← service layer enforces
```

### Prove RLS works

```sql
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
SELECT COUNT(*) FROM notes;     -- only this user's notes plus public ones

SET LOCAL request.jwt.claim.sub = '00000000-0000-0000-0000-000000000002';
SELECT COUNT(*) FROM notes;     -- a different, smaller number
RESET ROLE;
```

Same table, same query, different results by identity. That is the demo.

---

## 3.9 Phase 3 checklist

```
□ \di shows 10 indexes         □ \dv shows 4 views        □ \df shows 6 routines
□ EXPLAIN ANALYZE on search shows Bitmap Index Scan, not Seq Scan
□ EXPLAIN ANALYZE on the recursive CTE shows Index Scan on knowledge_links
□ UPDATE on a note creates exactly one note_versions row
□ Updating a note WITHOUT changing title or content creates NO version row
□ Linking to another user's public note creates a notification for them
□ Linking to your OWN note creates no notification
□ The recursive CTE terminates on a deliberately cyclic graph (A→B→C→A)
□ fn_shortest_path returns 4 steps from Normalization to BCNF
□ sp_rollback_note_version restores content AND creates a version of what it replaced
□ All 15 queries run against the seeded database
□ Two different request.jwt.claim.sub values return different row counts
□ `alembic downgrade base` removes every index, view, function, trigger, and policy
```

**Build the cyclic graph by hand and run the CTE against it.** It is the one check that
proves cycle prevention works, and it takes thirty seconds:

```sql
-- A → B → C → A
INSERT INTO knowledge_links (source_note_id, target_note_id, rel_type_id, created_by)
VALUES (:a, :b, 1, :user), (:b, :c, 1, :user), (:c, :a, 1, :user);
-- then run the CTE from §3.6 with :root_id = :a — it must return 3 rows and finish.
```

---

**Next:** [`04-API.md`](04-API.md) — schemas, repositories, services, and routes, with
every endpoint authorized.
