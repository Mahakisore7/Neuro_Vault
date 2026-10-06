# ADR-021 — Graph traversal is a breadth-first search, not a per-path recursive CTE

**Problem.** The knowledge-graph endpoint, and the planned `fn_max_graph_depth` and
`fn_shortest_path` (03-SQL-LAYER.md §3.5–3.6), all used the same recursive CTE: each row
carries `visited_path`, an array of the notes on *its* path, and the recursive step
refuses to revisit a note already in that array. That stops infinite loops on cycles.
It does not stop the same note being reached again and again by *different* paths. Each
route to a note is a separate row, and each of those rows is expanded further. The CTE
therefore lists every simple path, and on a densely linked graph that number grows
exponentially with depth.

With 9 notes all linked to each other (36 links), the CTE produces **2,081 rows** at depth
4 to report **9** distinct notes. At depth 6 on a slightly bigger graph it's millions.
`DISTINCT ON (id)` at the end hides this from the result but not from the work.

Two further problems in the planned functions:

- They took no user, so `fn_shortest_path` would route through someone else's *private*
  note and return its title.
- "Maximum depth" as the longest simple path is NP-hard in general, so no query should
  try to compute it.

**Alternatives considered.**

- *Keep the CTE, add `CYCLE` / `SEARCH BREADTH FIRST` (PostgreSQL 14+).* Rejected: both
  are syntax for cycle detection and output order. Neither adds a visited set shared
  across paths, so the number of paths is still exponential.
- *Keep the CTE, lower the depth limit.* Rejected: it only delays the problem, and the
  graph page lets the user pick up to depth 6.
- *A graph database.* Already rejected in ADR-011. The traversal is a few lines of
  PL/pgSQL once it is written as a proper BFS.

**Chosen.** One PL/pgSQL function does the traversal:

```
fn_note_distances(p_root, p_user_id, p_max_depth) -> (note_id, depth, parent_id)
```

It is a textbook breadth-first search: a frontier array and a global visited array. Each
loop iteration runs **one set-based query** for the whole frontier, which:
- finds neighbours with two `UNION ALL` branches, one per link direction, so each side can
  use its own index;
- drops anything already visited or not visible to the user;
- keeps each newly reached note once, with a deterministic parent, using `DISTINCT ON`.

Every note is expanded exactly once: O(notes + links).

The other pieces are thin on top of it:
- `fn_max_graph_depth` is `MAX(depth)` over the result: hops to the farthest reachable
  note.
- `fn_shortest_path` walks the `parent_id` pointers back from the target with a small
  recursive CTE. BFS reaches every note first by a shortest route, so that walk *is* a
  shortest path.
- The graph endpoint selects from `fn_note_distances` instead of running its own CTE.

Visibility (`archived = false AND (creator_id = p_user_id OR is_public)`) is applied to
the root and to every hop, matching what the graph endpoint always did.

**Trade-offs.** PL/pgSQL can't be inlined by the planner the way a `LANGUAGE sql`
function can, and the visited check (`<> ALL (array)`) is linear in the visited count.
Both are negligible at this project's scale, and far cheaper than path enumeration. If
graphs ever reached tens of thousands of notes per user, the visited array would become a
temporary table with a primary key.

**Verification.**
- All 13 existing graph tests pass unchanged against the new function.
- New tests cover: the 9-note complete graph (2,081 CTE rows against 9 BFS rows); shortest
  path choosing the short route; an empty result, not an error, when no route exists; no
  route *through* another user's private note, though its owner sees one; and a 404 for an
  unreadable target.

**Learning note.** "Has a cycle check" and "visits each node once" sound like the same
property, and they aren't. A per-path visited list makes a traversal *terminate*; only a
visited set shared across the whole search makes it *efficient*.
