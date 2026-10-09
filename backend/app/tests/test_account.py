"""Data export, account deletion, and the guard that stops a deleted
account from being re-created by a token that hasn't expired yet."""

from uuid import uuid4

import pytest
from fastapi import HTTPException
from fastapi.security import HTTPAuthorizationCredentials
from sqlalchemy import text

from app.core import dependencies
from app.models.user import User
from app.schemas.link import KnowledgeLinkCreate
from app.schemas.note import NoteCreate
from app.schemas.tag import TagCreate
from app.services.link import LinkService
from app.services.note import NoteService
from app.services.tag import TagService
from app.services.user import UserService


async def _signup(db, email: str) -> User:
    """A user created the way Supabase does it: a row in auth.users, which
    the on_auth_user_created trigger mirrors into public.users."""
    user_id = uuid4()
    await db.execute(
        text("INSERT INTO auth.users (id, email) VALUES (:id, :email)"),
        {"id": user_id, "email": email},
    )
    return await db.get(User, user_id)


async def test_export_contains_the_users_data_and_nobody_elses(db, user, make_user, notebook):
    notes = NoteService(db)
    a = await notes.create(NoteCreate(title="Mine A", content="<p>a</p>", notebook_id=notebook.id), user)
    b = await notes.create(NoteCreate(title="Mine B", content="<p>b</p>"), user)
    tag = await TagService(db).create(TagCreate(name="Exam", slug="exam"), user)
    await TagService(db).attach_to_note(a.id, tag.id, user)
    rel = (await db.execute(text("SELECT id FROM relationship_types WHERE name = 'supports'"))).scalar_one()
    await LinkService(db).create(a.id, KnowledgeLinkCreate(target_note_id=b.id, rel_type_id=rel), user)
    stranger = await make_user(display_name="Stranger")
    await notes.create(NoteCreate(title="Not mine", content="x"), stranger)

    doc = await UserService(db).export(user)

    assert doc["format"] == "neurovault-export"
    assert doc["user"]["email"] == user.email
    assert sorted(n["title"] for n in doc["notes"]) == ["Mine A", "Mine B"]
    assert "search_vector" not in doc["notes"][0]
    assert [nb["name"] for nb in doc["notebooks"]] == [notebook.name]
    assert doc["tags"][0]["note_ids"] == [str(a.id)]
    assert doc["links"][0]["rel_type"] == "supports"
    assert doc["collections"] == [] and doc["flashcards"] == []


async def test_export_of_an_empty_account_has_every_key_as_an_empty_list(db, user):
    doc = await UserService(db).export(user)
    for key in ("workspaces", "notebooks", "notes", "tags", "links", "collections", "flashcards"):
        assert doc[key] == [], key


async def test_delete_account_removes_the_login_and_everything_owned(db, make_user):
    leaving = await _signup(db, f"{uuid4()}@example.test")
    note = await NoteService(db).create(NoteCreate(title="Bye", content="x"), leaving)
    staying = await make_user(display_name="Staying")
    kept = await NoteService(db).create(NoteCreate(title="Kept", content="x"), staying)

    await UserService(db).delete_account(leaving)
    db.expunge_all()

    remaining = lambda sql: db.execute(text(sql), {"id": leaving.id})  # noqa: E731
    assert (await remaining("SELECT count(*) FROM auth.users WHERE id = :id")).scalar_one() == 0
    assert (await remaining("SELECT count(*) FROM users WHERE id = :id")).scalar_one() == 0
    assert (
        await db.execute(text("SELECT count(*) FROM notes WHERE id = :id"), {"id": note.id})
    ).scalar_one() == 0
    # Someone else's data is untouched.
    assert (
        await db.execute(text("SELECT count(*) FROM notes WHERE id = :id"), {"id": kept.id})
    ).scalar_one() == 1


async def test_token_of_a_deleted_account_cannot_recreate_it(db, monkeypatch):
    gone = uuid4()  # a valid token's sub, but no login behind it any more
    monkeypatch.setattr(
        dependencies, "decode_access_token", lambda _t: {"sub": str(gone), "email": "g@example.test"}
    )
    creds = HTTPAuthorizationCredentials(scheme="Bearer", credentials="token")

    with pytest.raises(HTTPException) as exc:
        await dependencies.get_current_user(creds, db)

    assert exc.value.status_code == 401
    assert await db.get(User, gone) is None


async def test_first_request_still_creates_the_row_for_a_real_login(db, monkeypatch):
    # The fallback path the guard must not break: login exists, app row doesn't.
    signed_up = await _signup(db, f"{uuid4()}@example.test")
    await db.execute(text("DELETE FROM users WHERE id = :id"), {"id": signed_up.id})
    db.expunge_all()
    monkeypatch.setattr(
        dependencies,
        "decode_access_token",
        lambda _t: {"sub": str(signed_up.id), "email": "back@example.test"},
    )
    creds = HTTPAuthorizationCredentials(scheme="Bearer", credentials="token")

    user = await dependencies.get_current_user(creds, db)

    assert user.id == signed_up.id
