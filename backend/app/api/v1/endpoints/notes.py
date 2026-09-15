from uuid import UUID

from fastapi import APIRouter, Query, status

from app.core.config import settings
from app.core.dependencies import CurrentUser, DbSession
from app.schemas.link import KnowledgeLinkCreate, KnowledgeLinkResponse, NoteGraphResponse
from app.schemas.note import (
    NoteCreate,
    NoteResponse,
    NoteSummary,
    NoteUpdate,
    NoteVersionSummary,
)
from app.schemas.tag import TagResponse
from app.services.link import LinkService
from app.services.note import NoteService
from app.services.tag import TagService

router = APIRouter(prefix="/notes", tags=["notes"])


@router.get("", response_model=list[NoteSummary])
async def list_notes(
    user: CurrentUser,
    db: DbSession,
    notebook_id: UUID | None = None,
    unfiled: bool = False,
    archived: bool = False,
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
) -> list[NoteSummary]:
    return await NoteService(db).list(
        user,
        notebook_id=notebook_id,
        unfiled=unfiled,
        archived=archived,
        limit=limit,
        offset=offset,
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


@router.get("/{note_id}/versions", response_model=list[NoteVersionSummary])
async def list_note_versions(
    note_id: UUID, user: CurrentUser, db: DbSession
) -> list[NoteVersionSummary]:
    return await NoteService(db).list_versions(note_id, user)


@router.post("/{note_id}/versions/{version_num}/rollback", response_model=NoteResponse)
async def rollback_note_version(
    note_id: UUID, version_num: int, user: CurrentUser, db: DbSession
) -> NoteResponse:
    return await NoteService(db).rollback_version(note_id, version_num, user)


@router.get("/{note_id}/tags", response_model=list[TagResponse])
async def list_note_tags(note_id: UUID, user: CurrentUser, db: DbSession) -> list[TagResponse]:
    return await TagService(db).list_for_note(note_id, user)


@router.post("/{note_id}/tags/{tag_id}", status_code=status.HTTP_204_NO_CONTENT)
async def attach_note_tag(note_id: UUID, tag_id: int, user: CurrentUser, db: DbSession) -> None:
    await TagService(db).attach_to_note(note_id, tag_id, user)


@router.delete("/{note_id}/tags/{tag_id}", status_code=status.HTTP_204_NO_CONTENT)
async def detach_note_tag(note_id: UUID, tag_id: int, user: CurrentUser, db: DbSession) -> None:
    await TagService(db).detach_from_note(note_id, tag_id, user)


@router.get("/{note_id}/links", response_model=list[KnowledgeLinkResponse])
async def list_note_links(note_id: UUID, user: CurrentUser, db: DbSession) -> list[KnowledgeLinkResponse]:
    return await LinkService(db).list_for_note(note_id, user)


@router.post(
    "/{note_id}/links", response_model=KnowledgeLinkResponse, status_code=status.HTTP_201_CREATED
)
async def create_note_link(
    note_id: UUID, payload: KnowledgeLinkCreate, user: CurrentUser, db: DbSession
) -> KnowledgeLinkResponse:
    return await LinkService(db).create(note_id, payload, user)


@router.delete("/{note_id}/links/{link_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_note_link(note_id: UUID, link_id: UUID, user: CurrentUser, db: DbSession) -> None:
    await LinkService(db).delete(note_id, link_id, user)


@router.get("/{note_id}/graph", response_model=NoteGraphResponse)
async def get_note_graph(
    note_id: UUID,
    user: CurrentUser,
    db: DbSession,
    max_depth: int = Query(default=3, ge=1, le=settings.graph_max_depth),
) -> NoteGraphResponse:
    return await LinkService(db).get_graph(note_id, user, max_depth)
