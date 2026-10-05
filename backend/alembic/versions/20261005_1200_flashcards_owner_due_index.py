"""flashcards (owner_id, due_at) index

Revision ID: 3c1f0d8a9b42
Revises: 7e7c50e3a537
Create Date: 2026-10-05 12:00:00.000000

"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "3c1f0d8a9b42"
down_revision: str | Sequence[str] | None = "7e7c50e3a537"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    # The review queue is always "this user's cards with due_at <= now(),
    # soonest first". Composite, owner_id first: equality on the leading
    # column, then a range scan already in due_at order — so the ORDER BY
    # needs no sort step. (due_at, owner_id) would scan every user's due
    # cards and filter afterwards.
    #
    # CONCURRENTLY + autocommit block for the same reason as the GIN index
    # migration: no write lock on flashcards while it builds.
    with op.get_context().autocommit_block():
        op.execute(
            "CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_flashcards_owner_id_due_at "
            "ON flashcards (owner_id, due_at)"
        )


def downgrade() -> None:
    """Downgrade schema."""
    with op.get_context().autocommit_block():
        op.execute("DROP INDEX CONCURRENTLY IF EXISTS idx_flashcards_owner_id_due_at")
