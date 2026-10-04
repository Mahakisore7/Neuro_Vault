from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class CollectionCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    description: str | None = None


class CollectionUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    description: str | None = None


class CollectionResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    name: str
    description: str | None
    item_count: int
    created_at: datetime
    updated_at: datetime


class CollectionItemResponse(BaseModel):
    """archived is surfaced rather than filtered out: an archived note is
    still a member (restoring it from Trash puts it back in place), and the
    reorder endpoint expects the full member list, hidden ones included.
    """

    note_id: UUID
    title: str
    word_count: int
    archived: bool
    position: int
    added_at: datetime


class CollectionDetail(CollectionResponse):
    items: list[CollectionItemResponse]


class CollectionItemAdd(BaseModel):
    note_id: UUID


class CollectionReorder(BaseModel):
    note_ids: list[UUID]
