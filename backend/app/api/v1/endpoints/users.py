from datetime import UTC, datetime

from fastapi import APIRouter, status
from fastapi.responses import JSONResponse

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


@router.get("/me/export")
async def export_me(user: CurrentUser, db: DbSession) -> JSONResponse:
    """Everything the caller owns, as one JSON document - data portability."""
    document = await UserService(db).export(user)
    filename = f"neurovault-export-{datetime.now(UTC):%Y-%m-%d}.json"
    return JSONResponse(
        document,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.delete("/me", status_code=status.HTTP_204_NO_CONTENT)
async def delete_me(user: CurrentUser, db: DbSession) -> None:
    """Permanently delete the account and everything in it. Not reversible."""
    await UserService(db).delete_account(user)
