from fastapi import APIRouter

from app.core.dependencies import CurrentUser, DbSession
from app.schemas.link import RelationshipTypeResponse
from app.services.link import LinkService

router = APIRouter(prefix="/relationship-types", tags=["relationship-types"])


@router.get("", response_model=list[RelationshipTypeResponse])
async def list_relationship_types(
    user: CurrentUser, db: DbSession
) -> list[RelationshipTypeResponse]:
    # user is unused: the list is the same fixed, seeded vocabulary for
    # everyone (see the migration). CurrentUser stays required for the same
    # reason every other route requires it — consistent auth, not filtering.
    return await LinkService(db).list_relationship_types()
