from datetime import datetime
from uuid import UUID

from pydantic import BaseModel


class DashboardTotals(BaseModel):
    """One row of v_user_dashboard. Trashed notes are counted separately
    (archived_notes) and left out of every other figure."""

    total_notes: int
    pinned_notes: int
    public_notes: int
    archived_notes: int
    total_words: int
    workspace_count: int
    link_count: int
    total_cards: int
    cards_due: int
    last_edited_at: datetime | None


class DashboardNote(BaseModel):
    id: UUID
    title: str
    updated_at: datetime
    word_count: int
    # Links in either direction; only filled for the most-connected list.
    degree: int | None = None


class DashboardResponse(BaseModel):
    totals: DashboardTotals
    most_connected: list[DashboardNote]
    orphans: list[DashboardNote]
    recent: list[DashboardNote]
