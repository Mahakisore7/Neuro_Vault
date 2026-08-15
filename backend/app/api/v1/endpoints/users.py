from fastapi import APIRouter

from app.core.dependencies import CurrentUser, DbSession
from app.schemas.user import UserResponse, UserUpdate
from app.services.user import UserService

router = APIRouter(prefix="/users", tags=["users"])


@router.get("/me", response_model=UserResponse)
async def get_me(user: CurrentUser) -> UserResponse:
    # No DB call needed here beyond what get_current_user already did -
    # CurrentUser IS the row, resolved (and auto-created, if this was a
    # first login) by the dependency before this function body even runs.
    return UserResponse.model_validate(user)


@router.patch("/me", response_model=UserResponse)
async def update_me(payload: UserUpdate, user: CurrentUser, db: DbSession) -> UserResponse:
    return await UserService(db).update_me(user, payload)
