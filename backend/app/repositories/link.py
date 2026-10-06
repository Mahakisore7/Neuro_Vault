from collections.abc import Sequence
from uuid import UUID

from sqlalchemy import Row, or_, select, text

from app.models.link import KnowledgeLink, RelationshipType
from app.repositories.base import BaseRepository

# Breadth-first traversal, done by the database function fn_note_distances()
# (migration b7e2c4f9a031). It replaced a recursive CTE that carried a visited
# array per *path*: that stopped cycles but still enumerated every simple path,
# so a densely linked graph grew exponentially with depth. The function keeps
# one global visited set and expands each note once.
#
# Visibility is inside the function, on the root and on every hop: only live
# notes the caller owns or that are public. Traversal can't walk THROUGH a
# private note to reach a visible one, and a root the caller can't see gives
# an empty result, which LinkService.get_graph turns into the usual 404.
_GRAPH_SQL = text("""
    SELECT n.id, n.title, n.is_public, d.depth
    FROM fn_note_distances(:root_id, :user_id, :max_depth) d
    JOIN notes n ON n.id = d.note_id
    ORDER BY d.depth, n.title
""")

# Step 0 is the start note, the last step the target; empty if unreachable.
_PATH_SQL = text("""
    SELECT p.step, p.note_id, p.title
    FROM fn_shortest_path(:from_id, :to_id, :user_id, :max_depth) p
    ORDER BY p.step
""")

_STATS_SQL = text("""
    SELECT s.outgoing_count, s.incoming_count, s.degree, s.version_count,
           fn_max_graph_depth(s.note_id, :user_id) AS max_depth
    FROM v_note_graph_stats s
    WHERE s.note_id = :note_id
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

    async def shortest_path(
        self, from_id: UUID, to_id: UUID, user_id: UUID, max_depth: int
    ) -> Sequence[Row]:
        params = {"from_id": from_id, "to_id": to_id, "user_id": user_id, "max_depth": max_depth}
        return (await self.db.execute(_PATH_SQL, params)).all()

    async def stats(self, note_id: UUID, user_id: UUID) -> Row | None:
        params = {"note_id": note_id, "user_id": user_id}
        return (await self.db.execute(_STATS_SQL, params)).one_or_none()
