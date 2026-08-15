# ADR-011 — Why PostgreSQL and not a graph database

**Problem.** The application has a graph at its centre. Neo4j exists.

**Chosen.** PostgreSQL, with `WITH RECURSIVE`.

**Reasoning.** The graph is one relationship among fifteen tables. Users, workspaces,
notebooks, versions, tags, and flashcards are all conventionally relational and need
foreign-key integrity. Recursive CTEs handle traversal at this scale in one system,
one transaction, one backup, one thing to operate.

**When the answer flips.** If traversal *were* the application — social graphs, fraud
rings, recommendation over billions of edges, ten-hop queries as the primary access
pattern — a native graph database's index-free adjacency wins decisively. Our graphs
are thousands of edges, bounded to depth 5.

**Industry precedent.** No personal-knowledge-graph product runs a native graph
database, and it is worth being specific about why. Obsidian and LogSeq are local-first
with no server database at all — the graph is recomputed from markdown files on open.
Roam Research is built on Datomic, a Datalog store, not a property-graph engine like
Neo4j. Notion — by far the largest of these — runs on sharded Postgres, publicly
documented on their own engineering blog. Every one of them treats the graph as *one
relationship inside a relational product*, not as the product's storage model. That is
exactly this project's shape: fifteen tables, one of which happens to be self-joining.

**Learning note.** "Which database?" is answered by the access pattern, not by which
noun appears in the product description.
