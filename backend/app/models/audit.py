from datetime import datetime
from uuid import UUID

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    DateTime,
    ForeignKey,
    String,
    Text,
    false,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PgUUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class ActivityLog(Base):
    """Append-only audit trail, written only by triggers: fn_log_note_activity
    (notes: create / meaningful update / delete) and fn_log_link_activity
    (knowledge_links: link / unlink). No application code inserts here.
    """

    __tablename__ = "activity_logs"
    __table_args__ = (
        CheckConstraint(
            "action_type IN ('create', 'update', 'delete', 'link', 'unlink')",
            name="action_type_allowed",
        ),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    # SET NULL, not CASCADE: an audit log that disappears when the actor is
    # deleted is not an audit log.
    user_id: Mapped[UUID | None] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL")
    )
    action_type: Mapped[str] = mapped_column(String(50), nullable=False)
    entity_type: Mapped[str] = mapped_column(String(50), nullable=False)
    entity_id: Mapped[UUID | None] = mapped_column(PgUUID(as_uuid=True))
    # The COLUMN is named "metadata". The Python ATTRIBUTE cannot be, because
    # `metadata` is a reserved name on every SQLAlchemy DeclarativeBase
    # subclass (it's where the table registry itself lives). Naming the
    # first mapped_column() argument "metadata" keeps the SQL column name
    # correct while metadata_ is what Python code actually reads/writes.
    metadata_: Mapped[dict] = mapped_column(
        "metadata", JSONB, nullable=False, server_default="{}"
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class Notification(Base):
    """The table behind the notification bell. Written by the trigger
    trg_knowledge_links_notify when someone links to your PUBLIC note — the
    only event that currently produces a notification. `is_read` is the one
    column the application writes.
    """

    __tablename__ = "notifications"
    __table_args__ = (
        CheckConstraint(
            "type IN ('link_created', 'note_shared', 'review_due', 'system')",
            name="type_allowed",
        ),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    user_id: Mapped[UUID] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    type: Mapped[str] = mapped_column(String(50), nullable=False)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    body: Mapped[str | None] = mapped_column(Text)
    link_url: Mapped[str | None] = mapped_column(Text)
    # server_default as well as default: the trigger's raw INSERT never goes
    # through SQLAlchemy, so only a database-side default reaches it.
    is_read: Mapped[bool] = mapped_column(nullable=False, default=False, server_default=false())
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
