from collections.abc import Sequence
from uuid import UUID

from sqlalchemy import Row, delete, select, text

from app.models.note import Note
from app.models.tag import NoteTag
from app.repositories.base import BaseRepository

# docs/phases/New/03-SQL-LAYER.md Q15, with two changes: chr(1)/chr(2)
# sentinels instead of <mark> as highlight delimiters (see
# NoteSearchResult), and a highlighted title alongside the body snippet.
# It reads from the v_note_search view, which already excludes trashed notes
# and strips the HTML once (plain_content); the planner inlines the view, so
# the GIN index on search_vector is still used. plain_content's regexp must
# match the one in the search_vector generated column (app/models/note.py),
# or the snippet would be built from different text than the one that matched.
_SEARCH_SQL = text("""
    SELECT
        n.id,
        n.title,
        ts_headline('english', n.title, q.query,
                    'HighlightAll=true, StartSel=' || chr(1) || ', StopSel=' || chr(2))
            AS title_highlight,
        ts_headline('english', n.plain_content, q.query,
                    'StartSel=' || chr(1) || ', StopSel=' || chr(2) ||
                    ', MaxWords=30, MinWords=12')
            AS snippet,
        ts_rank_cd(n.search_vector, q.query) AS rank,
        (n.creator_id = :user_id) AS is_own,
        n.updated_at
    FROM v_note_search n,
         websearch_to_tsquery('english', :q) AS q(query)
    WHERE n.search_vector @@ q.query
      AND (n.creator_id = :user_id OR n.is_public)
    ORDER BY rank DESC, n.updated_at DESC
    LIMIT :limit
""")


# Fallback when full-text search finds nothing - usually a typo ("normalisaton").
# Full-text search only matches whole (stemmed) words, so one wrong letter
# misses entirely. `title % :q` is pg_trgm's similarity operator: true when the
# two strings share enough three-letter chunks (similarity above
# pg_trgm.similarity_threshold, 0.3 by default). The operator, not the
# similarity() function, is what idx_notes_title_trgm can serve.
_FUZZY_SQL = text("""
    SELECT
        n.id,
        n.title,
        left(btrim(regexp_replace(n.plain_content, '[[:space:]]+', ' ', 'g')), 160) AS snippet,
        similarity(n.title, :q) AS rank,
        (n.creator_id = :user_id) AS is_own,
        n.updated_at
    FROM v_note_search n
    WHERE n.title % :q
      AND (n.creator_id = :user_id OR n.is_public)
    ORDER BY rank DESC, n.updated_at DESC
    LIMIT :limit
""")

class NoteRepository(BaseRepository[Note]):
    model = Note

    async def list_for_user(
        self,
        user_id: UUID,
        *,
        notebook_id: UUID | None = None,
        unfiled: bool = False,
        archived: bool = False,
        tag_id: int | None = None,
        limit: int = 50,
        offset: int = 0,
    ) -> Sequence[Note]:
        stmt = (
            select(Note)
            .where(Note.creator_id == user_id, Note.archived == archived)
            # id breaks ties, so a page boundary can't fall between two notes
            # with the same updated_at and show one twice (or skip it).
            .order_by(Note.pinned.desc(), Note.updated_at.desc(), Note.id)
            .limit(limit)
            .offset(offset)
        )
        # unfiled is its own flag, not "notebook_id=None" — None already
        # means "don't filter by notebook" (every note), so it can't also
        # mean "only notes with no notebook" (IS NULL) without colliding.
        if unfiled:
            stmt = stmt.where(Note.notebook_id.is_(None))
        elif notebook_id is not None:
            stmt = stmt.where(Note.notebook_id == notebook_id)
        if tag_id is not None:
            # EXISTS, not a JOIN: a semi-join can never return a note twice.
            # Someone else's tag_id just matches nothing — note_tags rows
            # carry the note's owner, and the outer query is the caller's notes.
            stmt = stmt.where(
                select(NoteTag.note_id)
                .where(NoteTag.note_id == Note.id, NoteTag.tag_id == tag_id)
                .exists()
            )
        return (await self.db.execute(stmt)).scalars().all()

    async def delete_archived(self, user_id: UUID) -> int:
        result = await self.db.execute(
            delete(Note)
            .where(Note.creator_id == user_id, Note.archived.is_(True))
            .returning(Note.id)
        )
        return len(result.all())

    async def search(self, user_id: UUID, q: str, limit: int) -> Sequence[Row]:
        # The visibility predicate is in the SQL, not applied afterwards in
        # Python, so LIMIT counts only rows this user may actually see.
        return (
            await self.db.execute(_SEARCH_SQL, {"user_id": user_id, "q": q, "limit": limit})
        ).all()

    async def search_fuzzy(self, user_id: UUID, q: str, limit: int) -> Sequence[Row]:
        return (
            await self.db.execute(_FUZZY_SQL, {"user_id": user_id, "q": q, "limit": limit})
        ).all()
