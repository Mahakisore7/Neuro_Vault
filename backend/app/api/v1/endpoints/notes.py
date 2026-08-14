from uuid import UUID

from fastapi import APIRouter, Query, status

from app.core.dependencies import CurrentUser, DbSession
from app.schemas.note import NoteCreate, NoteResponse, NoteSummary, NoteUpdate
from app.services.note import NoteService

router = APIRouter(prefix="/notes", tags=["notes"])


@router.get("", response_model=list[NoteSummary])
async def list_notes(
    user: CurrentUser,
    db: DbSession,
    notebook_id: UUID | None = None,
    archived: bool = False,
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
) -> list[NoteSummary]:
    return await NoteService(db).list(
        user, notebook_id=notebook_id, archived=archived, limit=limit, offset=offset
    )


@router.post("", response_model=NoteResponse, status_code=status.HTTP_201_CREATED)
async def create_note(payload: NoteCreate, user: CurrentUser, db: DbSession) -> NoteResponse:
    return await NoteService(db).create(payload, user)


@router.get("/{note_id}", response_model=NoteResponse)
async def get_note(note_id: UUID, user: CurrentUser, db: DbSession) -> NoteResponse:
    return await NoteService(db).get(note_id, user)


@router.patch("/{note_id}", response_model=NoteResponse)
async def update_note(
    note_id: UUID, payload: NoteUpdate, user: CurrentUser, db: DbSession
) -> NoteResponse:
    return await NoteService(db).update(note_id, payload, user)


@router.delete("/{note_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_note(note_id: UUID, user: CurrentUser, db: DbSession) -> None:
    # 204 No Content, even though this archives rather than deletes - the
    # HTTP method and status code describe the CLIENT-visible contract
    # ("this resource is gone from your normal view"), not the storage
    # detail behind it. The client doesn't need to know whether the row
    # still physically exists; NoteService.delete is where that's decided.
    await NoteService(db).delete(note_id, user)
