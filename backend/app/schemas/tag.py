from pydantic import BaseModel, ConfigDict, Field


class TagCreate(BaseModel):
    name: str = Field(min_length=1, max_length=50)
    slug: str = Field(min_length=1, max_length=50, pattern=r"^[a-z0-9]+(-[a-z0-9]+)*$")
    color: str = Field(default="#6366F1", pattern=r"^#[0-9A-Fa-f]{6}$")


class TagUpdate(BaseModel):
    """No slug here - like a workspace's slug, it's a stable identifier set
    once at creation, not something later edits are expected to change."""

    name: str | None = Field(default=None, min_length=1, max_length=50)
    color: str | None = Field(default=None, pattern=r"^#[0-9A-Fa-f]{6}$")


class TagResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    slug: str
    color: str
