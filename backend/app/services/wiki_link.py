import html
import re
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.note import Note

# [[Title]] or [[Title|shown text]]. No brackets inside, and a sane length:
# a title column is 255 characters.
_WIKI_LINK_PATTERN = re.compile(r"\[\[([^\[\]|\n]{1,255})(?:\|[^\[\]\n]{0,255})?\]\]")
# Block boundaries become line breaks, which the pattern never crosses, so
# "[[foo" ending one paragraph can't pair with "bar]]" starting the next.
_BLOCK_BREAK = re.compile(r"</(?:p|li|h[1-6]|blockquote|pre)>|<br\s*/?>", re.IGNORECASE)
# A note pasted full of [[...]] shouldn't turn one save into thousands of
# lookups and inserts.
MAX_WIKI_LINKS_PER_NOTE = 200

# Wiki-links are filed under the symmetric "relates_to": a textual mention
# doesn't assert a direction the way a hand-picked "prerequisite_for" does.
# (The design doc said 'related', a type the seed never created.)
WIKI_REL_TYPE_NAME = "relates_to"


class WikiLinkService:
    """Keeps knowledge_links in step with the [[title]] references in a note.

    Runs after every save that changes content: works out which titles the
    text references now, resolves them against the author's own live notes,
    and reconciles the graph to match. It only ever deletes rows it created
    (origin = 'wiki'); hand-made links (origin = 'manual') are invisible to
    it, so editing a sentence can never destroy a link someone built on
    purpose. See docs/phases/New/02-DATABASE.md, "origin is what makes
    automatic linking safe".
    """

    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    @staticmethod
    def extract_titles(content: str | None) -> list[str]:
        """Distinct referenced titles, in order of first appearance."""
        if not content:
            return []
        # Tags out (Tiptap writes well-formed HTML; inline tags vanish so
        # [[BC<b>NF</b>]] still reads "BCNF"), then entities decoded so
        # [[Q&amp;A]] matches a note titled "Q&A".
        plain = html.unescape(re.sub(r"<[^>]+>", "", _BLOCK_BREAK.sub("\n", content)))
        seen: dict[str, str] = {}
        for match in _WIKI_LINK_PATTERN.finditer(plain):
            title = " ".join(match.group(1).split())
            if title and title.lower() not in seen:
                seen[title.lower()] = title
            if len(seen) >= MAX_WIKI_LINKS_PER_NOTE:
                break
        return list(seen.values())

    async def reconcile(self, note: Note) -> list[str]:
        """Sync this note's wiki edges; returns the titles that matched no note."""
        titles = self.extract_titles(note.content)
        resolved: dict[str, UUID] = {}
        if titles:
            # A title can exist in several notebooks: DISTINCT ON picks one
            # deterministically (the most recently edited) instead of linking
            # all of them or an arbitrary one. Own, live notes only: a link
            # can't cross ownership (ADR-007) or point into Trash.
            rows = (
                await self.db.execute(
                    text(
                        """
                        SELECT DISTINCT ON (lower(title)) lower(title) AS key, id
                        FROM notes
                        WHERE creator_id = :user_id
                          AND id <> :note_id
                          AND archived = FALSE
                          AND lower(title) = ANY(:titles)
                        ORDER BY lower(title), updated_at DESC
                        """
                    ),
                    {
                        "user_id": note.creator_id,
                        "note_id": note.id,
                        "titles": [t.lower() for t in titles],
                    },
                )
            ).all()
            by_key = {row.key: row.id for row in rows}
            resolved = {t: by_key[t.lower()] for t in titles if t.lower() in by_key}
        unresolved = [t for t in titles if t not in resolved]
        desired = set(resolved.values())

        # Remove this note's wiki edges whose [[title]] is gone from the text.
        # One statement: the WHERE clause is the safety boundary
        # (origin = 'wiki', this note only).
        await self.db.execute(
            text(
                """
                DELETE FROM knowledge_links
                WHERE source_note_id = :note_id
                  AND origin = 'wiki'
                  AND NOT (target_note_id = ANY(:desired))
                """
            ),
            {"note_id": note.id, "desired": list(desired)},
        )

        if desired:
            # Add the new ones, skipping any target this note already links to
            # by any route: a hand-made edge (whatever its type) wins and is
            # never duplicated. ON CONFLICT covers two saves racing.
            await self.db.execute(
                text(
                    """
                    INSERT INTO knowledge_links
                        (source_note_id, target_note_id, rel_type_id, created_by, origin)
                    SELECT :note_id, t.id, rt.id, :user_id, 'wiki'
                    FROM unnest(CAST(:desired AS uuid[])) AS t(id)
                    CROSS JOIN relationship_types rt
                    WHERE rt.name = :rel_type
                      AND NOT EXISTS (
                          SELECT 1 FROM knowledge_links kl
                          WHERE kl.source_note_id = :note_id AND kl.target_note_id = t.id
                      )
                    ON CONFLICT DO NOTHING
                    """
                ),
                {
                    "note_id": note.id,
                    "user_id": note.creator_id,
                    "desired": list(desired),
                    "rel_type": WIKI_REL_TYPE_NAME,
                },
            )
        await self.db.flush()
        return unresolved
