"""activity log and notification triggers

Revision ID: 5d2e7a1c4f90
Revises: 3c1f0d8a9b42
Create Date: 2026-10-05 15:00:00.000000

"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "5d2e7a1c4f90"
down_revision: str | Sequence[str] | None = "3c1f0d8a9b42"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    # notifications.is_read had only a Python-side default. The trigger below
    # INSERTs with raw SQL that never goes through SQLAlchemy, so without a
    # server default every notification would violate NOT NULL - the same
    # trap note_versions.id fell into (see the version-history migration).
    op.execute("ALTER TABLE notifications ALTER COLUMN is_read SET DEFAULT FALSE")

    # ── T3: activity log on notes ─────────────────────────────────────────────
    # SECURITY DEFINER + pinned search_path: the function writes audit rows
    # with its owner's rights, so no client role ever needs INSERT on
    # activity_logs (an audit row a client can write is one it can forge).
    op.execute("""
        CREATE OR REPLACE FUNCTION fn_log_note_activity()
        RETURNS TRIGGER
        LANGUAGE plpgsql
        SECURITY DEFINER
        SET search_path = public, pg_temp
        AS $$
        DECLARE
            v_row     notes%ROWTYPE;
            v_action  VARCHAR(50);
            v_event   TEXT;
            v_changes TEXT[] := ARRAY[]::TEXT[];
        BEGIN
            IF TG_OP = 'DELETE' THEN
                v_row := OLD;
                v_action := 'delete';
                v_event := 'deleted';
                -- Deleting a user cascades to their notes. By then the users
                -- row is gone, so logging against it would violate
                -- activity_logs.user_id's FK and abort the account deletion.
                IF NOT EXISTS (SELECT 1 FROM users WHERE id = OLD.creator_id) THEN
                    RETURN OLD;
                END IF;
            ELSIF TG_OP = 'INSERT' THEN
                v_row := NEW;
                v_action := 'create';
                v_event := 'created';
            ELSE
                v_row := NEW;
                v_action := 'update';
                -- IS DISTINCT FROM is NULL-safe (content and notebook_id are
                -- nullable). Pinning and other cosmetic changes aren't listed,
                -- so they log nothing.
                IF NEW.title IS DISTINCT FROM OLD.title THEN
                    v_changes := v_changes || 'title'::TEXT;
                END IF;
                IF NEW.content IS DISTINCT FROM OLD.content THEN
                    v_changes := v_changes || 'content'::TEXT;
                END IF;
                IF NEW.notebook_id IS DISTINCT FROM OLD.notebook_id THEN
                    v_changes := v_changes || 'notebook_id'::TEXT;
                END IF;
                IF NEW.is_public IS DISTINCT FROM OLD.is_public THEN
                    v_changes := v_changes || 'is_public'::TEXT;
                END IF;
                IF NEW.archived IS DISTINCT FROM OLD.archived THEN
                    v_changes := v_changes || 'archived'::TEXT;
                END IF;

                IF cardinality(v_changes) = 0 THEN
                    RETURN NEW;
                END IF;

                -- One human-readable event per row, most significant first;
                -- the full list stays in metadata.changes.
                v_event := CASE
                    WHEN 'archived' = ANY (v_changes) THEN
                        CASE WHEN NEW.archived THEN 'trashed' ELSE 'restored' END
                    WHEN 'is_public' = ANY (v_changes) THEN
                        CASE WHEN NEW.is_public THEN 'published' ELSE 'unpublished' END
                    WHEN 'notebook_id' = ANY (v_changes) THEN 'moved'
                    ELSE 'edited'
                END;
            END IF;

            -- The column is "metadata" - the SQLAlchemy attribute is
            -- metadata_ only because `metadata` is reserved on DeclarativeBase.
            INSERT INTO activity_logs (user_id, action_type, entity_type, entity_id, metadata)
            VALUES (
                v_row.creator_id,
                v_action,
                'note',
                v_row.id,
                jsonb_build_object(
                    'event',      v_event,
                    'title',      v_row.title,
                    'word_count', v_row.word_count,
                    'is_public',  v_row.is_public,
                    'changes',    to_jsonb(v_changes)
                )
            );

            -- Ignored for an AFTER trigger, but correct if the timing is ever
            -- changed: a BEFORE DELETE trigger returning NEW (NULL) would
            -- silently cancel the delete.
            RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
        END;
        $$
    """)
    # AFTER: only log what was actually stored. A BEFORE trigger runs ahead of
    # constraint checks, so a rejected write would still leave an audit row.
    op.execute("""
        CREATE TRIGGER trg_notes_activity_log
            AFTER INSERT OR UPDATE OR DELETE ON notes
            FOR EACH ROW
            EXECUTE FUNCTION fn_log_note_activity()
    """)

    # ── Activity log on knowledge links ───────────────────────────────────────
    op.execute("""
        CREATE OR REPLACE FUNCTION fn_log_link_activity()
        RETURNS TRIGGER
        LANGUAGE plpgsql
        SECURITY DEFINER
        SET search_path = public, pg_temp
        AS $$
        DECLARE
            v_link         knowledge_links%ROWTYPE;
            v_source_title VARCHAR(255);
            v_target_title VARCHAR(255);
        BEGIN
            IF TG_OP = 'DELETE' THEN
                v_link := OLD;
            ELSE
                v_link := NEW;
            END IF;

            SELECT title INTO v_source_title FROM notes WHERE id = v_link.source_note_id;
            SELECT title INTO v_target_title FROM notes WHERE id = v_link.target_note_id;

            -- A link deleted because one of its notes was purged (ON DELETE
            -- CASCADE) isn't something the user did to the link - the note's
            -- own 'deleted' row already records it. Same for a deleted user.
            IF TG_OP = 'DELETE' AND (
                v_source_title IS NULL
                OR v_target_title IS NULL
                OR NOT EXISTS (SELECT 1 FROM users WHERE id = OLD.created_by)
            ) THEN
                RETURN OLD;
            END IF;

            INSERT INTO activity_logs (user_id, action_type, entity_type, entity_id, metadata)
            VALUES (
                v_link.created_by,
                CASE WHEN TG_OP = 'DELETE' THEN 'unlink' ELSE 'link' END,
                'link',
                v_link.id,
                jsonb_build_object(
                    'event',          CASE WHEN TG_OP = 'DELETE' THEN 'unlinked' ELSE 'linked' END,
                    'source_note_id', v_link.source_note_id,
                    'source_title',   v_source_title,
                    'target_note_id', v_link.target_note_id,
                    'target_title',   v_target_title,
                    'relationship',   (SELECT name FROM relationship_types
                                       WHERE id = v_link.rel_type_id)
                )
            );
            RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
        END;
        $$
    """)
    op.execute("""
        CREATE TRIGGER trg_knowledge_links_activity_log
            AFTER INSERT OR DELETE ON knowledge_links
            FOR EACH ROW
            EXECUTE FUNCTION fn_log_link_activity()
    """)

    # ── T2: notify on inbound link ────────────────────────────────────────────
    # ADR-007 is what makes this message true: links can only originate from
    # notes the creator owns, so "someone linked to your note" always means
    # someone else, on their own note, pointing at yours.
    op.execute("""
        CREATE OR REPLACE FUNCTION fn_notify_on_link()
        RETURNS TRIGGER
        LANGUAGE plpgsql
        SECURITY DEFINER
        SET search_path = public, pg_temp
        AS $$
        DECLARE
            v_target_owner UUID;
            v_target_title VARCHAR(255);
            v_source_title VARCHAR(255);
        BEGIN
            SELECT creator_id, title INTO v_target_owner, v_target_title
            FROM notes WHERE id = NEW.target_note_id;

            -- Do not notify people about their own actions.
            IF v_target_owner IS NOT NULL AND v_target_owner <> NEW.created_by THEN
                SELECT title INTO v_source_title FROM notes WHERE id = NEW.source_note_id;

                INSERT INTO notifications (user_id, type, title, body, link_url)
                VALUES (
                    v_target_owner,
                    'link_created',
                    'Someone linked to your note',
                    format('"%s" now links to your note "%s"',
                           COALESCE(v_source_title, 'A note'), v_target_title),
                    format('/notes/%s', NEW.target_note_id)
                );
            END IF;
            RETURN NEW;
        END;
        $$
    """)
    op.execute("""
        CREATE TRIGGER trg_knowledge_links_notify
            AFTER INSERT ON knowledge_links
            FOR EACH ROW
            EXECUTE FUNCTION fn_notify_on_link()
    """)

    # ── Indexes ───────────────────────────────────────────────────────────────
    # Plain CREATE INDEX (not CONCURRENTLY): both tables are empty until the
    # triggers above exist, so there is nothing to lock out.
    #
    # The activity feed reads "this user's latest rows by id"; a B-tree on
    # (user_id, id) serves it scanned backwards.
    op.execute("CREATE INDEX idx_activity_logs_user_id_id ON activity_logs (user_id, id)")
    # The bell badge polls "how many unread" every 30s. PARTIAL on unread
    # only: read notifications pile up forever and never match this query,
    # so leaving them out keeps the index small no matter how old the account.
    op.execute("""
        CREATE INDEX idx_notifications_user_id_created_at
            ON notifications (user_id, created_at DESC)
            WHERE is_read = FALSE
    """)
    # The dropdown lists recent notifications, read ones included - which
    # the partial index above deliberately can't serve.
    op.execute("CREATE INDEX idx_notifications_user_id_id ON notifications (user_id, id)")


def downgrade() -> None:
    """Downgrade schema."""
    op.execute("DROP INDEX IF EXISTS idx_notifications_user_id_id")
    op.execute("DROP INDEX IF EXISTS idx_notifications_user_id_created_at")
    op.execute("DROP INDEX IF EXISTS idx_activity_logs_user_id_id")
    op.execute("DROP TRIGGER IF EXISTS trg_knowledge_links_notify ON knowledge_links")
    op.execute("DROP FUNCTION IF EXISTS fn_notify_on_link()")
    op.execute("DROP TRIGGER IF EXISTS trg_knowledge_links_activity_log ON knowledge_links")
    op.execute("DROP FUNCTION IF EXISTS fn_log_link_activity()")
    op.execute("DROP TRIGGER IF EXISTS trg_notes_activity_log ON notes")
    op.execute("DROP FUNCTION IF EXISTS fn_log_note_activity()")
    op.execute("ALTER TABLE notifications ALTER COLUMN is_read DROP DEFAULT")
