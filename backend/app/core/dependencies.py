from typing import Annotated
from uuid import UUID

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import TokenError, decode_access_token
from app.db.session import get_db
from app.models.user import User

bearer_scheme = HTTPBearer(auto_error=True)


async def get_current_user(
    credentials: Annotated[HTTPAuthorizationCredentials, Depends(bearer_scheme)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> User:
    """Verify the JWT and return the matching local user row, creating it on
    first login. This is the ONLY place a users row is ever created — never
    from a request body, always from a verified token claim.
    """
    try:
        payload = decode_access_token(credentials.credentials)
        user_id = UUID(payload["sub"])
    except (TokenError, KeyError, ValueError):
        # KeyError: no "sub" claim. ValueError: "sub" isn't a valid UUID.
        # Both are treated exactly like a bad signature - one generic 401,
        # no hint about which check failed.
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authentication credentials",
            headers={"WWW-Authenticate": "Bearer"},
        ) from None

    user = await db.get(User, user_id)
    if user is not None:
        return user

    # First request from this user. Build the row from VERIFIED claims only.
    email = payload.get("email") or f"{user_id}@placeholder.local"
    display_name = (payload.get("user_metadata", {}).get("full_name") or email.split("@")[0])[:100]

    try:
        # begin_nested() opens a SAVEPOINT. Two requests from the same brand
        # new user can race here - both find no row, both try to INSERT.
        # One wins, one hits the UNIQUE constraint on users.id. Rolling back
        # the SAVEPOINT discards only the failed INSERT; a bare db.rollback()
        # would abort the whole request's transaction instead.
        async with db.begin_nested():
            user = User(id=user_id, email=email, display_name=display_name)
            db.add(user)
    except IntegrityError:
        user = await db.get(User, user_id)
        if user is None:
            raise

    return user


CurrentUser = Annotated[User, Depends(get_current_user)]
DbSession = Annotated[AsyncSession, Depends(get_db)]
