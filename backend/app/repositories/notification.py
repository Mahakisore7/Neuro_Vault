from collections.abc import Sequence
from uuid import UUID

from sqlalchemy import func, select, update

from app.models.audit import Notification
from app.repositories.base import BaseRepository


class NotificationRepository(BaseRepository[Notification]):
    model = Notification

    async def recent(self, user_id: UUID, limit: int) -> Sequence[Notification]:
        stmt = (
            select(Notification)
            .where(Notification.user_id == user_id)
            .order_by(Notification.id.desc())
            .limit(limit)
        )
        return (await self.db.execute(stmt)).scalars().all()

    async def unread_count(self, user_id: UUID) -> int:
        # Matches the partial index's WHERE exactly, so the planner can use
        # idx_notifications_user_id_created_at without touching read rows.
        stmt = select(func.count()).where(
            Notification.user_id == user_id, Notification.is_read.is_(False)
        )
        return (await self.db.execute(stmt)).scalar_one()

    async def mark_all_read(self, user_id: UUID) -> None:
        # One set-based UPDATE, not a loop of row updates.
        await self.db.execute(
            update(Notification)
            .where(Notification.user_id == user_id, Notification.is_read.is_(False))
            .values(is_read=True)
        )
