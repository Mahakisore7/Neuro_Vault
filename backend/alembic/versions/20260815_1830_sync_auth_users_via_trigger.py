"""sync auth users via trigger

Revision ID: 785b4352571a
Revises: 551ab54ba43b
Create Date: 2026-08-15 18:30:27.512574

"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "785b4352571a"
down_revision: str | Sequence[str] | None = "551ab54ba43b"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    # SECURITY DEFINER + a pinned search_path: the INSERT this trigger fires
    # runs as whatever role GoTrue uses to write auth.users (supabase_auth_admin),
    # which has no privileges on public.users. SECURITY DEFINER makes it run as
    # the function's owner instead. ADR-017.
    op.execute("""
        CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
        RETURNS trigger
        LANGUAGE plpgsql
        SECURITY DEFINER
        SET search_path = public
        AS $$
        BEGIN
            INSERT INTO public.users (id, email, display_name, avatar_url)
            VALUES (
                NEW.id,
                NEW.email,
                COALESCE(
                    NULLIF(btrim(NEW.raw_user_meta_data ->> 'display_name'), ''),
                    NULLIF(btrim(NEW.raw_user_meta_data ->> 'full_name'), ''),
                    NULLIF(btrim(NEW.raw_user_meta_data ->> 'name'), ''),
                    split_part(NEW.email, '@', 1)
                ),
                NEW.raw_user_meta_data ->> 'avatar_url'
            )
            -- get_current_user (app/core/dependencies.py) can still win this
            -- race and create the row first on an unrelated first request;
            -- either creator is fine, so the trigger just backs off.
            ON CONFLICT (id) DO NOTHING;
            RETURN NEW;
        END;
        $$;
    """)
    op.execute("""
        CREATE TRIGGER on_auth_user_created
        AFTER INSERT ON auth.users
        FOR EACH ROW
        EXECUTE FUNCTION public.handle_new_auth_user();
    """)


def downgrade() -> None:
    """Downgrade schema."""
    op.execute("DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;")
    op.execute("DROP FUNCTION IF EXISTS public.handle_new_auth_user();")
