# ADR-020 — Audit triggers skip rows whose actor no longer exists

**Problem.** The activity-log trigger designed in `03-SQL-LAYER.md` (T3) logs every
`DELETE` on `notes` as an `activity_logs` row attributed to `OLD.creator_id`. Built as
written, it made account deletion impossible: deleting a user who owned any note
failed with

```
ForeignKeyViolationError: insert or update on table "activity_logs"
violates foreign key constraint "fk_activity_logs_user_id"
```

and PostgreSQL rolled back the entire `DELETE FROM users`.

**Root cause.** `DELETE FROM users` cascades to `notes` (`creator_id … ON DELETE
CASCADE`), and from there to `knowledge_links`. Each cascaded row delete fires its
`AFTER DELETE` trigger, and by that point the `users` row has already been deleted in the
same statement. The trigger's `INSERT INTO activity_logs (user_id, …) VALUES
(OLD.creator_id, …)` therefore references a user that no longer exists. That
`user_id` FK is deliberately `ON DELETE SET NULL` so the audit trail outlives its
actor, but `SET NULL` only applies to rows that existed before the delete. It does
nothing for a new row inserted afterwards that points at the deleted user.

None of the existing tests caught this, because nothing deleted a user. It came up while
reasoning through the cascade order during the build, and was confirmed by a test that
deletes a user who has notes and links.

**Alternatives considered.**

- *Insert the log row with `user_id = NULL` when the user is gone.* Keeps a row for
  every cascaded delete. Rejected: an account with 2,000 notes would write 2,000
  anonymous "deleted" rows, none attributable to anyone and all describing one event
  that the deleted user's own rows can no longer be linked to anyway.
- *Make the FK `DEFERRABLE INITIALLY DEFERRED`.* Rejected: deferring the check to
  commit doesn't help, because the referenced user is still gone at commit. The insert
  would fail later, not succeed.
- *Drop the FK on `activity_logs.user_id`.* Rejected: it would also allow log rows for
  users that never existed. The FK is right; the trigger was wrong.

**Chosen.** Each audit trigger checks that its actor still exists before writing, and
skips the log row if not:

```sql
IF TG_OP = 'DELETE' THEN
    IF NOT EXISTS (SELECT 1 FROM users WHERE id = OLD.creator_id) THEN
        RETURN OLD;
    END IF;
END IF;
```

`fn_log_link_activity()` applies the same check to `OLD.created_by`. It also skips
deletes whose source or target note is already gone, so a note purge's cascade isn't
logged as a string of user "unlinks".

The history isn't lost. Rows written while the user existed stay in `activity_logs`,
and the FK's `ON DELETE SET NULL` nulls their `user_id`, which is exactly what that FK
action was chosen for.

**Trade-offs.** The cascaded deletes of an account's notes are not individually
logged. That is deliberate rather than a gap: the event worth recording is "this account
was deleted", which belongs to whatever flow deletes the account, not to thousands of
per-note rows. Each audited delete costs one extra primary-key lookup on `users`, which
is negligible next to the delete itself.

**Verification.** `test_deleting_a_user_still_works_with_the_triggers_in_place` deletes
a user who has notes and a link, and asserts that the delete succeeds and that the
user's earlier `created` rows survive with `user_id IS NULL`. With the guard removed from
the migration and the migration re-applied, the same test fails with the
`ForeignKeyViolationError` above.

**Learning note.** A trigger runs inside the statement that fired it, including
statements it never anticipated. T3 was written with "the user deletes a note" in
mind, but cascades also call it from "the user deletes their account". Any trigger
that writes a row referencing the row being deleted, or a parent of it, should be
checked against every cascade path that can reach its table.
