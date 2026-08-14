from fastapi import APIRouter

from app.core.dependencies import CurrentUser
from app.schemas.user import UserResponse

router = APIRouter(prefix="/users", tags=["users"])


@router.get("/me", response_model=UserResponse)
async def get_me(user: CurrentUser) -> UserResponse:
    # No DB call needed here beyond what get_current_user already did -
    # CurrentUser IS the row, resolved (and auto-created, if this was a
    # first login) by the dependency before this function body even runs.
    return UserResponse.model_validate(user)
