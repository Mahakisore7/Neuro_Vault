from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class NotebookCreate(BaseModel):
    workspace_id: UUID
    name: str = Field(min_length=1, max_length=255)
    description: str | None = None
    color: str = Field(default="#4CAF50", pattern=r"^#[0-9A-Fa-f]{6}$")


class NotebookUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    description: str | None = None
    color: str | None = Field(default=None, pattern=r"^#[0-9A-Fa-f]{6}$")


class NotebookResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    workspace_id: UUID
    owner_id: UUID
    name: str
    description: str | None
    color: str
    created_at: datetime
    updated_at: datetime
