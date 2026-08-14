from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class NoteCreate(BaseModel):
    title: str = Field(min_length=1, max_length=255)
    content: str | None = None
    notebook_id: UUID | None = None
    is_public: bool = False


class NoteUpdate(BaseModel):
    """Every field optional — this is a PATCH.

    Why that matters here specifically: NoteService.update() (Stage 3) calls
    `payload.model_dump(exclude_unset=True)`, which returns only the fields
    the client actually sent. Without that, a client PATCHing just
    {"pinned": true} would have every OTHER field come back as its Python
    default (None / False), and the service would overwrite the note's
    title and content with nothing. exclude_unset is what tells "the client
    didn't mention this" apart from "the client explicitly set this to
    null" — a plain dataclass with defaults can't express that difference.
    """

    title: str | None = Field(default=None, min_length=1, max_length=255)
    content: str | None = None
    notebook_id: UUID | None = None
    is_public: bool | None = None
    pinned: bool | None = None
    archived: bool | None = None


class NoteResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    creator_id: UUID
    notebook_id: UUID | None
    title: str
    content: str | None
    is_public: bool
    pinned: bool
    archived: bool
    word_count: int  # generated column — readable here, never accepted as input above
    created_at: datetime
    updated_at: datetime


class NoteSummary(BaseModel):
    """The list endpoint returns this, not NoteResponse. A list of 50 notes
    each shipping their full HTML `content` is megabytes of payload the list
    view never renders — this is the shape that's actually needed there.
    """

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    title: str
    is_public: bool
    pinned: bool
    archived: bool
    word_count: int
    updated_at: datetime
