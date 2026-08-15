# ADR-007 — Links originate from notes you own

**Problem.** Who may create an edge, and between whose notes?

**Chosen.** The source note must belong to you; the target may be your note or a
public note.

```sql
CONSTRAINT fk_kl_source FOREIGN KEY (source_note_id, created_by)
    REFERENCES notes (id, creator_id) ON DELETE CASCADE
```

**Why this shape.** It makes the notification trigger *mean* something — "someone
linked your public note" is a real event worth a notification. In the previous design
there was no sharing model at all, so the notification trigger fired on a scenario the
application could not produce.

**Reversible.** If you decide the graph should be strictly single-user, drop the
public-target case and remove `trg_link_notification`. Recorded here so the choice is
visible rather than implied.
