# ADR-009 — Dropping `projects`

**Problem.** The original design had 16 tables. `projects` had no foreign keys to
anything but `users`, no API routes, no UI, and appeared in no query.

**Chosen.** Drop it. 15 tables you can each explain beats 16 where one has no answer
to "what does this do?"

**Reversible.** If projects are a feature you want, they should be designed properly:
a project groups notes across notebooks toward a deliverable, which means a
`project_notes` junction and a status workflow. That is a real feature, not a table.
