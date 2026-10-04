from uuid import UUID

from fastapi import APIRouter, status

from app.core.dependencies import CurrentUser, DbSession
from app.schemas.collection import (
    CollectionCreate,
    CollectionDetail,
    CollectionItemAdd,
    CollectionReorder,
    CollectionResponse,
    CollectionUpdate,
)
from app.services.collection import CollectionService

router = APIRouter(prefix="/collections", tags=["collections"])


@router.get("", response_model=list[CollectionResponse])
async def list_collections(user: CurrentUser, db: DbSession) -> list[CollectionResponse]:
    return await CollectionService(db).list(user)


@router.post("", response_model=CollectionDetail, status_code=status.HTTP_201_CREATED)
async def create_collection(
    payload: CollectionCreate, user: CurrentUser, db: DbSession
) -> CollectionDetail:
    return await CollectionService(db).create(payload, user)


@router.get("/{collection_id}", response_model=CollectionDetail)
async def get_collection(collection_id: UUID, user: CurrentUser, db: DbSession) -> CollectionDetail:
    return await CollectionService(db).get(collection_id, user)


@router.patch("/{collection_id}", response_model=CollectionDetail)
async def update_collection(
    collection_id: UUID, payload: CollectionUpdate, user: CurrentUser, db: DbSession
) -> CollectionDetail:
    return await CollectionService(db).update(collection_id, payload, user)


@router.delete("/{collection_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_collection(collection_id: UUID, user: CurrentUser, db: DbSession) -> None:
    await CollectionService(db).delete(collection_id, user)


@router.post("/{collection_id}/items", response_model=CollectionDetail)
async def add_collection_item(
    collection_id: UUID, payload: CollectionItemAdd, user: CurrentUser, db: DbSession
) -> CollectionDetail:
    return await CollectionService(db).add_item(collection_id, payload.note_id, user)


@router.delete("/{collection_id}/items/{note_id}", response_model=CollectionDetail)
async def remove_collection_item(
    collection_id: UUID, note_id: UUID, user: CurrentUser, db: DbSession
) -> CollectionDetail:
    return await CollectionService(db).remove_item(collection_id, note_id, user)


@router.put("/{collection_id}/items/order", response_model=CollectionDetail)
async def reorder_collection_items(
    collection_id: UUID, payload: CollectionReorder, user: CurrentUser, db: DbSession
) -> CollectionDetail:
    return await CollectionService(db).reorder(collection_id, payload.note_ids, user)
