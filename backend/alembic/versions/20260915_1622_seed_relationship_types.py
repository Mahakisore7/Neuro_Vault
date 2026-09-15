"""seed relationship types

Revision ID: 00cfe69d900b
Revises: 9ad6a6ee5f3b
Create Date: 2026-09-15 16:22:36.093593

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "00cfe69d900b"
down_revision: str | Sequence[str] | None = "9ad6a6ee5f3b"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# A bare handle onto the existing table — just enough of it for
# op.bulk_insert, not a redeclaration of the schema (that's owned by the
# migration that created the table).
_relationship_types = sa.table(
    "relationship_types",
    sa.column("name", sa.String),
    sa.column("description", sa.Text),
    sa.column("color", sa.String),
    sa.column("is_symmetric", sa.Boolean),
)

# Fixed, seeded vocabulary — see the "lookup table, not an enum" reasoning in
# app/models/link.py. is_symmetric matters at query time: a symmetric edge
# (A relates_to B) reads the same from either note; an asymmetric one
# (A prerequisite_for B) does not, and the graph endpoint's direction-aware
# traversal depends on this flag being right, not guessed by the client.
_SEED_ROWS = [
    {
        "name": "relates_to",
        "description": "A general, undirected connection",
        "color": "#888888",
        "is_symmetric": True,
    },
    {
        "name": "supports",
        "description": "This note provides evidence or reasoning for the target",
        "color": "#4CAF50",
        "is_symmetric": False,
    },
    {
        "name": "contradicts",
        "description": "This note conflicts with or challenges the target",
        "color": "#E53935",
        "is_symmetric": True,
    },
    {
        "name": "extends",
        "description": "This note builds on or elaborates the target",
        "color": "#1E88E5",
        "is_symmetric": False,
    },
    {
        "name": "example_of",
        "description": "This note is a concrete example of the target's idea",
        "color": "#8E24AA",
        "is_symmetric": False,
    },
    {
        "name": "prerequisite_for",
        "description": "This note must be understood before the target",
        "color": "#FB8C00",
        "is_symmetric": False,
    },
    {
        "name": "see_also",
        "description": "A loose, non-argumentative cross-reference",
        "color": "#00897B",
        "is_symmetric": True,
    },
]


def upgrade() -> None:
    """Upgrade schema."""
    op.bulk_insert(_relationship_types, _SEED_ROWS)


def downgrade() -> None:
    """Downgrade schema."""
    names = [row["name"] for row in _SEED_ROWS]
    op.execute(
        sa.delete(_relationship_types).where(_relationship_types.c.name.in_(names))
    )
