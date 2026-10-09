from typing import Any
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

# The whole export is one statement: each key is a correlated subquery that
# aggregates one table's rows for this user into a JSON array, so the
# document is a consistent snapshot (a single statement sees a single MVCC
# snapshot) with no N+1 round trips. COALESCE turns "no rows" (NULL from
# jsonb_agg) into [] so the shape never changes. Internal columns are
# dropped: search_vector is derived and the owner ids are all the caller.
_EXPORT_SQL = text(
    """
    SELECT jsonb_build_object(
        'format',      'neurovault-export',
        'version',     1,
        'exported_at', now(),
        'user', (
            SELECT to_jsonb(u) - 'last_seen_at' FROM users u WHERE u.id = :uid
        ),
        'workspaces', COALESCE((
            SELECT jsonb_agg(to_jsonb(w) - 'owner_id' ORDER BY w.created_at)
            FROM workspaces w WHERE w.owner_id = :uid
        ), '[]'::jsonb),
        'notebooks', COALESCE((
            SELECT jsonb_agg(to_jsonb(nb) - 'owner_id' ORDER BY nb.created_at)
            FROM notebooks nb WHERE nb.owner_id = :uid
        ), '[]'::jsonb),
        'notes', COALESCE((
            SELECT jsonb_agg(to_jsonb(n) - 'search_vector' - 'creator_id' ORDER BY n.created_at)
            FROM notes n WHERE n.creator_id = :uid
        ), '[]'::jsonb),
        'tags', COALESCE((
            SELECT jsonb_agg(
                       to_jsonb(t) - 'user_id'
                       || jsonb_build_object('note_ids', COALESCE((
                              SELECT jsonb_agg(nt.note_id ORDER BY nt.note_id)
                              FROM note_tags nt WHERE nt.tag_id = t.id
                          ), '[]'::jsonb))
                       ORDER BY t.name)
            FROM tags t WHERE t.user_id = :uid
        ), '[]'::jsonb),
        'links', COALESCE((
            SELECT jsonb_agg(
                       to_jsonb(kl) - 'created_by' || jsonb_build_object('rel_type', rt.name)
                       ORDER BY kl.created_at)
            FROM knowledge_links kl
            JOIN relationship_types rt ON rt.id = kl.rel_type_id
            WHERE kl.created_by = :uid
        ), '[]'::jsonb),
        'collections', COALESCE((
            SELECT jsonb_agg(
                       to_jsonb(c) - 'user_id'
                       || jsonb_build_object('note_ids', COALESCE((
                              SELECT jsonb_agg(ci.note_id ORDER BY ci.position)
                              FROM collection_items ci WHERE ci.collection_id = c.id
                          ), '[]'::jsonb))
                       ORDER BY c.created_at)
            FROM collections c WHERE c.user_id = :uid
        ), '[]'::jsonb),
        'flashcards', COALESCE((
            SELECT jsonb_agg(to_jsonb(f) - 'owner_id' ORDER BY f.created_at)
            FROM flashcards f WHERE f.owner_id = :uid
        ), '[]'::jsonb)
    )
    """
)


class AccountRepository:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def export(self, user_id: UUID) -> dict[str, Any]:
        return (await self.db.execute(_EXPORT_SQL, {"uid": user_id})).scalar_one()

    async def delete(self, user_id: UUID) -> None:
        # The app's row first: ON DELETE CASCADE removes every workspace,
        # note, link, card... the user owns. Then the Supabase login itself,
        # so the account can't simply be signed back into. Both in the
        # request's one transaction - all or nothing.
        await self.db.execute(text("DELETE FROM users WHERE id = :uid"), {"uid": user_id})
        await self.db.execute(text("DELETE FROM auth.users WHERE id = :uid"), {"uid": user_id})

    async def login_exists(self, user_id: UUID) -> bool:
        return (
            await self.db.execute(
                text("SELECT EXISTS (SELECT 1 FROM auth.users WHERE id = :uid)"),
                {"uid": user_id},
            )
        ).scalar_one()
