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

# NOTE: no model imports here. This module defines Base; every model module
# imports Base FROM here. If this file also imported the models (as it
# briefly did), the first model module Python happens to load would trigger
# an import of db.base, which would try to import that SAME model module
# back — while it's still mid-import and doesn't have its class defined
# yet. That's a circular import, and it only shows up depending on which
# module gets imported first, which is what made it easy to miss. The
# model registry (needed for Alembic autogenerate) lives in
# app/models/__init__.py instead, which only ever gets imported AFTER
# every individual model module already works on its own.
