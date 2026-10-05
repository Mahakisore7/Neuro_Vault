from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import NotFoundError
from app.models.user import User
from app.repositories.notification import NotificationRepository
from app.schemas.notification import NotificationResponse


class NotificationService:
    """Notifications are created only by trg_knowledge_links_notify; the
    application can read them and flip is_read, nothing else.
    """

    def __init__(self, db: AsyncSession) -> None:
        self.db = db
        self.notifications = NotificationRepository(db)

    async def recent(self, user: User, limit: int = 30) -> list[NotificationResponse]:
        rows = await self.notifications.recent(user.id, limit)
        return [NotificationResponse.model_validate(n) for n in rows]

    async def unread_count(self, user: User) -> int:
        return await self.notifications.unread_count(user.id)

    async def mark_read(self, notification_id: int, user: User) -> NotificationResponse:
        notification = await self.notifications.get(notification_id)
        # 404 rather than 403 for someone else's: ids are sequential, and a
        # 403 would confirm which ones exist.
        if notification is None or notification.user_id != user.id:
            raise NotFoundError("Notification", notification_id)
        notification.is_read = True
        await self.db.flush()
        return NotificationResponse.model_validate(notification)

    async def mark_all_read(self, user: User) -> None:
        await self.notifications.mark_all_read(user.id)
