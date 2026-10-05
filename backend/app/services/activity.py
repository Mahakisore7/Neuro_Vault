from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import User
from app.repositories.activity import ActivityRepository
from app.schemas.activity import ActivityEntry


class ActivityService:
    """Read-only by design. Nothing in the application writes activity_logs;
    the triggers fn_log_note_activity and fn_log_link_activity do, for every
    writer, which is the whole point of putting the audit trail in the
    database.
    """

    def __init__(self, db: AsyncSession) -> None:
        self.activity = ActivityRepository(db)

    async def feed(self, user: User, limit: int = 50) -> list[ActivityEntry]:
        rows = await self.activity.feed(user.id, limit)
        return [ActivityEntry.model_validate(r, from_attributes=True) for r in rows]
