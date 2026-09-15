from collections.abc import Sequence
from uuid import UUID

from sqlalchemy import Row, or_, select, text

from app.models.link import KnowledgeLink, RelationshipType
from app.repositories.base import BaseRepository

# docs/phases/New/03-SQL-LAYER.md §3.6 — the recursive CTE, unchanged, with
# one addition: the visibility predicate (creator_id = :user_id OR is_public)
# on BOTH the anchor and the recursive term. Without it on the recursive
# term, traversal could walk THROUGH a note the caller can't read to reach
# one they can, leaking the fact that a private note connects two others.
# Restricting it on the anchor too turns "root note isn't visible" into an
# empty result here, which the service layer turns into the same 404 every
# other not-visible-note case gets (see LinkService.get_graph).
_GRAPH_SQL = text("""
    WITH RECURSIVE connected_graph AS (
        SELECT
            n.id, n.title, n.is_public, n.creator_id,
            0 AS depth, ARRAY[n.id] AS visited_path
        FROM notes n
        WHERE n.id = :root_id
          AND n.archived = false
          AND (n.creator_id = :user_id OR n.is_public)

        UNION ALL

        SELECT
            nxt.id, nxt.title, nxt.is_public, nxt.creator_id,
            g.depth + 1, g.visited_path || nxt.id
        FROM connected_graph g
        JOIN knowledge_links kl
          ON kl.source_note_id = g.id OR kl.target_note_id = g.id
        JOIN notes nxt
          ON nxt.id = CASE WHEN kl.source_note_id = g.id
                           THEN kl.target_note_id
                           ELSE kl.source_note_id END
        WHERE g.depth < :max_depth
          AND nxt.id <> ALL(g.visited_path)
          AND nxt.archived = false
          AND (nxt.creator_id = :user_id OR nxt.is_public)
    )
    SELECT DISTINCT ON (id) id, title, is_public, depth
    FROM connected_graph
    ORDER BY id, depth
""")


class RelationshipTypeRepository(BaseRepository[RelationshipType]):
    model = RelationshipType

    async def list_all(self) -> Sequence[RelationshipType]:
        stmt = select(RelationshipType).order_by(RelationshipType.name)
        return (await self.db.execute(stmt)).scalars().all()


class KnowledgeLinkRepository(BaseRepository[KnowledgeLink]):
    model = KnowledgeLink

    async def list_for_note(self, note_id: UUID) -> Sequence[KnowledgeLink]:
        """1-hop, either direction — a note's directly linked neighbors."""
        stmt = select(KnowledgeLink).where(
            or_(KnowledgeLink.source_note_id == note_id, KnowledgeLink.target_note_id == note_id)
        )
        return (await self.db.execute(stmt)).scalars().all()

    async def get_graph(
        self, root_id: UUID, user_id: UUID, max_depth: int
    ) -> tuple[Sequence[Row], Sequence[Row]]:
        node_rows = (
            await self.db.execute(
                _GRAPH_SQL, {"root_id": root_id, "user_id": user_id, "max_depth": max_depth}
            )
        ).all()
        if not node_rows:
            return [], []

        node_ids = [row.id for row in node_rows]
        # The induced subgraph on the visited node set — every edge between
        # two nodes the traversal reached, not just the ones BFS happened to
        # use to first reach each node. Two notes can be linked more than
        # once (different rel_type_id, see the UNIQUE constraint), and both
        # rows belong in the rendered graph.
        edges_stmt = (
            select(KnowledgeLink, RelationshipType.name.label("rel_type_name"))
            .join(RelationshipType, RelationshipType.id == KnowledgeLink.rel_type_id)
            .where(
                KnowledgeLink.source_note_id.in_(node_ids),
                KnowledgeLink.target_note_id.in_(node_ids),
            )
        )
        edge_rows = (await self.db.execute(edges_stmt)).all()
        return node_rows, edge_rows
