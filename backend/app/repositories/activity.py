from collections.abc import Sequence
from uuid import UUID

from sqlalchemy import Row, text
from sqlalchemy.ext.asyncio import AsyncSession

# Gaps-and-islands: collapse runs of consecutive rows with the same
# (entity_id, event) into one entry.
#   recent  - the user's newest rows, bounded so the window work stays small
#             (served by idx_activity_logs_user_id_id, scanned backwards)
#   marked  - LAG() compares each row with the one before it; 1 = starts a
#             new run, 0 = continues the previous one
#   islands - a running SUM of those flags gives every run its own number
# then GROUP BY that number: one output row per run, with its size and span.
_FEED_SQL = text("""
    WITH recent AS (
        SELECT id, action_type, entity_type, entity_id, metadata, created_at
        FROM activity_logs
        WHERE user_id = :user_id
        ORDER BY id DESC
        LIMIT :scan
    ),
    marked AS (
        SELECT *,
               CASE
                   WHEN entity_id IS NOT DISTINCT FROM LAG(entity_id) OVER w
                    AND metadata ->> 'event' IS NOT DISTINCT FROM LAG(metadata ->> 'event') OVER w
                   THEN 0 ELSE 1
               END AS starts_run
        FROM recent
        WINDOW w AS (ORDER BY id)
    ),
    islands AS (
        SELECT *, SUM(starts_run) OVER (ORDER BY id) AS run
        FROM marked
    )
    SELECT
        MAX(id)                                       AS id,
        (ARRAY_AGG(action_type ORDER BY id DESC))[1]  AS action_type,
        (ARRAY_AGG(entity_type ORDER BY id DESC))[1]  AS entity_type,
        (ARRAY_AGG(entity_id   ORDER BY id DESC))[1]  AS entity_id,
        (ARRAY_AGG(metadata    ORDER BY id DESC))[1]  AS metadata,
        MAX(created_at)                               AS created_at,
        MIN(created_at)                               AS first_at,
        COUNT(*)                                      AS count
    FROM islands
    GROUP BY run
    ORDER BY MAX(id) DESC
    LIMIT :limit
""")


class ActivityRepository:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def feed(self, user_id: UUID, limit: int, scan: int = 500) -> Sequence[Row]:
        params = {"user_id": user_id, "limit": limit, "scan": scan}
        return (await self.db.execute(_FEED_SQL, params)).all()
