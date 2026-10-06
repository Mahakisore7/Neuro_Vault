from fastapi import APIRouter

from app.core.dependencies import CurrentUser, DbSession
from app.schemas.dashboard import DashboardResponse
from app.services.dashboard import DashboardService

router = APIRouter(prefix="/dashboard", tags=["dashboard"])


@router.get("", response_model=DashboardResponse)
async def get_dashboard(user: CurrentUser, db: DbSession) -> DashboardResponse:
    return await DashboardService(db).get(user)
