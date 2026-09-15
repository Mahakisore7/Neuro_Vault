"""ADR-001: composite foreign keys are the tenancy rule, not application code.

(workspace_id, owner_id) -> workspaces(id, owner_id) means "the parent must
exist AND belong to this exact user" is one fact the database enforces, not
two facts an if-statement has to keep in sync.
"""

from uuid import uuid4

import pytest
from sqlalchemy.exc import IntegrityError

from app.core.exceptions import NotFoundError
from app.models.workspace import Workspace
from app.repositories.notebook import NotebookRepository
from app.repositories.workspace import WorkspaceRepository
from app.schemas.notebook import NotebookCreate
from app.services.notebook import NotebookService


async def test_composite_fk_accepts_matching_owner(db, user, workspace):
    notebook = await NotebookRepository(db).create(
        workspace_id=workspace.id, owner_id=user.id, name="Matches", color="#4CAF50"
    )
    assert notebook.workspace_id == workspace.id
    assert notebook.owner_id == user.id


async def test_composite_fk_rejects_mismatched_owner(db, workspace):
    """The row the FK is built to catch: a notebook claiming a workspace_id
    that's real, paired with an owner_id that doesn't own it. No row in
    `workspaces` has that (id, owner_id) pair, so Postgres refuses the insert
    outright — this bypasses NotebookService entirely to prove the database
    itself is the thing rejecting it, not the service-layer check.
    """
    hijacker_id = uuid4()

    with pytest.raises(IntegrityError, match="workspace_id_owner_id"):
        await NotebookRepository(db).create(
            workspace_id=workspace.id, owner_id=hijacker_id, name="Hijack attempt", color="#000000"
        )


async def test_service_rejects_cross_tenant_notebook_before_hitting_the_db(db, make_user, workspace):
    """Defense in depth: NotebookService checks workspace ownership itself
    (see the comment in services/notebook.py) so a cross-tenant attempt comes
    back as a clean 404-shaped NotFoundError instead of a raw IntegrityError
    with a stack trace. The FK above is still the real guarantee — this is
    about failure quality, not existence.
    """
    other_user = await make_user(display_name="Someone Else")

    with pytest.raises(NotFoundError):
        await NotebookService(db).create(
            NotebookCreate(workspace_id=workspace.id, name="Not yours", color="#4CAF50"),
            other_user,
        )


async def test_workspace_slug_check_constraint(db, user):
    """CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$') — enforced even if a request
    somehow bypassed WorkspaceCreate's matching Pydantic pattern.
    """
    with pytest.raises(IntegrityError, match="slug_format"):
        await WorkspaceRepository(db).create(
            owner_id=user.id, name="Bad Slug", slug="Not A Valid Slug!"
        )


async def test_workspace_unique_slug_per_owner(db, user, workspace: Workspace):
    with pytest.raises(IntegrityError):
        await WorkspaceRepository(db).create(
            owner_id=user.id, name="Duplicate", slug=workspace.slug
        )
