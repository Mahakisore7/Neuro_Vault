# ADR-003 — All SQL objects live in Alembic migrations

**Problem.** Triggers, views, and stored procedures need to exist in every database:
local, CI, and production.

**Alternatives considered.** Loose `.sql` files applied by hand with `psql` — the
previous design's approach. It produced three separate failures: the files were
unversioned and unreversible; test databases created by `Base.metadata.create_all`
had no triggers, so the trigger test could not pass; and the documented command
(`psql "$DATABASE_URL"`) could not run at all, because `DATABASE_URL` carries the
`+asyncpg` driver suffix that `psql` cannot parse.

**Chosen.** Every SQL object is created inside a migration and dropped in `downgrade()`.

```python
def upgrade() -> None:
    op.create_table("notes", ...)
    op.execute("""CREATE OR REPLACE FUNCTION fn_save_note_version() ...""")
    op.execute("""CREATE TRIGGER trg_note_versioning ...""")

def downgrade() -> None:
    op.execute("DROP TRIGGER IF EXISTS trg_note_versioning ON notes")
    op.execute("DROP FUNCTION IF EXISTS fn_save_note_version()")
    op.drop_table("notes")
```

**Trade-offs.** `--autogenerate` does not detect triggers, views, or functions, so
those are hand-written into the migration. That is a real cost, and it is the correct
one: it makes the schema a single versioned artifact.

**Learning note.** A trigger *is* schema. Anything that changes how the database
behaves belongs in the same version history as the tables.
