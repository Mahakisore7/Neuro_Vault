from datetime import datetime
from typing import TYPE_CHECKING
from uuid import UUID, uuid4

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Computed,
    DateTime,
    ForeignKey,
    ForeignKeyConstraint,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import TSVECTOR
from sqlalchemy.dialects.postgresql import UUID as PgUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin

if TYPE_CHECKING:
    from app.models.user import User
    from app.models.workspace import Notebook

# Kept as a module constant because Phase 3's search index and search query
# must use the byte-identical expression, or PostgreSQL silently never uses
# the index it built.
_WORD_COUNT_SQL = r"""
CASE
    WHEN btrim(regexp_replace(COALESCE(content, ''), '<[^>]+>', ' ', 'g')) = ''
    THEN 0
    ELSE array_length(
        regexp_split_to_array(
            btrim(regexp_replace(COALESCE(content, ''), '<[^>]+>', ' ', 'g')), '\s+'
        ), 1)
END
"""

# to_tsvector MUST name the configuration ('english') explicitly. The one-
# argument form reads a session setting, which makes it STABLE, not IMMUTABLE
# — and PostgreSQL requires IMMUTABLE for a generated column.
_SEARCH_VECTOR_SQL = """
setweight(to_tsvector('english', COALESCE(title, '')), 'A') ||
setweight(to_tsvector('english',
    COALESCE(regexp_replace(content, '<[^>]+>', ' ', 'g'), '')), 'B')
"""


class Note(Base, TimestampMixin):
    __tablename__ = "notes"
    __table_args__ = (
        ForeignKeyConstraint(
            ["notebook_id", "creator_id"],
            ["notebooks.id", "notebooks.owner_id"],
            # PostgreSQL 15+ column-list form: null ONLY notebook_id. Plain
            # SET NULL on a composite FK would null every column it covers,
            # including creator_id — which is NOT NULL, so the delete would
            # fail the first time a notebook containing notes was deleted.
            ondelete="SET NULL (notebook_id)",
            name="notebook_id_creator_id",
        ),
        UniqueConstraint("id", "creator_id", name="id_creator_id"),  # composite FK target
        CheckConstraint("btrim(title) <> ''", name="title_not_blank"),
    )

    id: Mapped[UUID] = mapped_column(PgUUID(as_uuid=True), primary_key=True, default=uuid4)
    creator_id: Mapped[UUID] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    notebook_id: Mapped[UUID | None] = mapped_column(PgUUID(as_uuid=True))  # nullable: unfiled note

    title: Mapped[str] = mapped_column(String(255), nullable=False)
    content: Mapped[str | None] = mapped_column(Text)
    is_public: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    pinned: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    # See NoteService.delete in Stage 3: DELETE /notes/{id} sets this to True
    # rather than issuing a real SQL DELETE, so a note's history survives.
    archived: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    # Generated columns — computed BY POSTGRES on every write. Never assigned
    # in Python; PostgreSQL rejects a direct UPDATE to either one.
    word_count: Mapped[int] = mapped_column(Integer, Computed(_WORD_COUNT_SQL, persisted=True))
    search_vector: Mapped[str] = mapped_column(
        TSVECTOR, Computed(_SEARCH_VECTOR_SQL, persisted=True)
    )

    creator: Mapped["User"] = relationship(lazy="raise_on_sql")
    # viewonly: this relationship crosses the composite FK above, whose
    # creator_id column the `creator` relationship also touches. Two writable
    # relationships sharing one column makes SQLAlchemy's unit-of-work
    # ambiguous, so read through the relationship, write notebook_id directly.
    notebook: Mapped["Notebook | None"] = relationship(
        back_populates="notes", viewonly=True, lazy="raise_on_sql"
    )
    versions: Mapped[list["NoteVersion"]] = relationship(
        back_populates="note",
        cascade="all, delete-orphan",
        order_by="desc(NoteVersion.version_num)",
        lazy="raise_on_sql",
    )


class NoteVersion(Base):
    __tablename__ = "note_versions"
    __table_args__ = (
        UniqueConstraint("note_id", "version_num", name="note_id_version_num"),
        CheckConstraint("version_num > 0", name="version_num_positive"),
    )

    id: Mapped[UUID] = mapped_column(PgUUID(as_uuid=True), primary_key=True, default=uuid4)
    note_id: Mapped[UUID] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("notes.id", ondelete="CASCADE"), nullable=False
    )
    version_num: Mapped[int] = mapped_column(Integer, nullable=False)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    content: Mapped[str | None] = mapped_column(Text)
    # SET NULL, not CASCADE: a deleted user must not erase the history of
    # notes they once edited. The version row survives with no author.
    edited_by: Mapped[UUID | None] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL")
    )
    change_note: Mapped[str | None] = mapped_column(String(255))
    # No updated_at here on purpose — a version row is written once by the
    # trigger (Phase 3) and never touched again. Giving it an updated_at
    # would imply it's mutable, which is exactly what it must never be.
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    note: Mapped["Note"] = relationship(back_populates="versions", lazy="raise_on_sql")
