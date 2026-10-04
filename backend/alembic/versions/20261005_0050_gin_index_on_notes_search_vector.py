"""gin index on notes search_vector

Revision ID: 7e7c50e3a537
Revises: 00cfe69d900b
Create Date: 2026-10-05 00:50:07.454942

"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "7e7c50e3a537"
down_revision: str | Sequence[str] | None = "00cfe69d900b"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    # GIN, not B-tree: a tsvector holds many lexemes per row, and GIN is an
    # inverted index (lexeme -> rows containing it), which is exactly the
    # shape `search_vector @@ query` needs. A B-tree can only answer
    # whole-value comparisons, so it would be useless here.
    #
    # CONCURRENTLY builds without taking a write lock on notes, so saves
    # keep working while it runs. It can't run inside a transaction, hence
    # the autocommit block (Alembic wraps migrations in one by default).
    with op.get_context().autocommit_block():
        op.execute(
            "CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_notes_search_vector "
            "ON notes USING GIN (search_vector)"
        )


def downgrade() -> None:
    """Downgrade schema."""
    with op.get_context().autocommit_block():
        op.execute("DROP INDEX CONCURRENTLY IF EXISTS idx_notes_search_vector")
