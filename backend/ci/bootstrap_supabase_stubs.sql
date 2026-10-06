-- CI-only. Two migrations reach outside the application's own schema into
-- Supabase-platform schemas that only exist on an actual Supabase project:
--   - 20260815_1830_sync_auth_users_via_trigger.py  -> auth.users
--   - 20260815_1849_provision_avatars_storage_bucket.py -> storage.buckets,
--     storage.objects, auth.uid(), storage.foldername()
--
-- A plain `postgres:16` container (what CI runs, for a clean/fast/portable
-- job) has neither. This script fakes just enough of both schemas — table
-- shapes and function signatures, not GoTrue's or Storage's actual behavior
-- — for `alembic upgrade head` to apply the SAME migrations that run against
-- the real database, so a broken migration is caught here instead of only
-- discovered against Supabase.
--
-- Never run this anywhere but CI or a throwaway local database: a real project
-- already has both schemas, provisioned and owned by Supabase. It is safe to
-- re-run (every statement is IF NOT EXISTS / OR REPLACE / idempotent GRANT).

CREATE SCHEMA IF NOT EXISTS auth;

CREATE TABLE IF NOT EXISTS auth.users (
    id uuid PRIMARY KEY,
    email text,
    raw_user_meta_data jsonb NOT NULL DEFAULT '{}'::jsonb
);

-- Same body as Supabase's own auth.uid(): PostgREST puts the verified JWT's
-- claims into these settings for each request, and the function reads `sub`
-- from them (older format first, then the JSON one). Outside a request both
-- are unset, so it returns NULL. Tests impersonate a user by setting
-- request.jwt.claim.sub themselves (see app/tests/test_row_level_security.py).
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
    LANGUAGE sql STABLE
    AS $$
        SELECT COALESCE(
            NULLIF(current_setting('request.jwt.claim.sub', true), ''),
            (NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
        )::uuid
    $$;

-- The two roles PostgREST switches to for every request: `anon` with no JWT,
-- `authenticated` with one. RLS policies are written against these, so the
-- tests need them to exist. Grants mirror Supabase's defaults: both roles get
-- table privileges on everything in `public`, and RLS policies - not GRANTs -
-- decide which ROWS they can touch. ALTER DEFAULT PRIVILEGES applies to tables
-- the migrations create afterwards, as on a real project.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
        CREATE ROLE anon NOLOGIN NOINHERIT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
        CREATE ROLE authenticated NOLOGIN NOINHERIT;
    END IF;
END
$$;
GRANT USAGE ON SCHEMA public, auth TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO anon, authenticated;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT USAGE, SELECT ON SEQUENCES TO anon, authenticated;

CREATE SCHEMA IF NOT EXISTS storage;

CREATE TABLE IF NOT EXISTS storage.buckets (
    id text PRIMARY KEY,
    name text NOT NULL,
    public boolean NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS storage.objects (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    bucket_id text REFERENCES storage.buckets (id),
    name text
);

ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION storage.foldername(name text) RETURNS text[]
    LANGUAGE sql IMMUTABLE
    AS $$ SELECT string_to_array(name, '/') $$;
