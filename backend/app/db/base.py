from datetime import datetime
from typing import Any

from sqlalchemy import DateTime, MetaData, func
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

# Explicit naming convention for every constraint and index.
#
# Without this, PostgreSQL invents names ("notes_creator_id_fkey") and Alembic
# autogenerate cannot reliably drop or alter them later — it does not know what
# the database called something it never named. Set this on day one.
NAMING_CONVENTION = {
    "ix": "ix_%(table_name)s_%(column_0_N_name)s",
    "uq": "uq_%(table_name)s_%(column_0_N_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_N_name)s",
    "pk": "pk_%(table_name)s",
}


class Base(DeclarativeBase):
    metadata = MetaData(naming_convention=NAMING_CONVENTION)

    type_annotation_map: dict[Any, Any] = {}


class TimestampMixin:
    """created_at / updated_at maintained by the database, not by Python.

    server_default=func.now() means the value comes from PostgreSQL. If a row
    is inserted by the seed script, by psql, or by a future service in another
    language, it still gets a correct timestamp.
    """

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )


# ─── Model registry ─────────────────────────────────────────────────────────
# Alembic autogenerate compares Base.metadata against the live database. A
# model only enters that metadata when its module is imported. Miss one and
# autogenerate produces a migration that DROPS the table it cannot see.
# These imports ARE the registry — noqa because they're unused by name and
# essential by side effect. Filled in during Stage 2 (Database).
