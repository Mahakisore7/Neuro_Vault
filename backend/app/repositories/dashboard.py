from collections.abc import Sequence
from uuid import UUID

from sqlalchemy import Row, text
from sqlalchemy.ext.asyncio import AsyncSession

# Each query reads a view from migration b7e2c4f9a031; this layer only picks
# the user's rows and orders them. The backend's role bypasses RLS, so every
# query filters on the user explicitly.
_TOTALS_SQL = text("SELECT * FROM v_user_dashboard WHERE user_id = :user_id")

# The note's own degree, not a join: v_note_graph_stats computes it with a
# correlated subquery per note, so there is no fan-out to undo here.
_MOST_CONNECTED_SQL = text("""
    SELECT s.note_id AS id, s.title, s.updated_at, s.word_count, s.degree
    FROM v_note_graph_stats s
    JOIN notes n ON n.id = s.note_id
    WHERE s.creator_id = :user_id AND NOT n.archived AND s.degree > 0
    ORDER BY s.degree DESC, s.updated_at DESC
    LIMIT :limit
""")

_ORPHANS_SQL = text("""
    SELECT id, title, updated_at, word_count
    FROM v_orphan_notes
    WHERE creator_id = :user_id
    ORDER BY updated_at DESC
    LIMIT :limit
""")

# Served by idx_notes_creator_id_pinned_updated_at's leading column + filter.
_RECENT_SQL = text("""
    SELECT id, title, updated_at, word_count
    FROM notes
    WHERE creator_id = :user_id AND NOT archived
    ORDER BY updated_at DESC
    LIMIT :limit
""")


class DashboardRepository:
    """No BaseRepository: these are views, not mapped models."""

    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def totals(self, user_id: UUID) -> Row | None:
        return (await self.db.execute(_TOTALS_SQL, {"user_id": user_id})).one_or_none()

    async def most_connected(self, user_id: UUID, limit: int) -> Sequence[Row]:
        params = {"user_id": user_id, "limit": limit}
        return (await self.db.execute(_MOST_CONNECTED_SQL, params)).all()

    async def orphans(self, user_id: UUID, limit: int) -> Sequence[Row]:
        params = {"user_id": user_id, "limit": limit}
        return (await self.db.execute(_ORPHANS_SQL, params)).all()

    async def recent(self, user_id: UUID, limit: int) -> Sequence[Row]:
        params = {"user_id": user_id, "limit": limit}
        return (await self.db.execute(_RECENT_SQL, params)).all()
