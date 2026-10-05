from datetime import datetime
from decimal import Decimal
from uuid import UUID, uuid4

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    DateTime,
    ForeignKeyConstraint,
    Integer,
    Numeric,
    SmallInteger,
    String,
    Text,
    func,
)
from sqlalchemy.dialects.postgresql import UUID as PgUUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin


class Flashcard(Base, TimestampMixin):
    """Q&A card generated from a note, scheduled with the SM-2 spaced-
    repetition algorithm. The composite FK is the same owner-carried-down
    pattern as everything else attached to notes.
    """

    __tablename__ = "flashcards"
    __table_args__ = (
        ForeignKeyConstraint(
            ["note_id", "owner_id"], ["notes.id", "notes.creator_id"],
            ondelete="CASCADE", name="note_id_owner_id",
        ),
        CheckConstraint("btrim(question) <> ''", name="question_not_blank"),
        CheckConstraint("btrim(answer) <> ''", name="answer_not_blank"),
        # 1.30 and 2.50 aren't arbitrary — they're SM-2's own constants: 2.50
        # is where every new card starts, 1.30 is the floor below which
        # intervals stop growing usefully. Encoding the algorithm's own
        # invariants as a CHECK means a buggy scheduling update fails loudly
        # instead of quietly producing a card due in the year 3000.
        CheckConstraint("ease_factor BETWEEN 1.30 AND 2.50", name="ease_factor_range"),
        CheckConstraint("interval_days >= 1", name="interval_positive"),
        CheckConstraint("repetitions >= 0", name="repetitions_non_negative"),
        CheckConstraint("last_result BETWEEN 0 AND 5", name="last_result_range"),
    )

    id: Mapped[UUID] = mapped_column(PgUUID(as_uuid=True), primary_key=True, default=uuid4)
    note_id: Mapped[UUID] = mapped_column(PgUUID(as_uuid=True), nullable=False)
    owner_id: Mapped[UUID] = mapped_column(PgUUID(as_uuid=True), nullable=False)
    question: Mapped[str] = mapped_column(Text, nullable=False)
    answer: Mapped[str] = mapped_column(Text, nullable=False)
    # NUMERIC, never FLOAT: SM-2 repeatedly adjusts this value by small
    # amounts, and binary floating point accumulates representation error —
    # a card that should sit at exactly 2.50 drifts to 2.4999999999. NUMERIC
    # is exact decimal arithmetic, the same reasoning as storing money.
    ease_factor: Mapped[Decimal] = mapped_column(
        Numeric(4, 2), nullable=False, default=Decimal("2.50")
    )
    interval_days: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    repetitions: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    due_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    last_result: Mapped[int | None] = mapped_column(SmallInteger)


class Resource(Base):
    """PDF / link / video attached to a note. The file bytes never touch
    this backend — a resource row is just a URL plus metadata; the upload
    itself goes browser -> object storage directly, added in a later phase.
    """

    __tablename__ = "resources"
    __table_args__ = (
        ForeignKeyConstraint(
            ["note_id", "owner_id"], ["notes.id", "notes.creator_id"],
            ondelete="CASCADE", name="note_id_owner_id",
        ),
        CheckConstraint(
            "resource_type IN ('pdf', 'link', 'video', 'image', 'audio')", name="type_allowed"
        ),
        CheckConstraint("file_size IS NULL OR file_size >= 0", name="file_size_non_negative"),
    )

    id: Mapped[UUID] = mapped_column(PgUUID(as_uuid=True), primary_key=True, default=uuid4)
    note_id: Mapped[UUID] = mapped_column(PgUUID(as_uuid=True), nullable=False)
    owner_id: Mapped[UUID] = mapped_column(PgUUID(as_uuid=True), nullable=False)
    resource_type: Mapped[str] = mapped_column(String(20), nullable=False)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    url: Mapped[str] = mapped_column(Text, nullable=False)
    file_size: Mapped[int | None] = mapped_column(BigInteger)
    mime_type: Mapped[str | None] = mapped_column(String(100))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
