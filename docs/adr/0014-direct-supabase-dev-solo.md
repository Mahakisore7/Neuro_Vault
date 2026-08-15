# ADR-014 — Direct Supabase development for a solo project

**Problem.** [ADR-012](0012-local-postgres-dev-supabase-prod.md) chose local
PostgreSQL for development specifically to protect a **two-person team's** shared
Supabase project from destructive migration commands and `alembic_version`
collisions. This project has one developer.

**Alternatives considered.**

- *Follow ADR-012 as written.* Run `postgres:16-alpine` locally, keep Supabase for
  auth and eventual deploy. Correct for a team; adds a moving part (Docker, a second
  schema to keep in sync) that buys nothing when there is no second developer to
  protect from.
- *Point directly at Supabase's Postgres, in every environment.* Chosen.

**Chosen.** `DATABASE_URL` / `DATABASE_URL_SYNC` point at Supabase's session pooler
(port 5432, see `01-FOUNDATION.md` §1.4) for local development too. No `db` service
in `docker-compose.yml`.

**Reasoning.** Every reason ADR-012 gives for local Postgres protects a *second
person's* data or avoids *two people* colliding — neither applies solo. What's left is
the free tier's 7-day idle pause and ~200 ms of network latency per query, both
acceptable for an actively-worked student project, and outweighed by demoing against
the exact database a mentor would see.

**Trade-off.** Dev and "production" are now the same database, which removes
connection-level parity testing before a deploy — but for a project with only one
environment, that's less risk, not more. The idle-pause risk is real: wake the project
(one query) before a review if it's sat untouched for a week.

**Industry practice.** ADR-012's advice assumes a team. Solo side projects and course
projects routinely develop directly against a hosted free-tier database for exactly
this reason — there is no one else's data to protect from yourself.

**Learning note.** An ADR's reasoning has a scope. ADR-012 doesn't say "always use
local Postgres" — it says "given two developers sharing one project." When that
condition changes, the right decision can change while the *reasoning process* stays
valid. This ADR does not overrule ADR-012; it records that ADR-012's premise doesn't
hold here.
