from uuid import UUID

from fastapi import APIRouter, status

from app.core.dependencies import CurrentUser, DbSession
from app.schemas.workspace import WorkspaceCreate, WorkspaceResponse, WorkspaceUpdate
from app.services.workspace import WorkspaceService

router = APIRouter(prefix="/workspaces", tags=["workspaces"])


@router.get("", response_model=list[WorkspaceResponse])
async def list_workspaces(user: CurrentUser, db: DbSession) -> list[WorkspaceResponse]:
    return await WorkspaceService(db).list(user)


@router.post("", response_model=WorkspaceResponse, status_code=status.HTTP_201_CREATED)
async def create_workspace(
    payload: WorkspaceCreate, user: CurrentUser, db: DbSession
) -> WorkspaceResponse:
    return await WorkspaceService(db).create(payload, user)


@router.get("/{workspace_id}", response_model=WorkspaceResponse)
async def get_workspace(workspace_id: UUID, user: CurrentUser, db: DbSession) -> WorkspaceResponse:
    return await WorkspaceService(db).get(workspace_id, user)


@router.patch("/{workspace_id}", response_model=WorkspaceResponse)
async def update_workspace(
    workspace_id: UUID, payload: WorkspaceUpdate, user: CurrentUser, db: DbSession
) -> WorkspaceResponse:
    return await WorkspaceService(db).update(workspace_id, payload, user)


@router.delete("/{workspace_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_workspace(workspace_id: UUID, user: CurrentUser, db: DbSession) -> None:
    await WorkspaceService(db).delete(workspace_id, user)
