from typing import TYPE_CHECKING
from uuid import UUID, uuid4

from sqlalchemy import (
    CheckConstraint,
    ForeignKey,
    ForeignKeyConstraint,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import UUID as PgUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin

if TYPE_CHECKING:
    from app.models.note import Note
    from app.models.user import User


class Workspace(Base, TimestampMixin):
    __tablename__ = "workspaces"
    __table_args__ = (
        UniqueConstraint("owner_id", "slug", name="owner_id_slug"),
        # Composite FK TARGET for notebooks below. A plain PK on `id` alone
        # cannot be referenced by a two-column foreign key — the pair itself
        # has to be declared unique first.
        UniqueConstraint("id", "owner_id", name="id_owner_id"),
        CheckConstraint("slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'", name="slug_format"),
    )

    id: Mapped[UUID] = mapped_column(PgUUID(as_uuid=True), primary_key=True, default=uuid4)
    owner_id: Mapped[UUID] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    slug: Mapped[str] = mapped_column(String(100), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)

    owner: Mapped["User"] = relationship(back_populates="workspaces", lazy="raise_on_sql")
    notebooks: Mapped[list["Notebook"]] = relationship(
        back_populates="workspace", cascade="all, delete-orphan", lazy="raise_on_sql"
    )


class Notebook(Base, TimestampMixin):
    __tablename__ = "notebooks"
    __table_args__ = (
        # THE composite foreign key. PostgreSQL will only accept an insert here
        # if a workspaces row exists with BOTH id=workspace_id AND
        # owner_id=owner_id — so "file my notebook under your workspace" is
        # not a bug the application has to catch, it is a row the database
        # physically cannot store (ADR-001).
        ForeignKeyConstraint(
            ["workspace_id", "owner_id"],
            ["workspaces.id", "workspaces.owner_id"],
            ondelete="CASCADE",
            name="workspace_id_owner_id",
        ),
        UniqueConstraint("id", "owner_id", name="id_owner_id"),  # composite FK target for notes
        UniqueConstraint("workspace_id", "name", name="workspace_id_name"),
        CheckConstraint("color ~ '^#[0-9A-Fa-f]{6}$'", name="color_format"),
    )

    id: Mapped[UUID] = mapped_column(PgUUID(as_uuid=True), primary_key=True, default=uuid4)
    workspace_id: Mapped[UUID] = mapped_column(PgUUID(as_uuid=True), nullable=False)
    # Denormalized on purpose: owner_id is already derivable via workspace_id
    # -> workspaces.owner_id, so storing it again breaks 3NF. It's what lets
    # the FK above be composite. See 02-DATABASE.md §2.8 "the two deliberate
    # 3NF violations" — the redundancy is safe because the composite FK ITSELF
    # guarantees the two copies can never disagree.
    owner_id: Mapped[UUID] = mapped_column(PgUUID(as_uuid=True), nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    color: Mapped[str] = mapped_column(String(7), nullable=False, default="#4CAF50")

    workspace: Mapped["Workspace"] = relationship(back_populates="notebooks", lazy="raise_on_sql")
    notes: Mapped[list["Note"]] = relationship(
        back_populates="notebook", viewonly=True, lazy="raise_on_sql"
    )
