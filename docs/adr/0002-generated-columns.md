# ADR-002 — `word_count` and `search_vector` as generated columns

**Problem.** Both are derived from `content`. Derived data must stay in sync.

**Alternatives considered.**

| Option | Why not |
|---|---|
| Compute on every read | `array_length(regexp_split_to_array(...))` across thousands of rows per dashboard load. |
| Keep in sync with a trigger | This is what the previous design did — and because the trigger only fired on `UPDATE`, the `INSERT` path needed a *second* implementation in Python. The two drifted the moment HTML content arrived, and a later doc had to patch both. |

**Chosen.** `GENERATED ALWAYS AS (...) STORED`, computed by PostgreSQL on every write.

```sql
word_count    INTEGER  GENERATED ALWAYS AS (...) STORED
search_vector tsvector GENERATED ALWAYS AS (
    setweight(to_tsvector('english', COALESCE(title,'')), 'A') ||
    setweight(to_tsvector('english',
        COALESCE(regexp_replace(content,'<[^>]+>',' ','g'),'')), 'B')) STORED
```

Legal because every function involved (`to_tsvector(regconfig,text)`, `setweight`,
`regexp_replace`, `||`) is `IMMUTABLE`, which generated columns require.

**Trade-offs.** Recomputed on every write, and a generated column cannot be updated
directly. For a note app — human-speed writes, hot reads — that is the right side of
the trade.

**This also eliminates a whole defect class.** The GIN index is built on
`search_vector`; the search query filters on `search_vector`. Because both name the
same column, they cannot drift apart. In the previous design the index expression and
the query expression were different, so the index was never used and nobody noticed.

**Learning note.** When you find yourself fixing the same bug in two places, the bug
is that there are two places.
