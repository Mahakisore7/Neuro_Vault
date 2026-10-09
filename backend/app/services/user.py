from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import User
from app.repositories.account import AccountRepository
from app.schemas.user import UserResponse, UserUpdate


class UserService:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def update_me(self, user: User, payload: UserUpdate) -> UserResponse:
        # No repository/ownership check needed: unlike every other service,
        # the row to mutate isn't looked up from a path parameter - it's
        # CurrentUser itself, already scoped to the caller by get_current_user.
        for field, value in payload.model_dump(exclude_unset=True).items():
            setattr(user, field, value)

        await self.db.flush()
        await self.db.refresh(user)
        return UserResponse.model_validate(user)

    async def export(self, user: User) -> dict[str, Any]:
        return await AccountRepository(self.db).export(user.id)

    async def delete_account(self, user: User) -> None:
        await AccountRepository(self.db).delete(user.id)
