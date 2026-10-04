from collections.abc import Sequence
from uuid import UUID

from sqlalchemy import Row, select, text

from app.models.note import Note
from app.repositories.base import BaseRepository

# docs/phases/New/03-SQL-LAYER.md Q15, with two changes: chr(1)/chr(2)
# sentinels instead of <mark> as highlight delimiters (see
# NoteSearchResult), and a highlighted title alongside the body snippet.
# The regexp_replace inside ts_headline must match the one in the
# search_vector generated column (app/models/note.py), or the snippet would
# be built from different text than the one that matched.
_SEARCH_SQL = text("""
    SELECT
        n.id,
        n.title,
        ts_headline('english', n.title, q.query,
                    'HighlightAll=true, StartSel=' || chr(1) || ', StopSel=' || chr(2))
            AS title_highlight,
        ts_headline('english',
                    regexp_replace(COALESCE(n.content, ''), '<[^>]+>', ' ', 'g'),
                    q.query,
                    'StartSel=' || chr(1) || ', StopSel=' || chr(2) ||
                    ', MaxWords=30, MinWords=12')
            AS snippet,
        ts_rank_cd(n.search_vector, q.query) AS rank,
        (n.creator_id = :user_id) AS is_own,
        n.updated_at
    FROM notes n,
         websearch_to_tsquery('english', :q) AS q(query)
    WHERE n.search_vector @@ q.query
      AND n.archived = false
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
        limit: int = 50,
        offset: int = 0,
    ) -> Sequence[Note]:
        stmt = (
            select(Note)
            .where(Note.creator_id == user_id, Note.archived == archived)
            .order_by(Note.pinned.desc(), Note.updated_at.desc())
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
        return (await self.db.execute(stmt)).scalars().all()

    async def search(self, user_id: UUID, q: str, limit: int) -> Sequence[Row]:
        # The visibility predicate is in the SQL, not applied afterwards in
        # Python, so LIMIT counts only rows this user may actually see.
        return (
            await self.db.execute(_SEARCH_SQL, {"user_id": user_id, "q": q, "limit": limit})
        ).all()
