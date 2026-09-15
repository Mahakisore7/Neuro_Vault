from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class RelationshipTypeResponse(BaseModel):
    """The seeded vocabulary — read-only, never created by a client."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    description: str | None
    color: str
    is_symmetric: bool


class KnowledgeLinkCreate(BaseModel):
    """source_note_id is the URL's {note_id}, not a body field — the same
    reasoning as WorkspaceCreate omitting owner_id: a client can't set what
    isn't on the schema.
    """

    target_note_id: UUID
    rel_type_id: int
    strength: int = Field(default=5, ge=1, le=10)
    description: str | None = None


class KnowledgeLinkResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    source_note_id: UUID
    target_note_id: UUID
    rel_type_id: int
    strength: int
    description: str | None
    origin: str
    created_at: datetime


class NoteGraphNode(BaseModel):
    """No content, no word_count — a graph view renders titles and edges,
    not full note bodies. Same reasoning as NoteSummary.
    """

    id: UUID
    title: str
    is_public: bool
    depth: int


class NoteGraphEdge(BaseModel):
    id: UUID
    source_note_id: UUID
    target_note_id: UUID
    rel_type_id: int
    rel_type_name: str
    strength: int


class NoteGraphResponse(BaseModel):
    nodes: list[NoteGraphNode]
    edges: list[NoteGraphEdge]
