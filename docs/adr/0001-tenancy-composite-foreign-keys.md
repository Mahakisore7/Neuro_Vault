# ADR-001 — Tenancy enforced by composite foreign keys

**Problem.** A user must never be able to attach their note to another user's
notebook, tag it with another user's tag, or add it to another user's collection.

**Alternatives considered.**

| Option | Why not |
|---|---|
| Ownership check in each service method | Must be written correctly in *every* endpoint forever. The previous design shipped four endpoints with no check at all — this failure mode is not hypothetical. |
| A `BEFORE INSERT` trigger per junction table | Works, but it is imperative logic scattered across many triggers, and it costs a query per write. |
| PostgreSQL Row Level Security only | Right for direct client access (we use it too, [ADR-008](0008-row-level-security.md)), but our backend connects as an owner role that bypasses RLS, so it protects the wrong path. |

**Chosen.** Carry `owner_id` down the hierarchy and constrain on the pair.

```sql
workspaces  UNIQUE (id, owner_id)
notebooks   FOREIGN KEY (workspace_id, owner_id) REFERENCES workspaces (id, owner_id)
notes       FOREIGN KEY (notebook_id, creator_id) REFERENCES notebooks (id, owner_id)
note_tags   FOREIGN KEY (note_id, owner_id) REFERENCES notes (id, creator_id)
            FOREIGN KEY (tag_id,  owner_id) REFERENCES tags  (id, user_id)
```

**Trade-offs.** One redundant column per level, and `notebooks` is no longer in 3NF
(`owner_id` is transitively determined through `workspace_id`). We accept that
knowingly: the redundancy is maintained *by the database*, so it cannot diverge —
unlike a rule maintained by application code, which diverges the first time someone
forgets. Service-layer checks remain, for good error messages; the constraint is what
makes them unnecessary for correctness.

**Industry practice.** Standard multi-tenant integrity pattern in PostgreSQL. Pushing
the tenant key down and constraining on it is how Stripe- and Shopify-scale systems
avoid relying on every code path being correct.

**Learning note.** The general principle: *prefer making bad states unrepresentable
over detecting them.* A check you can forget to write is weaker than a shape that
cannot hold the bad value.
