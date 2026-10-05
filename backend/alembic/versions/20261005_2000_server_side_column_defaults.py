"""server-side column defaults

Revision ID: 8b4f6c2d1e73
Revises: 5d2e7a1c4f90
Create Date: 2026-10-05 20:00:00.000000

"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "8b4f6c2d1e73"
down_revision: str | Sequence[str] | None = "5d2e7a1c4f90"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Every NOT NULL column whose model had only a Python-side `default=`. SQLAlchemy
# applies those itself when *it* builds the INSERT; any other writer - a trigger,
# psql, the seed script, the viva practice queries - got a NOT NULL violation
# instead. Found with:
#   SELECT table_name, column_name FROM information_schema.columns
#   WHERE table_schema = 'public' AND is_nullable = 'NO'
#     AND column_default IS NULL AND is_generated = 'NEVER';
# cross-checked against the models. Values are exactly the models' defaults.
DEFAULTS: list[tuple[str, str, str]] = [
    ("workspaces", "id", "gen_random_uuid()"),
    ("notebooks", "id", "gen_random_uuid()"),
    ("notebooks", "color", "'#4CAF50'"),
    ("notes", "id", "gen_random_uuid()"),
    ("notes", "is_public", "FALSE"),
    ("notes", "pinned", "FALSE"),
    ("notes", "archived", "FALSE"),
    ("tags", "color", "'#6366F1'"),
    ("relationship_types", "color", "'#888888'"),
    ("relationship_types", "is_symmetric", "FALSE"),
    ("knowledge_links", "id", "gen_random_uuid()"),
    ("knowledge_links", "strength", "5"),
    ("knowledge_links", "origin", "'manual'"),
    ("collections", "id", "gen_random_uuid()"),
    ("collections", "is_public", "FALSE"),
    ("collection_items", "position", "0"),
    ("flashcards", "id", "gen_random_uuid()"),
    ("flashcards", "ease_factor", "2.50"),
    ("flashcards", "interval_days", "1"),
    ("flashcards", "repetitions", "0"),
    ("resources", "id", "gen_random_uuid()"),
]


def upgrade() -> None:
    """Upgrade schema."""
    # SET DEFAULT only changes the catalog: no table rewrite, no row is
    # touched, and existing data is unaffected.
    for table, column, default in DEFAULTS:
        op.execute(f"ALTER TABLE {table} ALTER COLUMN {column} SET DEFAULT {default}")


def downgrade() -> None:
    """Downgrade schema."""
    for table, column, _ in reversed(DEFAULTS):
        op.execute(f"ALTER TABLE {table} ALTER COLUMN {column} DROP DEFAULT")
