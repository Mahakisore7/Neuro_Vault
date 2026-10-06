"""views and graph functions

Revision ID: b7e2c4f9a031
Revises: a1d93e5b7c20
Create Date: 2026-10-06 11:00:00.000000

"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "b7e2c4f9a031"
down_revision: str | Sequence[str] | None = "a1d93e5b7c20"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Every view is created WITH (security_invoker = true). By default a view runs
# with its OWNER's privileges, which bypass row-level security - and Supabase
# exposes everything in `public` over its REST API, so a default view would be
# a way around RLS for anyone holding the browser's anon key. security_invoker
# (PostgreSQL 15+) makes the view check RLS as whoever is querying it.


def upgrade() -> None:
    """Upgrade schema."""
    # ── V1. Per-note graph statistics ─────────────────────────────────────────
    # Correlated scalar subqueries, not LEFT JOINs + GROUP BY: joining both link
    # directions and the versions to the same note multiplies rows (3 in x 4
    # out x 10 versions = 120 rows per note), and every COUNT comes out wrong.
    op.execute("""
        CREATE VIEW v_note_graph_stats WITH (security_invoker = true) AS
        SELECT
            n.id          AS note_id,
            n.creator_id,
            n.title,
            n.is_public,
            n.word_count,
            n.updated_at,
            (SELECT COUNT(*) FROM knowledge_links kl
              WHERE kl.source_note_id = n.id)                 AS outgoing_count,
            (SELECT COUNT(*) FROM knowledge_links kl
              WHERE kl.target_note_id = n.id)                 AS incoming_count,
            (SELECT COUNT(*) FROM knowledge_links kl
              WHERE kl.source_note_id = n.id
                 OR kl.target_note_id = n.id)                 AS degree,
            (SELECT COUNT(*) FROM note_versions v
              WHERE v.note_id = n.id)                         AS version_count
        FROM notes n
    """)

    # ── V2. Searchable notes ──────────────────────────────────────────────────
    # The original design put ts_headline(... websearch_to_tsquery('')) here,
    # but a view can't take the user's query as a parameter, so that column was
    # always a headline for an empty query. The view is instead the searchable
    # base - live notes with their HTML stripped once, in one place - and the
    # search query applies the user's tsquery on top of it.
    op.execute("""
        CREATE VIEW v_note_search WITH (security_invoker = true) AS
        SELECT
            n.id,
            n.creator_id,
            n.title,
            n.is_public,
            n.updated_at,
            n.search_vector,
            regexp_replace(COALESCE(n.content, ''), '<[^>]+>', ' ', 'g') AS plain_content
        FROM notes n
        WHERE n.archived = FALSE
    """)

    # ── V3. User dashboard ────────────────────────────────────────────────────
    # The original design LEFT JOINed notes, workspaces, and links in a single
    # FROM and used COUNT(DISTINCT ...). DISTINCT rescues the counts, but not
    # SUM(word_count): every note row is repeated once per workspace x link, so
    # 3 workspaces and 10 links reported 30x the real word count. Each table is
    # aggregated on its own in a LATERAL subquery instead - one row each, no
    # fan-out, and no DISTINCT needed. An aggregate with no GROUP BY always
    # returns exactly one row, so a user with nothing still gets zeros.
    op.execute("""
        CREATE VIEW v_user_dashboard WITH (security_invoker = true) AS
        SELECT
            u.id                    AS user_id,
            u.display_name,
            ns.total_notes,
            ns.pinned_notes,
            ns.public_notes,
            ns.archived_notes,
            ns.total_words,
            ns.last_edited_at,
            ws.workspace_count,
            ls.link_count,
            fc.total_cards,
            fc.cards_due
        FROM users u
        CROSS JOIN LATERAL (
            SELECT
                COUNT(*) FILTER (WHERE NOT archived)                AS total_notes,
                COUNT(*) FILTER (WHERE pinned AND NOT archived)     AS pinned_notes,
                COUNT(*) FILTER (WHERE is_public AND NOT archived)  AS public_notes,
                COUNT(*) FILTER (WHERE archived)                    AS archived_notes,
                COALESCE(SUM(word_count) FILTER (WHERE NOT archived), 0) AS total_words,
                MAX(updated_at)                                     AS last_edited_at
            FROM notes WHERE creator_id = u.id
        ) ns
        CROSS JOIN LATERAL (
            SELECT COUNT(*) AS workspace_count FROM workspaces WHERE owner_id = u.id
        ) ws
        CROSS JOIN LATERAL (
            SELECT COUNT(*) AS link_count FROM knowledge_links WHERE created_by = u.id
        ) ls
        CROSS JOIN LATERAL (
            -- Same rule as the review queue: a trashed note's cards are paused.
            SELECT
                COUNT(*)                                    AS total_cards,
                COUNT(*) FILTER (WHERE f.due_at <= now())   AS cards_due
            FROM flashcards f
            JOIN notes n ON n.id = f.note_id
            WHERE f.owner_id = u.id AND NOT n.archived
        ) fc
    """)

    # ── V4. Orphan notes - linked to nothing ──────────────────────────────────
    # NOT EXISTS, not NOT IN: if the subquery ever yields a NULL, NOT IN is
    # "unknown" for every row and the query silently returns nothing.
    op.execute("""
        CREATE VIEW v_orphan_notes WITH (security_invoker = true) AS
        SELECT n.id, n.creator_id, n.title, n.created_at, n.updated_at, n.word_count
        FROM notes n
        WHERE n.archived = FALSE
          AND NOT EXISTS (
              SELECT 1 FROM knowledge_links kl
              WHERE kl.source_note_id = n.id OR kl.target_note_id = n.id
          )
    """)

    # ── F1. Breadth-first distances from a note ───────────────────────────────
    # The original design (and the first graph endpoint) used a recursive CTE
    # that carries a visited array PER PATH. That stops cycles, but it still
    # enumerates every simple path, so on a densely linked graph the row count
    # grows exponentially with depth. This is a real breadth-first search: one
    # frontier per level, and a GLOBAL visited set, so each note is expanded
    # exactly once - O(notes + links) instead of O(paths).
    #
    # Each level is one set-based query over the whole frontier. Its two
    # UNION ALL branches let the planner use the index on each side
    # (source_note_id via the UNIQUE constraint, target_note_id via
    # idx_knowledge_links_target_note_id); a single `source = x OR target = x`
    # join is much harder to plan well.
    #
    # Visibility matches the graph endpoint: only live notes the user owns or
    # that are public, so a path can never pass through someone's private note.
    op.execute("""
        CREATE FUNCTION fn_note_distances(
            p_root      UUID,
            p_user_id   UUID,
            p_max_depth INTEGER DEFAULT 6
        )
        RETURNS TABLE (note_id UUID, depth INTEGER, parent_id UUID)
        LANGUAGE plpgsql
        STABLE
        AS $$
        #variable_conflict use_column
        DECLARE
            v_nodes    UUID[];
            v_parents  UUID[];
            v_depths   INTEGER[];
            v_frontier UUID[];
            v_next     UUID[];
            v_next_par UUID[];
            v_level    INTEGER := 0;
            v_limit    INTEGER := LEAST(GREATEST(p_max_depth, 0), 10);
        BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM notes r
                WHERE r.id = p_root AND NOT r.archived
                  AND (r.creator_id = p_user_id OR r.is_public)
            ) THEN
                RETURN;  -- unknown or not visible: empty result, not an error
            END IF;

            v_nodes    := ARRAY[p_root];
            v_parents  := ARRAY[NULL::UUID];
            v_depths   := ARRAY[0];
            v_frontier := ARRAY[p_root];

            WHILE v_level < v_limit LOOP
                SELECT array_agg(e.nb ORDER BY e.nb), array_agg(e.par ORDER BY e.nb)
                  INTO v_next, v_next_par
                FROM (
                    -- DISTINCT ON: a note reachable from several frontier
                    -- notes is kept once, with a deterministic parent.
                    SELECT DISTINCT ON (step.nb) step.nb, step.par
                    FROM (
                        SELECT kl.target_note_id AS nb, kl.source_note_id AS par
                        FROM knowledge_links kl
                        WHERE kl.source_note_id = ANY (v_frontier)
                        UNION ALL
                        SELECT kl.source_note_id, kl.target_note_id
                        FROM knowledge_links kl
                        WHERE kl.target_note_id = ANY (v_frontier)
                    ) step
                    JOIN notes n ON n.id = step.nb
                    WHERE step.nb <> ALL (v_nodes)
                      AND NOT n.archived
                      AND (n.creator_id = p_user_id OR n.is_public)
                    ORDER BY step.nb, step.par
                ) e;

                EXIT WHEN v_next IS NULL;  -- nothing new reachable

                v_level    := v_level + 1;
                v_nodes    := v_nodes || v_next;
                v_parents  := v_parents || v_next_par;
                v_depths   := v_depths || array_fill(v_level, ARRAY[cardinality(v_next)]);
                v_frontier := v_next;
            END LOOP;

            RETURN QUERY
            SELECT u.n, u.d, u.p FROM unnest(v_nodes, v_depths, v_parents) AS u(n, d, p);
        END;
        $$
    """)

    # ── F2. How far the farthest reachable note is ────────────────────────────
    # LANGUAGE sql + STABLE: no procedural logic of its own, so the planner can
    # inline it. NULL when the note isn't visible; 0 when it has no links.
    op.execute("""
        CREATE FUNCTION fn_max_graph_depth(
            p_note_id   UUID,
            p_user_id   UUID,
            p_max_depth INTEGER DEFAULT 10
        )
        RETURNS INTEGER
        LANGUAGE sql
        STABLE
        AS $$
            SELECT MAX(d.depth) FROM fn_note_distances(p_note_id, p_user_id, p_max_depth) d
        $$
    """)

    # ── F3. Shortest path between two notes ───────────────────────────────────
    # BFS reaches every note first by a shortest route, and records the note it
    # came from (parent_id). Walking those parent pointers back from the target
    # with a recursive CTE reconstructs that route; ORDER BY depth turns it
    # into step 0 (start) .. step n (target). Empty result if unreachable.
    op.execute("""
        CREATE FUNCTION fn_shortest_path(
            p_from      UUID,
            p_to        UUID,
            p_user_id   UUID,
            p_max_depth INTEGER DEFAULT 10
        )
        RETURNS TABLE (step INTEGER, note_id UUID, title VARCHAR(255))
        LANGUAGE sql
        STABLE
        AS $$
            WITH RECURSIVE
            dist AS (
                SELECT * FROM fn_note_distances(p_from, p_user_id, p_max_depth)
            ),
            walk AS (
                SELECT d.note_id, d.parent_id, d.depth FROM dist d WHERE d.note_id = p_to
                UNION ALL
                SELECT d.note_id, d.parent_id, d.depth
                FROM walk w JOIN dist d ON d.note_id = w.parent_id
            )
            SELECT w.depth, w.note_id, n.title
            FROM walk w JOIN notes n ON n.id = w.note_id
            ORDER BY w.depth
        $$
    """)


def downgrade() -> None:
    """Downgrade schema."""
    op.execute("DROP FUNCTION IF EXISTS fn_shortest_path(UUID, UUID, UUID, INTEGER)")
    op.execute("DROP FUNCTION IF EXISTS fn_max_graph_depth(UUID, UUID, INTEGER)")
    op.execute("DROP FUNCTION IF EXISTS fn_note_distances(UUID, UUID, INTEGER)")
    for view in ("v_orphan_notes", "v_user_dashboard", "v_note_search", "v_note_graph_stats"):
        op.execute(f"DROP VIEW IF EXISTS {view}")
