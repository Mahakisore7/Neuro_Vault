"""remaining query indexes

Revision ID: a1d93e5b7c20
Revises: 8b4f6c2d1e73
Create Date: 2026-10-06 10:00:00.000000

"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "a1d93e5b7c20"
down_revision: str | Sequence[str] | None = "8b4f6c2d1e73"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Each index here backs a specific query in the app. Two indexes from the
# original plan (03-SQL-LAYER.md 3.2) are deliberately NOT built:
#   - knowledge_links (source_note_id, rel_type_id): redundant. The existing
#     UNIQUE (source_note_id, target_note_id, rel_type_id) is a B-tree whose
#     leftmost column is source_note_id, so it already serves every
#     "edges out of this note" lookup. A second index would only cost writes.
#   - knowledge_links (source_note_id, origin): exists for wiki-link
#     reconciliation, which isn't built. An index with no query is pure cost.
INDEXES: list[tuple[str, str]] = [
    # The note list: WHERE creator_id = ? AND archived = false
    # ORDER BY pinned DESC, updated_at DESC. Matching the ORDER BY column for
    # column lets the planner read rows already sorted (no Sort node); the
    # partial WHERE keeps trashed notes out of the index entirely.
    (
        "idx_notes_creator_id_pinned_updated_at",
        "ON notes (creator_id, pinned DESC, updated_at DESC) WHERE archived = FALSE",
    ),
    # Incoming edges. Nothing else indexes target_note_id, so every graph
    # traversal step and every "who links to me" lookup scanned all links.
    ("idx_knowledge_links_target_note_id", "ON knowledge_links (target_note_id)"),
    # Notes in a notebook. PARTIAL: unfiled notes (notebook_id IS NULL) are
    # never looked up this way. It also serves ON DELETE SET NULL when a
    # notebook is deleted - without it, that is a scan of every note.
    ("idx_notes_notebook_id", "ON notes (notebook_id) WHERE notebook_id IS NOT NULL"),
    # Typo-tolerant title search: GIN over trigrams serves `title % 'qury'`
    # (similarity) and ILIKE '%sub%', neither of which a B-tree can do - a
    # B-tree can only seek on a known prefix.
    ("idx_notes_title_trgm", "ON notes USING GIN (title gin_trgm_ops)"),
]


def upgrade() -> None:
    """Upgrade schema."""
    op.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm")
    # CONCURRENTLY: notes and knowledge_links are live tables; this builds
    # without blocking writes. It can't run in a transaction, hence the
    # autocommit block (same as the GIN search_vector migration).
    with op.get_context().autocommit_block():
        for name, definition in INDEXES:
            op.execute(f"CREATE INDEX CONCURRENTLY IF NOT EXISTS {name} {definition}")


def downgrade() -> None:
    """Downgrade schema."""
    with op.get_context().autocommit_block():
        for name, _ in reversed(INDEXES):
            op.execute(f"DROP INDEX CONCURRENTLY IF EXISTS {name}")
    # pg_trgm is left installed: other objects may come to depend on it, and
    # an installed, unused extension costs nothing.
