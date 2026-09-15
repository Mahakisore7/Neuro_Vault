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
-- Never run this anywhere but CI: a real project already has both schemas,
-- provisioned and owned by Supabase.

CREATE SCHEMA IF NOT EXISTS auth;

CREATE TABLE IF NOT EXISTS auth.users (
    id uuid PRIMARY KEY,
    email text,
    raw_user_meta_data jsonb NOT NULL DEFAULT '{}'::jsonb
);

-- Real auth.uid() reads the JWT claim GoTrue set for the current request.
-- Nothing in CI authenticates as a real Supabase session, so NULL is the
-- only honest stand-in.
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
    LANGUAGE sql STABLE
    AS $$ SELECT NULL::uuid $$;

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
