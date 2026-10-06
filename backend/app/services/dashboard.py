from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import NotFoundError
from app.models.user import User
from app.repositories.dashboard import DashboardRepository
from app.schemas.dashboard import DashboardNote, DashboardResponse, DashboardTotals


class DashboardService:
    def __init__(self, db: AsyncSession) -> None:
        self.dashboard = DashboardRepository(db)

    async def get(self, user: User, limit: int = 5) -> DashboardResponse:
        # No ownership check to write: the user comes from the verified JWT,
        # not from a path parameter, so there is no id to swap for someone
        # else's.
        totals = await self.dashboard.totals(user.id)
        if totals is None:  # the view has one row per users row - can't happen
            raise NotFoundError("User", user.id)

        def notes(rows) -> list[DashboardNote]:
            return [DashboardNote.model_validate(r, from_attributes=True) for r in rows]

        return DashboardResponse(
            totals=DashboardTotals.model_validate(totals, from_attributes=True),
            most_connected=notes(await self.dashboard.most_connected(user.id, limit)),
            orphans=notes(await self.dashboard.orphans(user.id, limit)),
            recent=notes(await self.dashboard.recent(user.id, limit)),
        )
