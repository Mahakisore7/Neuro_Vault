"""The model registry.

Alembic autogenerate compares Base.metadata against the live database. A
model only enters that metadata when its module has been imported SOMEWHERE
— these imports are that somewhere. Miss one here and autogenerate silently
produces a migration that DROPS the table it can't see.

This lives here, not in db/base.py, specifically to avoid a circular
import: every model module does `from app.db.base import Base`, so
db/base.py cannot also import the models without risking a partial-import
failure depending on which module Python happens to load first. This file
is only ever imported deliberately (by alembic/env.py and app/main.py),
after which every name below is safely importable from anywhere else.
"""

from app.models.audit import ActivityLog, Notification  # noqa: F401
from app.models.collection import Collection, CollectionItem  # noqa: F401
from app.models.link import KnowledgeLink, RelationshipType  # noqa: F401
from app.models.note import Note, NoteVersion  # noqa: F401
from app.models.study import Flashcard, Resource  # noqa: F401
from app.models.tag import NoteTag, Tag  # noqa: F401
from app.models.user import User  # noqa: F401
from app.models.workspace import Notebook, Workspace  # noqa: F401
