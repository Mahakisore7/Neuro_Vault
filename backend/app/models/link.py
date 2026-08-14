from typing import TYPE_CHECKING
from uuid import UUID, uuid4

from sqlalchemy import (
    CheckConstraint,
    ForeignKey,
    ForeignKeyConstraint,
    SmallInteger,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import UUID as PgUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin

if TYPE_CHECKING:
    from app.models.note import Note


class RelationshipType(Base):
    """Lookup table — a fixed vocabulary of edge types. Seeded, not user-created.

    A table instead of a Postgres ENUM: an enum is a bare label with nowhere
    to hang a colour or an is_symmetric flag, adding a value means
    ALTER TYPE (not always transactional), and there's no equivalent of
    ON DELETE RESTRICT to stop a type-in-use from being removed.
    """

    __tablename__ = "relationship_types"
    __table_args__ = (CheckConstraint("color ~ '^#[0-9A-Fa-f]{6}$'", name="color_format"),)

    # SMALLINT: 7 seeded rows will never approach 32,767, and this column is
    # repeated in every single knowledge_links row — a 2-byte key beats 4.
    id: Mapped[int] = mapped_column(SmallInteger, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(50), nullable=False, unique=True)
    description: Mapped[str | None] = mapped_column(Text)
    color: Mapped[str] = mapped_column(String(7), nullable=False, default="#888888")
    is_symmetric: Mapped[bool] = mapped_column(nullable=False, default=False)


class KnowledgeLink(Base, TimestampMixin):
    """THE GRAPH. A self-referencing many-to-many junction on notes — two
    foreign keys, both ultimately pointing back at notes.id. This one table
    is what turns a pile of notes into a traversable knowledge graph.
    """

    __tablename__ = "knowledge_links"
    __table_args__ = (
        # ADR-007: an edge may only ORIGINATE from a note you own. Note this
        # is a COMPOSITE fk on the source side...
        ForeignKeyConstraint(
            ["source_note_id", "created_by"],
            ["notes.id", "notes.creator_id"],
            ondelete="CASCADE",
            name="source_note_id_created_by",
        ),
        UniqueConstraint(
            "source_note_id", "target_note_id", "rel_type_id",
            name="source_note_id_target_note_id_rel_type_id",
        ),
        CheckConstraint("source_note_id <> target_note_id", name="no_self_link"),
        CheckConstraint("strength BETWEEN 1 AND 10", name="strength_range"),
        CheckConstraint("origin IN ('manual', 'wiki', 'ai')", name="origin"),
    )

    id: Mapped[UUID] = mapped_column(PgUUID(as_uuid=True), primary_key=True, default=uuid4)
    source_note_id: Mapped[UUID] = mapped_column(PgUUID(as_uuid=True), nullable=False)
    # ...while target_note_id is a PLAIN fk: you may point an edge at ANY
    # note you can read, including someone else's public one. That asymmetry
    # between a composite FK on one side and a plain FK on the other IS the
    # security model, expressed as two lines of DDL instead of a paragraph.
    target_note_id: Mapped[UUID] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("notes.id", ondelete="CASCADE"), nullable=False
    )
    rel_type_id: Mapped[int] = mapped_column(
        SmallInteger,
        ForeignKey("relationship_types.id", ondelete="RESTRICT"),
        nullable=False,
    )
    created_by: Mapped[UUID] = mapped_column(PgUUID(as_uuid=True), nullable=False)
    strength: Mapped[int] = mapped_column(SmallInteger, nullable=False, default=5)
    description: Mapped[str | None] = mapped_column(Text)
    # How this row came to exist. Not used yet in Stage 3 (there's no
    # wiki-link or AI feature in a basic-CRUD build) — but the column has to
    # exist now, because retrofitting a NOT NULL column with a default onto
    # a live links table later is a much bigger migration than including it
    # on day one. 'manual' is the only value Stage 3 will ever write.
    origin: Mapped[str] = mapped_column(String(10), nullable=False, default="manual")

    source_note: Mapped["Note"] = relationship(
        foreign_keys=[source_note_id], viewonly=True, lazy="raise_on_sql"
    )
    target_note: Mapped["Note"] = relationship(
        foreign_keys=[target_note_id], viewonly=True, lazy="raise_on_sql"
    )
    relationship_type: Mapped["RelationshipType"] = relationship(lazy="raise_on_sql")
