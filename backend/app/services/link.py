from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import NotFoundError, PermissionDeniedError, ValidationError
from app.models.user import User
from app.repositories.link import KnowledgeLinkRepository, RelationshipTypeRepository
from app.repositories.note import NoteRepository
from app.schemas.link import (
    KnowledgeLinkCreate,
    KnowledgeLinkResponse,
    NoteGraphEdge,
    NoteGraphNode,
    NoteGraphResponse,
    NoteGraphStats,
    NotePathStep,
    RelationshipTypeResponse,
)


class LinkService:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db
        self.links = KnowledgeLinkRepository(db)
        self.relationship_types = RelationshipTypeRepository(db)
        self.notes = NoteRepository(db)

    async def list_relationship_types(self) -> list[RelationshipTypeResponse]:
        types = await self.relationship_types.list_all()
        return [RelationshipTypeResponse.model_validate(t) for t in types]

    # list_for_note and get_graph live above create()/delete() on purpose —
    # see NoteService for why a method named `list` has to come first in a
    # class body. Neither is named `list` here, but keeping every read
    # grouped above every write matches that file's convention.
    async def list_for_note(self, note_id: UUID, user: User) -> list[KnowledgeLinkResponse]:
        note = await self.notes.get(note_id)
        if note is None or (note.creator_id != user.id and not note.is_public):
            raise NotFoundError("Note", note_id)

        links = await self.links.list_for_note(note_id)
        return [KnowledgeLinkResponse.model_validate(link) for link in links]

    async def get_graph(self, note_id: UUID, user: User, max_depth: int) -> NoteGraphResponse:
        note = await self.notes.get(note_id)
        if note is None or (note.creator_id != user.id and not note.is_public):
            raise NotFoundError("Note", note_id)

        node_rows, edge_rows = await self.links.get_graph(note_id, user.id, max_depth)
        nodes = [
            NoteGraphNode(id=row.id, title=row.title, is_public=row.is_public, depth=row.depth)
            for row in node_rows
        ]
        edges = [
            NoteGraphEdge(
                id=row.KnowledgeLink.id,
                source_note_id=row.KnowledgeLink.source_note_id,
                target_note_id=row.KnowledgeLink.target_note_id,
                rel_type_id=row.KnowledgeLink.rel_type_id,
                rel_type_name=row.rel_type_name,
                strength=row.KnowledgeLink.strength,
            )
            for row in edge_rows
        ]
        return NoteGraphResponse(nodes=nodes, edges=edges)

    async def _assert_can_read(self, note_id: UUID, user: User) -> None:
        note = await self.notes.get(note_id)
        if note is None or (note.creator_id != user.id and not note.is_public):
            raise NotFoundError("Note", note_id)

    async def shortest_path(
        self, from_id: UUID, to_id: UUID, user: User, max_depth: int
    ) -> list[NotePathStep]:
        # Both ends must be readable (404 otherwise). Between them, the
        # database function only walks through notes the user can see, so an
        # empty list means "no visible route", never "a route you can't see".
        await self._assert_can_read(from_id, user)
        await self._assert_can_read(to_id, user)
        rows = await self.links.shortest_path(from_id, to_id, user.id, max_depth)
        return [NotePathStep(step=r.step, note_id=r.note_id, title=r.title) for r in rows]

    async def stats(self, note_id: UUID, user: User) -> NoteGraphStats:
        await self._assert_can_read(note_id, user)
        row = await self.links.stats(note_id, user.id)
        if row is None:
            raise NotFoundError("Note", note_id)
        return NoteGraphStats(
            outgoing_count=row.outgoing_count,
            incoming_count=row.incoming_count,
            degree=row.degree,
            version_count=row.version_count,
            # NULL only when the note isn't visible, which was ruled out above
            # (but an archived note is: its traversal is empty).
            max_depth=row.max_depth or 0,
        )

    async def create(
        self, note_id: UUID, payload: KnowledgeLinkCreate, user: User
    ) -> KnowledgeLinkResponse:
        if payload.target_note_id == note_id:
            raise ValidationError("A note cannot link to itself")

        # ADR-007: an edge may only originate from a note you own — the
        # composite FK (source_note_id, created_by) -> notes(id, creator_id)
        # would reject this anyway, but checking first turns that into a
        # clean 403 instead of a raw IntegrityError (same reasoning as
        # NotebookService.create checking workspace ownership up front).
        source = await self.notes.get(note_id)
        if source is None:
            raise NotFoundError("Note", note_id)
        if source.creator_id != user.id:
            raise PermissionDeniedError("create a link from this note")

        # The other side of ADR-007: target_note_id is a plain FK, so you may
        # point an edge at any note you can READ — your own, or public.
        target = await self.notes.get(payload.target_note_id)
        if target is None or (target.creator_id != user.id and not target.is_public):
            raise NotFoundError("Note", payload.target_note_id)

        rel_type = await self.relationship_types.get(payload.rel_type_id)
        if rel_type is None:
            raise NotFoundError("Relationship type", payload.rel_type_id)

        # A duplicate (source, target, rel_type) hits the UNIQUE constraint
        # and surfaces as a 500 today — the same accepted gap documented in
        # WorkspaceService.create and TagService.create, not special-cased
        # here alone.
        link = await self.links.create(
            source_note_id=note_id,
            target_note_id=payload.target_note_id,
            rel_type_id=payload.rel_type_id,
            created_by=user.id,
            strength=payload.strength,
            description=payload.description,
        )
        return KnowledgeLinkResponse.model_validate(link)

    async def delete(self, note_id: UUID, link_id: UUID, user: User) -> None:
        link = await self.links.get(link_id)
        if link is None or link.source_note_id != note_id:
            raise NotFoundError("Link", link_id)
        if link.created_by != user.id:
            raise PermissionDeniedError("delete this link")
        await self.links.delete(link)
