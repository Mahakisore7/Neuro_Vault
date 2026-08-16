from fastapi import APIRouter, status

from app.core.dependencies import CurrentUser, DbSession
from app.schemas.tag import TagCreate, TagResponse, TagUpdate
from app.services.tag import TagService

router = APIRouter(prefix="/tags", tags=["tags"])


@router.get("", response_model=list[TagResponse])
async def list_tags(user: CurrentUser, db: DbSession) -> list[TagResponse]:
    return await TagService(db).list(user)


@router.post("", response_model=TagResponse, status_code=status.HTTP_201_CREATED)
async def create_tag(payload: TagCreate, user: CurrentUser, db: DbSession) -> TagResponse:
    return await TagService(db).create(payload, user)


@router.patch("/{tag_id}", response_model=TagResponse)
async def update_tag(
    tag_id: int, payload: TagUpdate, user: CurrentUser, db: DbSession
) -> TagResponse:
    return await TagService(db).update(tag_id, payload, user)


@router.delete("/{tag_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_tag(tag_id: int, user: CurrentUser, db: DbSession) -> None:
    await TagService(db).delete(tag_id, user)
