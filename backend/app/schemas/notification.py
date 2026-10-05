from datetime import datetime

from pydantic import BaseModel, ConfigDict


class NotificationResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    type: str
    title: str
    body: str | None
    link_url: str | None
    is_read: bool
    created_at: datetime


class UnreadCount(BaseModel):
    count: int
