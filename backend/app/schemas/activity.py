from datetime import datetime
from typing import Any
from uuid import UUID

from pydantic import BaseModel


class ActivityEntry(BaseModel):
    """One feed row. Consecutive identical events on the same entity (an
    autosaving editor produces many 'edited' rows) arrive merged: `count` is
    how many raw log rows it stands for, first_at..created_at their span, and
    metadata is the newest row's.
    """

    id: int
    action_type: str
    entity_type: str
    entity_id: UUID | None
    metadata: dict[str, Any]
    created_at: datetime
    first_at: datetime
    count: int
