from fastapi import APIRouter, Query, status

from app.core.dependencies import CurrentUser, DbSession
from app.schemas.notification import NotificationResponse, UnreadCount
from app.services.notification import NotificationService

router = APIRouter(prefix="/notifications", tags=["notifications"])


@router.get("", response_model=list[NotificationResponse])
async def list_notifications(
    user: CurrentUser, db: DbSession, limit: int = Query(default=30, ge=1, le=100)
) -> list[NotificationResponse]:
    return await NotificationService(db).recent(user, limit)


# Static paths before /{notification_id}, so they're never parsed as an id.
@router.get("/unread-count", response_model=UnreadCount)
async def unread_count(user: CurrentUser, db: DbSession) -> UnreadCount:
    return UnreadCount(count=await NotificationService(db).unread_count(user))


@router.post("/read-all", status_code=status.HTTP_204_NO_CONTENT)
async def mark_all_read(user: CurrentUser, db: DbSession) -> None:
    await NotificationService(db).mark_all_read(user)


@router.post("/{notification_id}/read", response_model=NotificationResponse)
async def mark_read(notification_id: int, user: CurrentUser, db: DbSession) -> NotificationResponse:
    return await NotificationService(db).mark_read(notification_id, user)
