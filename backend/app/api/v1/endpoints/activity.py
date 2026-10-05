from fastapi import APIRouter, Query

from app.core.dependencies import CurrentUser, DbSession
from app.schemas.activity import ActivityEntry
from app.services.activity import ActivityService

router = APIRouter(prefix="/activity", tags=["activity"])


@router.get("", response_model=list[ActivityEntry])
async def activity_feed(
    user: CurrentUser, db: DbSession, limit: int = Query(default=50, ge=1, le=200)
) -> list[ActivityEntry]:
    return await ActivityService(db).feed(user, limit)
