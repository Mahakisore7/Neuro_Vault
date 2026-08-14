from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class WorkspaceCreate(BaseModel):
    """What a client may send. Note what's ABSENT: owner_id. The service
    layer sets it from the authenticated user, never from request input —
    a field that isn't on this model can't be injected by a client no
    matter what JSON they send, which is the entire reason the request
    schema is separate from the ORM model instead of derived from it.
    """

    name: str = Field(min_length=1, max_length=255)
    # Mirrors the DB's CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$') so a bad
    # slug gets a clear 422 with a field name, instead of reaching the
    # database and coming back as an opaque constraint-violation 500.
    slug: str = Field(pattern=r"^[a-z0-9]+(-[a-z0-9]+)*$", max_length=100)
    description: str | None = None


class WorkspaceUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    description: str | None = None


class WorkspaceResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    owner_id: UUID
    name: str
    slug: str
    description: str | None
    created_at: datetime
    updated_at: datetime
