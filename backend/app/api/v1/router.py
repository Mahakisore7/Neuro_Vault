from fastapi import APIRouter

from app.api.v1.endpoints import notebooks, notes, users, workspaces

api_router = APIRouter()
api_router.include_router(users.router)
api_router.include_router(workspaces.router)
api_router.include_router(notebooks.router)
api_router.include_router(notes.router)
