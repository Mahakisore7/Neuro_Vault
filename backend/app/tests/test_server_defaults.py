"""Columns with a model default must also have a database default.

SQLAlchemy fills `default=` in only for INSERTs it builds itself; triggers,
psql, seed scripts and the viva practice queries write plain SQL. These
inserts name only the columns that have no sensible default, so each one
fails with a NOT NULL violation if a server default goes missing.
"""

from sqlalchemy import text

from app.models.audit import Notification
from app.models.collection import Collection, CollectionItem
from app.models.link import KnowledgeLink, RelationshipType
from app.models.note import Note
from app.models.study import Flashcard, Resource
from app.models.tag import Tag
from app.models.workspace import Notebook, Workspace


async def _scalar(db, sql: str, **params):
    return (await db.execute(text(sql), params)).scalar_one()


async def test_plain_sql_inserts_get_every_default(db, user):
    uid = user.id
    ws = await _scalar(
        db,
        "INSERT INTO workspaces (owner_id, name, slug) VALUES (:u, 'W', 'w') RETURNING id",
        u=uid,
    )
    nb = await _scalar(
        db,
        "INSERT INTO notebooks (workspace_id, owner_id, name) VALUES (:w, :u, 'N') RETURNING color",
        w=ws,
        u=uid,
    )
    assert nb == "#4CAF50"

    note = (
        await db.execute(
            text(
                "INSERT INTO notes (creator_id, title) VALUES (:u, 'Raw') "
                "RETURNING id, is_public, pinned, archived"
            ),
            {"u": uid},
        )
    ).one()
    assert (note.is_public, note.pinned, note.archived) == (False, False, False)
    other = await _scalar(
        db, "INSERT INTO notes (creator_id, title) VALUES (:u, 'Other') RETURNING id", u=uid
    )

    tag_color = await _scalar(
        db,
        "INSERT INTO tags (user_id, name, slug) VALUES (:u, 'T', 't') RETURNING color",
        u=uid,
    )
    assert tag_color == "#6366F1"

    link = (
        await db.execute(
            text(
                "INSERT INTO knowledge_links (source_note_id, target_note_id, rel_type_id, "
                "created_by) VALUES (:s, :t, 1, :u) RETURNING strength, origin"
            ),
            {"s": note.id, "t": other, "u": uid},
        )
    ).one()
    assert (link.strength, link.origin) == (5, "manual")

    col = await _scalar(
        db, "INSERT INTO collections (user_id, name) VALUES (:u, 'C') RETURNING id", u=uid
    )
    position = await _scalar(
        db,
        "INSERT INTO collection_items (collection_id, note_id, owner_id) "
        "VALUES (:c, :n, :u) RETURNING position",
        c=col,
        n=note.id,
        u=uid,
    )
    assert position == 0

    card = (
        await db.execute(
            text(
                "INSERT INTO flashcards (note_id, owner_id, question, answer) "
                "VALUES (:n, :u, 'Q', 'A') RETURNING ease_factor, interval_days, repetitions"
            ),
            {"n": note.id, "u": uid},
        )
    ).one()
    assert (float(card.ease_factor), card.interval_days, card.repetitions) == (2.5, 1, 0)

    await db.execute(
        text(
            "INSERT INTO resources (note_id, owner_id, resource_type, title, url) "
            "VALUES (:n, :u, 'link', 'R', 'https://example.test')"
        ),
        {"n": note.id, "u": uid},
    )
    rel = (
        await db.execute(
            text(
                "INSERT INTO relationship_types (name) VALUES ('test_rel') "
                "RETURNING color, is_symmetric"
            )
        )
    ).one()
    assert (rel.color, rel.is_symmetric) == ("#888888", False)


def test_models_declare_the_same_server_defaults():
    """The migration and the models must agree, or the next autogenerate
    (or a fresh create_all) silently drops a default again."""
    expected = {
        Workspace: ["id"],
        Notebook: ["id", "color"],
        Note: ["id", "is_public", "pinned", "archived"],
        Tag: ["color"],
        RelationshipType: ["color", "is_symmetric"],
        KnowledgeLink: ["id", "strength", "origin"],
        Collection: ["id", "is_public"],
        CollectionItem: ["position"],
        Flashcard: ["id", "ease_factor", "interval_days", "repetitions"],
        Resource: ["id"],
        Notification: ["is_read"],
    }
    missing = [
        f"{model.__tablename__}.{col}"
        for model, cols in expected.items()
        for col in cols
        if model.__table__.c[col].server_default is None
    ]
    assert missing == []
