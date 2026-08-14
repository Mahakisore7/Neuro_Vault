from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class UserUpdate(BaseModel):
    """Everything optional — this is a PATCH. There's no UserCreate: rows in
    `users` are never created by a client request, only by get_current_user
    auto-creating one from a verified JWT the first time someone logs in.
    """

    display_name: str | None = Field(default=None, min_length=1, max_length=100)
    bio: str | None = None
    avatar_url: str | None = None


class UserResponse(BaseModel):
    # from_attributes=True is what lets Pydantic read straight off the
    # SQLAlchemy User object (user.email, user.display_name, ...) instead of
    # requiring a plain dict — this was `orm_mode` in Pydantic v1.
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    email: str
    display_name: str
    avatar_url: str | None
    bio: str | None
    created_at: datetime
