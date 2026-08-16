"""note version history trigger and rollback procedure

Revision ID: 9ad6a6ee5f3b
Revises: 18be3816bd41
Create Date: 2026-08-16 08:55:47.136303

"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "9ad6a6ee5f3b"
down_revision: str | Sequence[str] | None = "18be3816bd41"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    # note_versions.id previously had only a Python-side default (default=
    # uuid4), which the ORM applies when building an INSERT - a raw SQL
    # INSERT issued from inside fn_create_note_version() below never goes
    # through SQLAlchemy, so without this it violates the NOT NULL on `id`
    # the moment the trigger fires.
    op.execute("ALTER TABLE note_versions ALTER COLUMN id SET DEFAULT gen_random_uuid()")

    # Raw SQL, not op.create_index(): Alembic's postgresql_ops is for operator
    # classes, not per-column sort direction, and this index exists
    # specifically to serve "latest versions of this note first" without a
    # sort step.
    op.execute("""
        CREATE INDEX idx_note_versions_note_id_version_num
            ON note_versions (note_id, version_num DESC)
    """)

    op.execute("""
        CREATE OR REPLACE FUNCTION fn_create_note_version()
        RETURNS TRIGGER
        LANGUAGE plpgsql
        AS $$
        BEGIN
            -- Only version real content changes. IS DISTINCT FROM is NULL-safe:
            -- plain <> returns NULL when either side is NULL, and a NULL condition
            -- is not true, so a note gaining its first content would never version.
            IF NEW.title   IS DISTINCT FROM OLD.title
            OR NEW.content IS DISTINCT FROM OLD.content THEN

                INSERT INTO note_versions (note_id, version_num, title, content, edited_by)
                VALUES (
                    OLD.id,
                    COALESCE(
                        (SELECT MAX(version_num) FROM note_versions WHERE note_id = OLD.id),
                        0
                    ) + 1,
                    OLD.title,      -- the PREVIOUS state - this is what rollback restores
                    OLD.content,
                    OLD.creator_id
                );
            END IF;
            RETURN NEW;
        END;
        $$
    """)
    op.execute("""
        CREATE TRIGGER trg_notes_create_version
            BEFORE UPDATE ON notes
            FOR EACH ROW
            EXECUTE FUNCTION fn_create_note_version()
    """)

    op.execute("""
        CREATE OR REPLACE PROCEDURE sp_rollback_note_version(
            p_note_id     UUID,
            p_version_num INTEGER,
            p_actor_id    UUID
        )
        LANGUAGE plpgsql
        AS $$
        DECLARE
            v_title   VARCHAR(255);
            v_content TEXT;
            v_owner   UUID;
        BEGIN
            SELECT creator_id INTO v_owner FROM notes WHERE id = p_note_id;
            IF v_owner IS NULL THEN
                RAISE EXCEPTION 'Note % does not exist', p_note_id
                    USING ERRCODE = 'no_data_found';
            END IF;

            -- Defence in depth. The service layer checks this too; a procedure that
            -- can be CALLed from psql must not rely on the caller having checked.
            IF v_owner <> p_actor_id THEN
                RAISE EXCEPTION 'User % may not roll back note %', p_actor_id, p_note_id
                    USING ERRCODE = 'insufficient_privilege';
            END IF;

            SELECT title, content INTO v_title, v_content
            FROM note_versions
            WHERE note_id = p_note_id AND version_num = p_version_num;

            IF NOT FOUND THEN
                RAISE EXCEPTION 'Version % of note % does not exist',
                    p_version_num, p_note_id USING ERRCODE = 'no_data_found';
            END IF;

            -- This UPDATE fires trg_notes_create_version, so the state being
            -- replaced is itself versioned first. Rollback is never destructive.
            UPDATE notes
               SET title = v_title, content = v_content, updated_at = now()
             WHERE id = p_note_id;
        END;
        $$
    """)


def downgrade() -> None:
    """Downgrade schema."""
    op.execute("DROP PROCEDURE IF EXISTS sp_rollback_note_version(UUID, INTEGER, UUID)")
    op.execute("DROP TRIGGER IF EXISTS trg_notes_create_version ON notes")
    op.execute("DROP FUNCTION IF EXISTS fn_create_note_version()")
    op.drop_index("idx_note_versions_note_id_version_num", table_name="note_versions")
    op.execute("ALTER TABLE note_versions ALTER COLUMN id DROP DEFAULT")
