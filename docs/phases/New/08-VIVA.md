# Phase 8 — The Viva Sheet

**Goal:** every claim in this document resolves to real code, and every answer is one
you can say out loud without reciting.

**Time:** ~2 hours to rehearse · **Prerequisite:** everything shipped

> **Adjust the CO numbering to your syllabus.** The mapping below uses the standard
> DBMS course outcomes. Check 22AIE303's actual CO list and renumber — the *evidence*
> column is what matters, and it does not change.

---

## 8.1 The one-minute answer

You will be asked "what is your project?" first. Have this ready, and stop talking at
the end of it.

> "NeuroVault is a personal knowledge graph. Notes are nodes; the connections between
> them are typed, weighted, directed edges stored in a self-referencing many-to-many
> table. The interesting database work is that traversal happens *in PostgreSQL* using
> a recursive CTE with cycle prevention, not in application code — so finding everything
> connected to a note within three hops is one query.
>
> Beyond the graph, it uses composite foreign keys to make cross-user data access
> structurally impossible, generated columns for full-text search vectors and word
> counts, and triggers that maintain version history and an audit log without the
> application being involved. Fifteen tables, four views, three triggers, three stored
> routines, ten indexes, and row-level security — all versioned in migrations."

**Then stop.** The follow-up question is where the marks are, and you want them asking
about the part you chose to mention.

---

## 8.2 CO mapping — claim → evidence

### CO1 — SQL and the relational model

| Concept | Where |
|---|---|
| Multi-table joins | [`03-SQL-LAYER.md`](03-SQL-LAYER.md) Q1, Q2 |
| Aggregation, `GROUP BY`, `HAVING` | Q2, Q3 |
| Scalar subquery | Q4 |
| Correlated subquery | Q5 |
| `EXISTS` / `NOT EXISTS` | Q6, view `v_orphan_notes` |
| `CASE` | Q7 |
| CTE (non-recursive) | Q8 |
| **Recursive CTE** | §3.6, `fn_max_graph_depth`, `fn_shortest_path` |
| Window functions | Q9 `ROW_NUMBER`, Q10 `RANK`/`DENSE_RANK`, Q11 running total, Q12 `LAG` |
| `FILTER`, self-join | Q13 |
| JSONB operators | Q14 |
| Full-text search + ranking | Q15 |
| Views | §3.3 — four |
| Set semantics | `UNION ALL` in the recursive term, §3.6 |

### CO2 — Design and normalization

| Concept | Where |
|---|---|
| ER model | [`02-DATABASE.md`](02-DATABASE.md) §2.2 |
| Keys: primary, candidate, composite, surrogate vs natural | §2.4, and `tags` vs `notes` ID choice |
| Referential integrity, `ON DELETE` semantics | Every FK; §2.4 `SET NULL (notebook_id)` |
| Self-referencing M:N | `knowledge_links` |
| 1NF → BCNF proofs | §2.8 |
| **Deliberate denormalization, defended** | §2.8, the two violations |
| Domain constraints | Every `CHECK`; §2.3 Principle 3 |

### CO3 — Transactions and concurrency

| Concept | Where |
|---|---|
| Transaction boundary = request | `get_db()`, [`01-FOUNDATION.md`](01-FOUNDATION.md) §1.6 |
| Atomicity via rollback-on-exception | same |
| **Row-level locking** | §3.4 T1 — why `MAX(version_num)+1` is not racy |
| Savepoints | `begin_nested()` in `get_current_user`, [`04-API.md`](04-API.md) §4.4 |
| Race conditions and their guards | first-login race; `UNIQUE(note_id, version_num)` |
| Isolation in tests | rollback-per-test fixture, [`06-QUALITY.md`](06-QUALITY.md) §6.2 |

### CO4 — Indexing and query processing

