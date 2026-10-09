import html
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import NotFoundError, PermissionDeniedError, ValidationError
from app.models.note import Note
from app.models.user import User
from app.repositories.note import NoteRepository
from app.repositories.note_version import NoteVersionRepository
from app.repositories.notebook import NotebookRepository
from app.schemas.note import (
    NoteCreate,
    NoteResponse,
    NoteSearchResult,
    NoteSummary,
    NoteUpdate,
    NoteVersionSummary,
)


class NoteService:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db
        self.notes = NoteRepository(db)
        self.notebooks = NotebookRepository(db)
        self.versions = NoteVersionRepository(db)

    # ── Authorization — the only place these two rules are written ────────

    @staticmethod
    def _assert_can_read(note: Note, user: User) -> None:
        """Readable if you own it OR it's public. Raises NotFoundError, not
        PermissionDeniedError, for the not-yours-and-not-public case: a 403
        on someone else's private note confirms the ID is real and exists.
        404 reveals nothing either way - "doesn't exist" and "exists but
        isn't yours" look identical from the outside.
        """
        if note.creator_id != user.id and not note.is_public:
            raise NotFoundError("Note", note.id)

    @staticmethod
    def _assert_can_write(note: Note, user: User) -> None:
        """Public means readable by anyone, writable only by the owner -
        two different rules, so two different checks. A note being public
        NEVER implies anyone else may edit it."""
        if note.creator_id != user.id:
            raise PermissionDeniedError("modify this note")

    # ── Operations ───────────────────────────────────────────────────────

    async def get(self, note_id: UUID, user: User) -> NoteResponse:
        note = await self.notes.get(note_id)
        if note is None:
            raise NotFoundError("Note", note_id)
        self._assert_can_read(note, user)
        return NoteResponse.model_validate(note)

    # These two live here, above list(), on purpose: a method named `list`
    # shadows the builtin `list` for every annotation written after it in
    # this class body (Python resolves `-> list[...]` against the class
    # namespace being built, not the builtin, once that name exists in it).
    # `-> list[NoteVersionSummary]` below would otherwise fail at import
    # time with "'function' object is not subscriptable".
    async def list_versions(self, note_id: UUID, user: User) -> list[NoteVersionSummary]:
        note = await self.notes.get(note_id)
        if note is None:
            raise NotFoundError("Note", note_id)
        # Write permission, not read: is_public only governs the CURRENT
        # content of a note, not its editing history. Version history can
        # expose drafts and phrasing nobody chose to publish, so it stays
        # visible to the owner only, even for a note that is itself public.
        self._assert_can_write(note, user)
        versions = await self.versions.list_for_note(note_id)
        return [NoteVersionSummary.model_validate(v) for v in versions]

    async def rollback_version(self, note_id: UUID, version_num: int, user: User) -> NoteResponse:
        note = await self.notes.get(note_id)
        if note is None:
            raise NotFoundError("Note", note_id)
        self._assert_can_write(note, user)

        version = await self.versions.get_by_version_num(note_id, version_num)
        if version is None:
            raise NotFoundError("Version", version_num)

        # CALL, not a Python-side UPDATE: sp_rollback_note_version re-checks
        # ownership itself (defence in depth - see the migration) and its
        # UPDATE fires trg_notes_create_version, so the state being replaced
        # is versioned too. A rollback is never destructive; you can always
        # roll back a rollback.
        await self.db.execute(
            text("CALL sp_rollback_note_version(:note_id, :version_num, :actor_id)"),
            {"note_id": str(note_id), "version_num": version_num, "actor_id": str(user.id)},
        )
        await self.db.flush()
        # The procedure's UPDATE didn't go through this ORM object, so its
        # in-memory attributes are now stale relative to what's in Postgres.
        await self.db.refresh(note)
        return NoteResponse.model_validate(note)

    async def search(self, user: User, q: str, limit: int = 20) -> list[NoteSearchResult]:
        if not q.strip():
            return []
        rows = await self.notes.search(user.id, q, limit)
        # Unescape AFTER highlighting: content is stored as editor HTML, so
        # the stripped text still holds entities like &amp;. The client
        # renders these strings as plain text, never as HTML, so &lt; turning
        # into a literal "<" here is safe — it's displayed, not parsed.
        results = [
            NoteSearchResult(
                id=r.id,
                title=r.title,
                title_highlight=html.unescape(r.title_highlight),
                snippet=html.unescape(r.snippet).strip(),
                rank=r.rank,
                is_own=r.is_own,
                updated_at=r.updated_at,
            )
            for r in rows
        ]
        if results or len(q.strip()) < 3:
            return results
        # Nothing matched as words: offer similar titles instead. Under three
        # characters there are no trigrams worth comparing.
        fuzzy = await self.notes.search_fuzzy(user.id, q.strip(), limit)
        return [
            NoteSearchResult(
                id=r.id,
                title=r.title,
                title_highlight=r.title,
                snippet=html.unescape(r.snippet),
                rank=r.rank,
                is_own=r.is_own,
                updated_at=r.updated_at,
                fuzzy=True,
            )
            for r in fuzzy
        ]

    async def list(
        self,
        user: User,
        *,
        notebook_id: UUID | None = None,
        unfiled: bool = False,
        archived: bool = False,
        tag_id: int | None = None,
        limit: int = 50,
        offset: int = 0,
    ) -> list[NoteSummary]:
        notes = await self.notes.list_for_user(
            user.id,
            notebook_id=notebook_id,
            unfiled=unfiled,
            archived=archived,
            tag_id=tag_id,
            limit=limit,
            offset=offset,
        )
        return [NoteSummary.model_validate(n) for n in notes]

    async def create(self, payload: NoteCreate, user: User) -> NoteResponse:
        if payload.notebook_id is not None:
            notebook = await self.notebooks.get(payload.notebook_id)
            if notebook is None or notebook.owner_id != user.id:
                raise NotFoundError("Notebook", payload.notebook_id)

        note = await self.notes.create(
            creator_id=user.id,
            title=payload.title,
            content=payload.content,
            notebook_id=payload.notebook_id,
            is_public=payload.is_public,
        )
        return NoteResponse.model_validate(note)

    async def update(self, note_id: UUID, payload: NoteUpdate, user: User) -> NoteResponse:
        note = await self.notes.get(note_id)
        if note is None:
            raise NotFoundError("Note", note_id)
        self._assert_can_write(note, user)

        changes = payload.model_dump(exclude_unset=True)

        if "notebook_id" in changes and changes["notebook_id"] is not None:
            notebook = await self.notebooks.get(changes["notebook_id"])
            if notebook is None or notebook.owner_id != user.id:
                raise NotFoundError("Notebook", changes["notebook_id"])

        for field, value in changes.items():
            setattr(note, field, value)

        await self.db.flush()
        # Reload word_count: it's a GENERATED column, recomputed by
        # Postgres from the new content on this UPDATE, and Python has no
        # way to know the new value without asking the database for it.
        await self.db.refresh(note)
        return NoteResponse.model_validate(note)

    async def delete(self, note_id: UUID, user: User) -> None:
        """Archives, does not hard-delete.

        A real SQL DELETE here would CASCADE to the note's versions,
        flashcards, resources, and knowledge_links - destroying a user's
        whole edit history and every connection in the graph the moment
        they click one delete button. Setting archived=True instead reuses
        the column and partial index (idx_notes_creator_id_updated_at
        WHERE archived = FALSE) that already exist specifically so
        archived notes fall out of the default list view without being
        destroyed. There's no separate "restore" endpoint yet in basic
        CRUD, but the data model already supports one: PATCH
        {"archived": false} un-archives.
        """
        note = await self.notes.get(note_id)
        if note is None:
            raise NotFoundError("Note", note_id)
        self._assert_can_write(note, user)
        note.archived = True
        await self.db.flush()

    async def empty_trash(self, user: User) -> int:
        """purge() for every archived note the user owns, as one DELETE.

        Only archived notes, only the caller's: the WHERE clause is the whole
        safety story, so a live note can't be reached through this.
        """
        return await self.notes.delete_archived(user.id)

    async def purge(self, note_id: UUID, user: User) -> None:
        """The real SQL DELETE that delete() deliberately isn't.

        Only allowed on a note that's already archived: permanent deletion
        is a two-step action (archive, then purge from Trash), so no single
        request — a stray click, a retried call — can destroy a live note
        and its whole history at once. Every FK into notes is ON DELETE
        CASCADE, so this removes the note's versions, links in both
        directions, tag assignments, flashcards, resources and collection
        memberships with it.
        """
        note = await self.notes.get(note_id)
        if note is None:
            raise NotFoundError("Note", note_id)
        self._assert_can_write(note, user)
        if not note.archived:
            raise ValidationError("Move this note to Trash before deleting it permanently")
        await self.notes.delete(note)
