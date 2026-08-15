# Architecture Decision Records

Each records the problem, what else we considered, what we chose, and what it costs.
These are the answers to "why did you do it that way?" — in a viva, in a code review,
and in six months when you have forgotten.

New ADRs get added here as they come up during the build — not written all upfront.

| ADR | Title |
|---|---|
| [0001](0001-tenancy-composite-foreign-keys.md) | Tenancy enforced by composite foreign keys |
| [0002](0002-generated-columns.md) | `word_count` and `search_vector` as generated columns |
| [0003](0003-sql-objects-in-migrations.md) | All SQL objects live in Alembic migrations |
| [0004](0004-two-database-urls.md) | Two database URLs |
| [0005](0005-allowed-origins-parsing.md) | `ALLOWED_ORIGINS` parsing |
| [0006](0006-pyjwt-instead-of-python-jose.md) | PyJWT instead of python-jose |
| [0007](0007-links-originate-from-owned-notes.md) | Links originate from notes you own |
| [0008](0008-row-level-security.md) | Row Level Security is a real boundary |
| [0009](0009-dropping-projects.md) | Dropping `projects` |
| [0010](0010-static-export-frontend.md) | Static export for the frontend |
| [0011](0011-postgresql-not-graph-database.md) | Why PostgreSQL and not a graph database |
| [0012](0012-local-postgres-dev-supabase-prod.md) | Local PostgreSQL for development, Supabase for production |
| [0013](0013-users-mirrors-supabase-auth.md) | `users` mirrors Supabase Auth; it does not reference it |
| [0014](0014-direct-supabase-dev-solo.md) | Direct Supabase development for a solo project |
| [0015](0015-alembic-async-engine-direct.md) | Alembic's async engine is built directly, not via `configparser` |
| [0016](0016-uniqueconstraint-naming.md) | `UniqueConstraint` must never be given an unprefixed literal name |
