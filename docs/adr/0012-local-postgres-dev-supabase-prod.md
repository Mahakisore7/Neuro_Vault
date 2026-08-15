# ADR-012 — Local PostgreSQL for development, Supabase for production

> **Amended for this project by [ADR-014](0014-direct-supabase-dev-solo.md).** The
> reasoning below assumes a two-person team; this project has one developer, and
> ADR-014 records why that premise doesn't hold and what we did instead. Kept here in
> full because the reasoning is still correct for the situation it describes.

**Problem.** Where does the database live while two people are building the schema?

**Alternatives considered.**

- *One shared Supabase project.* What the previous doc set assumed. It is the default
  because it is one fewer thing to install, and it fails in four specific ways below.
- *One Supabase project each.* Doubles the setup, doubles the drift, and the two
  schemas diverge the first time one of you forgets to run a migration.
- *Local PostgreSQL in Docker, Supabase for production.* Chosen.

**Chosen.** `docker compose` runs `postgres:16-alpine`. Supabase is the production
database and — in every environment — the auth provider.

**Reasoning.** Schema work is destructive by nature. You will run
`alembic downgrade base` many times while getting the 15 tables right. Against a shared
database that is your teammate's data. Beyond that: two developers share one
`alembic_version` row, so your migrations collide; the free tier pauses after 7 days
idle, which lands the week before submission; and every query in development pays
~200 ms of round-trip instead of under 1 ms.

**What makes it possible.** `users.id` mirrors the Supabase `sub` claim rather than
referencing `auth.users` — see [ADR-013](0013-users-mirrors-supabase-auth.md). Nothing
in our schema is bound to Supabase's, so the data can live anywhere while Auth stays
remote. JWT verification is a local HMAC check against a shared secret, not a network
call, so authentication works identically against a local database.

**Trade-off.** Development is not byte-identical to production. Supabase adds RLS,
connection pooling, and its own extensions. We close that gap deliberately: RLS
policies are written in migrations ([ADR-003](0003-sql-objects-in-migrations.md)), so
they exist locally too, and Phase 7 runs the same migrations against Supabase before
the first deploy.

**Industry practice.** Standard. Production data does not belong in a development loop,
and every team that has restored a backup because someone ran a migration against the
wrong `DATABASE_URL` learns this once.

**Learning note.** "Use the managed service everywhere" sounds simpler and is not. The
question to ask is *what happens when I run the most destructive command in my
workflow* — if the answer involves someone else's data, the environments are wrong.
