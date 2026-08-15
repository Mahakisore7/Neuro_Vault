"""provision avatars storage bucket

Revision ID: 18be3816bd41
Revises: 785b4352571a
Create Date: 2026-08-15 18:49:18.464704

"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "18be3816bd41"
down_revision: str | Sequence[str] | None = "785b4352571a"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.execute("""
        INSERT INTO storage.buckets (id, name, public)
        VALUES ('avatars', 'avatars', true)
        ON CONFLICT (id) DO NOTHING;
    """)
    # Objects are stored as "{user_id}/avatar.<ext>" - storage.foldername(name)[1]
    # is that first path segment, so these policies scope writes to the
    # caller's own folder while leaving every avatar publicly readable.
    op.execute("""
        CREATE POLICY "Avatar images are publicly accessible"
        ON storage.objects FOR SELECT
        USING (bucket_id = 'avatars');
    """)
    op.execute("""
        CREATE POLICY "Users can upload their own avatar"
        ON storage.objects FOR INSERT
        WITH CHECK (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text);
    """)
    op.execute("""
        CREATE POLICY "Users can update their own avatar"
        ON storage.objects FOR UPDATE
        USING (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text);
    """)
    op.execute("""
        CREATE POLICY "Users can delete their own avatar"
        ON storage.objects FOR DELETE
        USING (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text);
    """)


def downgrade() -> None:
    """Downgrade schema."""
    op.execute('DROP POLICY IF EXISTS "Users can delete their own avatar" ON storage.objects;')
    op.execute('DROP POLICY IF EXISTS "Users can update their own avatar" ON storage.objects;')
    op.execute('DROP POLICY IF EXISTS "Users can upload their own avatar" ON storage.objects;')
    op.execute('DROP POLICY IF EXISTS "Avatar images are publicly accessible" ON storage.objects;')
    op.execute("DELETE FROM storage.buckets WHERE id = 'avatars';")
