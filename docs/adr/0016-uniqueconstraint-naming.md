# ADR-016 — `UniqueConstraint` must never be given an unprefixed literal name

**Problem.** The first `alembic upgrade head` against Supabase failed with
`DuplicateTableError: relation "id_user_id" already exists` while creating `collections`
— `tags` had already claimed that name for an unrelated constraint.

**Root cause.** `db/base.py`'s `NAMING_CONVENTION` gives each constraint type a
template, e.g. `"uq": "uq_%(table_name)s_%(column_0_N_name)s"`. That template only
activates automatic, table-scoped naming when a constraint's `name` is left unset —
SQLAlchemy uses a given string as-is otherwise, **except** for `CheckConstraint`, whose
`"ck"` template includes the `%(constraint_name)s` token, which re-wraps *any* given name
with the table prefix regardless (this is why `tags`' `CheckConstraint(..., name=
"slug_format")` came out fine as `ck_tags_slug_format`, with no collision, while its
`UniqueConstraint(..., name="id_user_id")` did not). Several models used the same short,
unprefixed name — `"id_user_id"`, `"id_owner_id"` — for the composite-FK-target
constraint pattern on different tables, which bypassed the convention entirely and
collided the moment two tables picked the same literal string. PostgreSQL scopes the
implicit index behind a `UNIQUE` constraint **schema-wide**, not per-table, so any repeat
is a hard error — unlike a repeated `CheckConstraint` or `ForeignKeyConstraint` name,
neither of which creates an index, both of which Postgres allows to repeat across tables.

**Alternatives considered.**

- Manually rename each collision (`"tags_id_user_id"`, `"collections_id_user_id"`, ...).
  Works, but re-introduces the exact manual-naming risk the convention exists to remove,
  and does nothing for collisions that don't exist *yet*.
- Remove `name=` from every `UniqueConstraint` in the codebase, letting
  `NAMING_CONVENTION` generate `uq_<table>_<columns>` automatically. Chosen.

**Chosen.** Every `UniqueConstraint(...)` across the model files now omits `name=`.
Verified by regenerating the migration and confirming every `UniqueConstraint` line
carries an `op.f('uq_<table>_<columns>')`-wrapped name — `op.f()` is Alembic's marker
that a name came from the naming convention, not a hardcoded string.

**Trade-off.** None. Strictly safer than the prior state; changes nothing but what
Postgres calls the constraint internally.

**Industry practice.** SQLAlchemy's own documentation recommends never hardcoding
constraint names once a `naming_convention` is configured — the convention's entire
purpose, already stated in `db/base.py`'s own comment, is that Alembic needs a
*predictable*, *unique* name to reference a constraint later, and hardcoded names
undermine both guarantees silently.

**Learning note.** A rule the codebase already stated as its intent ("explicit naming
convention for every constraint") was violated in a way that passed lint, type-check,
and every prior verification — because the violation is only observable as an error from
PostgreSQL itself, at the moment a second table's constraint is created. Same lesson as
the circular-import bug from Stage 3: some classes of bug are structurally invisible
until the code runs end-to-end against the real system it targets.
