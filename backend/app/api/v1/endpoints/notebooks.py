from uuid import UUID

from fastapi import APIRouter, status

from app.core.dependencies import CurrentUser, DbSession
from app.schemas.notebook import NotebookCreate, NotebookResponse, NotebookUpdate
from app.services.notebook import NotebookService

router = APIRouter(prefix="/notebooks", tags=["notebooks"])


@router.get("", response_model=list[NotebookResponse])
async def list_notebooks(
    workspace_id: UUID, user: CurrentUser, db: DbSession
) -> list[NotebookResponse]:
    return await NotebookService(db).list(workspace_id, user)


@router.post("", response_model=NotebookResponse, status_code=status.HTTP_201_CREATED)
async def create_notebook(
    payload: NotebookCreate, user: CurrentUser, db: DbSession
) -> NotebookResponse:
    return await NotebookService(db).create(payload, user)


@router.get("/{notebook_id}", response_model=NotebookResponse)
async def get_notebook(notebook_id: UUID, user: CurrentUser, db: DbSession) -> NotebookResponse:
    return await NotebookService(db).get(notebook_id, user)


@router.patch("/{notebook_id}", response_model=NotebookResponse)
async def update_notebook(
    notebook_id: UUID, payload: NotebookUpdate, user: CurrentUser, db: DbSession
) -> NotebookResponse:
    return await NotebookService(db).update(notebook_id, payload, user)


@router.delete("/{notebook_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_notebook(notebook_id: UUID, user: CurrentUser, db: DbSession) -> None:
    await NotebookService(db).delete(notebook_id, user)
