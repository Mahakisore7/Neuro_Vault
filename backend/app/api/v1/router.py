from fastapi import APIRouter

from app.api.v1.endpoints import (
    collections,
    flashcards,
    notebooks,
    notes,
    relationship_types,
    tags,
    users,
    workspaces,
)

api_router = APIRouter()
api_router.include_router(users.router)
api_router.include_router(workspaces.router)
api_router.include_router(notebooks.router)
api_router.include_router(notes.router)
api_router.include_router(tags.router)
api_router.include_router(relationship_types.router)
api_router.include_router(collections.router)
api_router.include_router(flashcards.router)