| Concept | Where |
|---|---|
| B-tree, composite, leftmost prefix | [`03-SQL-LAYER.md`](03-SQL-LAYER.md) §3.2 |
| Partial indexes | idx 2, 6, 7 |
| GIN inverted index | idx 1 (tsvector), idx 9 (trigram) |
| `EXPLAIN ANALYZE`, estimate vs actual | §3.2 |
| Index trade-offs (write cost) | §3.2 |
| Query plan reading | Seq Scan → Bitmap Index Scan |

### CO5 — Advanced features and application integration

| Concept | Where |
|---|---|
| Triggers (`BEFORE`/`AFTER`, `TG_OP`) | §3.4 |
| Stored procedures vs functions | §3.5 |
| Volatility (`IMMUTABLE`/`STABLE`/`VOLATILE`) | §3.5, and generated columns §2.3 |
| Generated columns | §2.3, §2.4 |
| **Row Level Security** | §3.8 |
| Schema versioning / migrations | [ADR-003](00-ARCHITECTURE.md#adr-003) |
| Connection pooling | §1.6, §1.4 pgbouncer modes |
| Caching and invalidation | [`04-API.md`](04-API.md) §4.7 |
| **Provenance-scoped set reconciliation** | `origin` column, §4.9 — the wiki-link edge sync |

---

## 8.3 The fifteen questions you will actually be asked

Each answer is written to be *spoken*. Say them out loud twice; do not memorise them
word for word — memorised answers collapse under a follow-up.

**1. Explain your ER model in one minute.**

> "Users own workspaces, workspaces contain notebooks, notebooks contain notes — a
> three-level hierarchy, one-to-many at each step. Notes are the centre. The graph is
> `knowledge_links`, a self-referencing many-to-many on notes with two foreign keys both
> pointing back to `notes`, plus a foreign key to a `relationship_types` lookup. Around
> notes there are three one-to-many attachments — versions, flashcards, resources — and
> two many-to-many relationships, tags and collections, each through a junction table.
> Two audit tables hang off users and are written only by triggers."

**2. Why is `knowledge_links` a separate table? Why not a foreign key on `notes`?**

> "Because it is many-to-many. A foreign key column can hold one value, so a note could
> link to exactly one other note. A junction table lets a note link to many and be
> linked from many. It also lets the relationship carry its own attributes — type,
> strength, description — which describe the *connection*, not either note. There is
> nowhere to put those on a foreign key column."

**3. Walk me through your recursive CTE.**

Draw it. Anchor, `UNION ALL`, recursive term, the two `WHERE` conditions, then trace the
seeded graph iteration by iteration — §3.6 has the trace. Finish on:

> "It terminates when an iteration produces no new rows. The cycle check is what
> guarantees that, because the graph really is cyclic — users create loops routinely."

**4. What happens without the cycle check?**

> "Infinite recursion. PostgreSQL has no built-in depth limit on a recursive CTE, so it
> runs until it exhausts memory or is cancelled. I carry the visited nodes as an array
> and require each new node not to be in it. The depth limit is a second, independent
> bound — they fail differently, so having both is worth it."

**5. Is your schema normalized?**

The full answer is in [`02-DATABASE.md`](02-DATABASE.md) §2.8. The short version:

> "Thirteen tables are in BCNF. Two carry a deliberate transitive dependency, and I can
> show you exactly what it buys: it lets a foreign key be composite, which is how
> multi-tenant isolation is enforced by the database instead of by application code. The
> usual objection is the update anomaly, and it cannot occur here — the same composite
> foreign key that needs the column also constrains it, so the two copies of the owner
> cannot disagree."

**6. Show me that cross-user access is actually prevented.**

Do not answer this one. **Run it** — the `INSERT` in §2.6 that fails with a foreign key
violation. Then say:

> "No application code ran. The database refused, because the row it was asked to
> reference does not exist."

**7. What is a trigger, and why did you use one?**

> "A function PostgreSQL runs automatically on a table event. I used one for version
> history because the invariant is 'every content change is recorded' — and that must
> hold whether the write comes from my API, from `psql`, from the seed script, or from
> code I have not written yet. Application-level versioning only holds for the paths
> that remember."

**8. Your versioning trigger reads `MAX(version_num)` then inserts. Isn't that a race?**

The trap question. Full answer in §3.4:

> "No — it is a `BEFORE UPDATE ... FOR EACH ROW` trigger, so it only runs inside an
> `UPDATE` that already holds a row-level exclusive lock on that note. A concurrent
> update to the same note blocks at the `UPDATE`, before its trigger fires. The reads
> are serialized by a lock that was already there. The unique constraint on
> `(note_id, version_num)` is a backstop in case anyone later changes the timing."

**9. What does `IMMUTABLE` mean?**

> "A promise that the function returns the same output for the same input, always — no
> table reads, no session settings, no clock. PostgreSQL requires it for generated
> columns because the value is computed once at write time; if the result could change,
> the stored value would silently go stale. It is also required for index expressions,
> for the same reason. That is why my `search_vector` names the text search
> configuration explicitly — the one-argument `to_tsvector` reads a session setting,
> which makes it `STABLE`, and PostgreSQL rejects it."

**10. Why GIN and not B-tree for search?**

> "A B-tree indexes one value per row. A `tsvector` contains many lexemes per row, and
> the question is 'which rows contain this word' — that is an inverted index. GIN maps
> each lexeme to the list of rows containing it. A B-tree physically cannot answer that
> query."

**11. Show me an index changing the query plan.**

Have it prepared, with 10,000 rows already loaded (§3.2). Drop the index, `EXPLAIN
ANALYZE`, create it, `ANALYZE`, run again. Point at `Seq Scan` becoming `Bitmap Index
Scan`.

**12. When would you NOT add an index?**

> "On a low-cardinality column where most rows match — the planner correctly prefers a
> sequential scan, because random I/O for half a table is slower than reading it in
> order. On a write-heavy table serving a rare query. And when a composite index already
> covers it as a leftmost prefix — an index on `(a, b)` already serves queries on `a`."

**13. What is Row Level Security and why do you need it?**

> "A policy attached to a table that filters rows by the current user, enforced by
> PostgreSQL on every query. I need it because the Supabase anon key ships to every
> browser — anyone can take it from DevTools and query the database directly, with my
> API completely out of the path. RLS is the boundary that still holds when the
> application is bypassed. My FastAPI service layer protects one path; RLS protects the
> other."

**14. How would this scale to a million notes?**

> "Three things break first, in this order. The recursive CTE on a dense graph — I'd
> bound it harder and materialize a neighbourhood table. The dashboard aggregate view —
> I'd make it materialized and refresh on a schedule, trading freshness for speed
> deliberately. And the connection pool — the free-tier limits are small, so I'd move to
> pgbouncer in transaction mode, which means disabling asyncpg's prepared-statement
> cache. If graph traversal became *the* workload rather than one feature among fifteen
> tables, that is the point where a native graph database wins — that trade-off is
> written up in [ADR-011](00-ARCHITECTURE.md#adr-011)."

**15. What is the weakest part of this project?**

Answer honestly. It is a test of judgment, and a defensive answer fails it.

> "Two things. Real-time collaborative editing is not built — it's specified in
> [`09-ROADMAP.md`](09-ROADMAP.md) with its schema delta, but conflict resolution needs
> CRDTs or operational transforms and that is a project on its own. And the graph
> traversal has no upper bound on *breadth* — I bound depth, but a note with a thousand
> edges would still be expensive at depth 3. I'd add a per-level fan-out limit before
> putting real load on it."

**Bonus — likely to come up once they see the graph has more than a handful of edges:
how did all these edges get here?**

> "Most of them weren't drawn through a dialog — they came from `[[title]]` syntax in
> the text itself, the same convention Obsidian and Roam use. Every note's content is
> re-parsed on save, and the set of `[[...]]` references is reconciled against the
> graph: new mentions become edges, removed mentions remove them.
>
> The part worth explaining is how that stays safe. A user can *also* create an edge by
> hand, through the link dialog, with a chosen type and strength. If the automatic
> reconciler didn't distinguish its own edges from hand-made ones, editing one sentence
> could silently delete work the user did deliberately. So every edge carries an
> `origin` column — `manual`, `wiki`, or `ai` — and the reconciler's delete is scoped to
> `origin = 'wiki'` and its insert first checks whether *any* edge to that target
> already exists. It only ever touches rows it created itself."

---

## 8.4 The demo script — twelve minutes

Order matters. Build to the graph; it is the memorable part.

| # | Min | Do | Say |
|---|---|---|---|
| 1 | 0:00 | Sign in | "Supabase issues a JWT; FastAPI verifies it with a shared secret and maps `sub` to a local user row." |
| 2 | 0:30 | Dashboard | "Every number here is one view, `v_user_dashboard`, using `FILTER` to produce all the counters in a single pass." |
| 3 | 1:30 | Create a note, type | "Auto-save is debounced at 1.5 seconds — because each save fires a trigger, and I don't want a version row per keystroke." |
| 4 | 3:00 | **Open history** | "I never wrote code to create that. It's a `BEFORE UPDATE` trigger. The version stores the *previous* state, which is what makes rollback meaningful." |
| 5 | 4:00 | Roll back | "That's a stored procedure. And notice the version count went *up* — the rollback is itself an UPDATE, so it fires the trigger too. You can roll back a rollback." |
| 6 | 5:00 | Type `[[` in the note, pick a title | "That's the fast path — no dialog. It just created a typed, weighted, directed edge in a self-referencing many-to-many junction. There's also a manual dialog for choosing the relationship type by hand; both write to the same table, distinguished by an `origin` column so the automatic one never overwrites a hand-made edge." |
| 7 | 5:30 | **Open the graph** | "This is a recursive CTE. Colour is traversal depth — the SQL's output rendered directly." |
| 8 | 6:30 | **Move the depth slider** | "Each step is another iteration of the recursive term. And the second time I select a depth I've already seen, it's instant — that's Redis, keyed by user *and* depth." |
| 9 | 8:00 | Search | "Full-text with a GIN index on a generated `tsvector` column. Title matches are weighted A, body B, so titles rank higher. `ts_headline` produces the highlighting." |
| 10 | 9:00 | **`psql`: the cross-tenant INSERT** | "Bob putting his note in Alice's notebook. Foreign key violation. No application code ran — it's a composite foreign key." |
| 11 | 10:00 | **`psql`: `EXPLAIN ANALYZE`** | "Sequential scan without the index; bitmap index scan with it." |
| 12 | 11:00 | **`psql`: RLS** | "Same query, same table, two different `sub` claims, two different row counts." |

**Steps 4, 8, 10, 11, and 12 are the marks.** If you are running short, cut 2, 6, and 9 —
never those five.

**Have a `psql` session already open** on a second screen or tab, with the queries in a
scratch file. Typing SQL from memory under pressure is how a good demo dies.

---

## 8.5 Rehearsal checklist

```
□ The one-minute answer, said aloud, in under 75 seconds
□ The ER model drawn on paper from memory
□ The recursive CTE written on a whiteboard from memory
□ Q1–Q15 run against the live database, each explained in one sentence
□ Both 3NF violations explained without notes
□ The cross-tenant INSERT demo rehearsed
□ EXPLAIN ANALYZE before/after, with 10k rows already loaded
□ The RLS demo rehearsed with two sub values
□ The app woken up 5 minutes before you present (Render cold start, §7.7)
□ psql open, scratch file ready
□ An answer to "what's the weakest part" that isn't defensive
```

**Split the questions between you.** Two people who both answer everything look
underprepared; two people with clear ownership look like a team. Suggested split —
one takes schema design, normalization, and constraints; the other takes queries,
indexing, and the SQL layer. Both must be able to explain the recursive CTE.

---

**Next:** [`09-ROADMAP.md`](09-ROADMAP.md) — what's deliberately not built, and how it
would be.
