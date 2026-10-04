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


class NoteSearchResult(BaseModel):
    """title_highlight and snippet mark matches with \\x01 ... \\x02, not
    <mark> tags (as docs/phases/New/03-SQL-LAYER.md Q15 sketched): the
    client splits on the sentinels and builds <mark> elements itself, so no
    note text is ever rendered as HTML. Entities are already unescaped.
    """

    id: UUID
    title: str
    title_highlight: str
    snippet: str
    rank: float
    is_own: bool
    updated_at: datetime


class NoteVersionSummary(BaseModel):
    """No `content` here either, same reasoning as NoteSummary - a history
    list shows what changed and when; the content itself is only needed at
    the moment of an actual rollback, which the DB performs server-side
    (sp_rollback_note_version) without ever sending it back to the client.
    """

    model_config = ConfigDict(from_attributes=True)

    version_num: int
    title: str
    edited_by: UUID | None
    created_at: datetime
