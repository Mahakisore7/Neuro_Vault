from datetime import datetime
from typing import TYPE_CHECKING
from uuid import UUID

from sqlalchemy import CheckConstraint, DateTime, String, Text
from sqlalchemy.dialects.postgresql import CITEXT
from sqlalchemy.dialects.postgresql import UUID as PgUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin

if TYPE_CHECKING:
    # Real imports only for the type checker / linter — never at runtime.
    # SQLAlchemy resolves the STRING "Workspace" in Mapped["Workspace"] below
    # through its own mapper registry once every model module has been
    # imported (that's what db/base.py's import block, added at the end of
    # Stage 2, is for). Importing Workspace for real here would create a
    # circular import: workspace.py needs User too.
    from app.models.workspace import Workspace


class User(Base, TimestampMixin):
    __tablename__ = "users"
    __table_args__ = (
        CheckConstraint("btrim(display_name) <> ''", name="display_name_not_blank"),
    )

    # No default(). This value IS the "sub" claim from the Supabase JWT — the
    # row is created from a verified token, never minted locally (ADR-013).
    id: Mapped[UUID] = mapped_column(PgUUID(as_uuid=True), primary_key=True)

    email: Mapped[str] = mapped_column(CITEXT, nullable=False, unique=True)
    display_name: Mapped[str] = mapped_column(String(100), nullable=False)
    avatar_url: Mapped[str | None] = mapped_column(Text)
    bio: Mapped[str | None] = mapped_column(Text)
    last_seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    workspaces: Mapped[list["Workspace"]] = relationship(
        back_populates="owner", cascade="all, delete-orphan", lazy="raise_on_sql"
    )
