from uuid import UUID

from sqlalchemy import CheckConstraint, ForeignKeyConstraint, Integer, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID as PgUUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class Tag(Base):
    __tablename__ = "tags"
    __table_args__ = (
        UniqueConstraint("user_id", "slug"),
        UniqueConstraint("id", "user_id"),  # composite FK target
        CheckConstraint("slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'", name="slug_format"),
        CheckConstraint("color ~ '^#[0-9A-Fa-f]{6}$'", name="color_format"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[UUID] = mapped_column(PgUUID(as_uuid=True), nullable=False)
    name: Mapped[str] = mapped_column(String(50), nullable=False)
    slug: Mapped[str] = mapped_column(String(50), nullable=False)
    color: Mapped[str] = mapped_column(
        String(7), nullable=False, default="#6366F1", server_default="#6366F1"
    )


class NoteTag(Base):
    """M:N junction, notes <-> tags. owner_id appears ONCE and is referenced
    by BOTH composite foreign keys below — for a row to exist, PostgreSQL
    must find a note owned by owner_id AND a tag owned by the same owner_id.
    Tagging your note with someone else's tag isn't a bug to prevent; it's a
    row that cannot be stored.
    """

    __tablename__ = "note_tags"
    __table_args__ = (
        ForeignKeyConstraint(
            ["note_id", "owner_id"], ["notes.id", "notes.creator_id"], ondelete="CASCADE",
            name="note_id_owner_id",
        ),
        ForeignKeyConstraint(
            ["tag_id", "owner_id"], ["tags.id", "tags.user_id"], ondelete="CASCADE",
            name="tag_id_owner_id",
        ),
    )

    # Composite PRIMARY KEY, no surrogate id column. A note either has this
    # tag or it doesn't — there's no meaningful third state a bare `id`
    # would let you represent, so a surrogate key here would only add an
    # unindexed extra column and let the SAME (note, tag) pair be inserted
    # twice by accident.
    note_id: Mapped[UUID] = mapped_column(PgUUID(as_uuid=True), primary_key=True)
    tag_id: Mapped[int] = mapped_column(Integer, primary_key=True)
    owner_id: Mapped[UUID] = mapped_column(PgUUID(as_uuid=True), nullable=False)
