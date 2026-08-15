from datetime import datetime
from uuid import UUID, uuid4

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    ForeignKeyConstraint,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import UUID as PgUUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin


class Collection(Base, TimestampMixin):
    """A manually curated, ORDERED set of notes — 'Exam revision', 'To read'.
    Different in kind from a Notebook (a note lives in at most one notebook,
    but can sit in many collections) and from a Tag (a tag has no order;
    collection_items.position does).
    """

    __tablename__ = "collections"
    __table_args__ = (
        UniqueConstraint("user_id", "name"),
        UniqueConstraint("id", "user_id"),  # composite FK target
    )

    id: Mapped[UUID] = mapped_column(PgUUID(as_uuid=True), primary_key=True, default=uuid4)
    user_id: Mapped[UUID] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    is_public: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)


class CollectionItem(Base):
    """M:N junction, collections <-> notes — same owner_id-in-both-FKs
    pattern as NoteTag. `position` is the whole reason this junction needs
    its own attribute: it's what lets a collection be an ORDERED list
    instead of just a set.
    """

    __tablename__ = "collection_items"
    __table_args__ = (
        ForeignKeyConstraint(
            ["collection_id", "owner_id"], ["collections.id", "collections.user_id"],
            ondelete="CASCADE", name="collection_id_owner_id",
        ),
        ForeignKeyConstraint(
            ["note_id", "owner_id"], ["notes.id", "notes.creator_id"],
            ondelete="CASCADE", name="note_id_owner_id",
        ),
        CheckConstraint("position >= 0", name="position_non_negative"),
    )

    collection_id: Mapped[UUID] = mapped_column(PgUUID(as_uuid=True), primary_key=True)
    note_id: Mapped[UUID] = mapped_column(PgUUID(as_uuid=True), primary_key=True)
    owner_id: Mapped[UUID] = mapped_column(PgUUID(as_uuid=True), nullable=False)
    position: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    added_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
