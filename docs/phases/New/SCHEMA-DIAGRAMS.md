# NeuroVault — Schema, ER, and User Flow Diagrams

> Companion reference to [`02-DATABASE.md`](02-DATABASE.md) (schema), [`03-SQL-LAYER.md`](03-SQL-LAYER.md)
> (SQL layer), [`04-API.md`](04-API.md) (API contract), and [`00-ARCHITECTURE.md`](00-ARCHITECTURE.md)
> §0.4–0.5 (request/auth lifecycle). Every fact drawn here traces to one of those docs —
> see the traceability table at the bottom. Nothing here is a new design; it is the
> existing design made visual.
>
> Diagrams are [Mermaid](https://mermaid.js.org). They render natively on GitHub, in
> VS Code (Markdown Preview Mermaid Support extension), and in the published Artifact
> version of this file. If your viewer doesn't render Mermaid, paste any block into
> [mermaid.live](https://mermaid.live).

---

## 0. What this file audits and fixes

Reviewing the full `docs/phases/New/` set against itself (all 11 files) surfaced five
small but real inconsistencies — the kind Rule 1 of this doc set ("one source of truth
per fact") exists to prevent. They're fixed as part of producing this file:

| # | Where | Was | Now |
|---|---|---|---|
| 1 | `00-ARCHITECTURE.md` §0.2 system diagram | "3 triggers · 9 idx" | "3 triggers · 10 idx" — the schema has 10 indexes everywhere else it's counted |
| 2 | `README.md` "Done when" | "`\df` shows 3 routines" | "`\df` shows 6 routines" — `\df` lists the 3 trigger functions *and* the 3 standalone procedures/functions; `03-SQL-LAYER.md` and `07-DEPLOY.md` already said 6 |
| 3 | `00-ARCHITECTURE.md` §0.7 API contract | `GET /graph/connected?note_id=&depth=` | `GET /notes/{id}/graph?depth=` — the path actually implemented in `04-API.md` §4.8/§4.10 |
| 4 | `00-ARCHITECTURE.md` §0.7 API contract | `POST /uploads/image` (a backend route) | removed, replaced with a note that uploads go browser → Supabase Storage directly (`07-DEPLOY.md` §7.5), matching what the rest of the doc set already says |
| 5 | `04-API.md` | `GET /dashboard` was promised by the architecture contract and used by `05-FRONTEND.md` §5.10 and the `08-VIVA.md` demo script, but no route, service, or schema for it existed anywhere in Phase 4 | added §4.8a — `DashboardResponse`, `DashboardRepository`, `DashboardService`, the route, and its row in the §4.10 authorization table |

None of these were fatal — a careful reader would reconcile them the same way while
building. But #5 was a real gap: without it, Phase 5's `/dashboard` page and the second
minute of the demo script had nothing to call. The other four were stale numbers and a
stale path left over from the doc's own first draft (§0.7 in the old `PHASE_0` file has
the identical `/graph/connected` and `/uploads/image` lines — they were carried forward
without being reconciled against the final Phase 4 design).

Everything else in the New set held up under a full line-by-line read: the ADR list is
internally consistent, the 15-table count, 4-view count, and 3-trigger count agree
everywhere, and every SQL claim in `03-SQL-LAYER.md` matches the DDL it describes.

---

## 1. Entity–Relationship Diagram

All 15 tables. `PK` = primary key, `FK` = foreign key, `UK` = unique constraint. Composite
foreign keys (the tenancy mechanism from ADR-001) are called out in the relationship
labels, not just the attribute list — that composite-FK shape *is* the design's central
idea and is worth seeing on the diagram, not just in the DDL.

```mermaid
erDiagram
    USERS {
        uuid id PK "= Supabase JWT sub claim, no DEFAULT — ADR-013"
        citext email UK
        varchar display_name
        text avatar_url
        text bio
        timestamptz last_seen_at
    }
    WORKSPACES {
        uuid id PK
        uuid owner_id FK "-> USERS.id, CASCADE"
        varchar name
        varchar slug UK "unique per owner"
        text description
    }
    NOTEBOOKS {
        uuid id PK
        uuid workspace_id FK "composite, see below"
        uuid owner_id FK "denormalized on purpose — ADR-001"
        varchar name
        char color
    }
    NOTES {
        uuid id PK
        uuid creator_id FK "-> USERS.id, CASCADE"
        uuid notebook_id FK "nullable; composite, see below"
        varchar title
        text content
        boolean is_public
        boolean pinned
        boolean archived
        integer word_count "GENERATED ALWAYS STORED"
        tsvector search_vector "GENERATED ALWAYS STORED, GIN-indexed"
    }
    NOTE_VERSIONS {
        uuid id PK
        uuid note_id FK "-> NOTES.id, CASCADE"
        integer version_num "UNIQUE with note_id"
        varchar title
        text content
        uuid edited_by FK "-> USERS.id, SET NULL"
        varchar change_note
    }
    RELATIONSHIP_TYPES {
        smallint id PK
        varchar name UK "7 seeded rows"
        char color
        boolean is_symmetric
    }
    KNOWLEDGE_LINKS {
        uuid id PK
        uuid source_note_id FK "composite w/ created_by — ADR-007"
        uuid target_note_id FK "-> NOTES.id, CASCADE"
        smallint rel_type_id FK "-> RELATIONSHIP_TYPES.id, RESTRICT"
        uuid created_by FK
        smallint strength "CHECK 1-10"
        varchar origin "manual / wiki / ai"
    }
    TAGS {
        integer id PK "IDENTITY, not UUID"
        uuid user_id FK "-> USERS.id, CASCADE"
        varchar name
        varchar slug UK "unique per user"
        char color
    }
    NOTE_TAGS {
        uuid note_id PK "also FK, composite w/ owner_id -> NOTES"
        integer tag_id PK "also FK, composite w/ owner_id -> TAGS"
        uuid owner_id FK "in BOTH composite FKs — both sides tenancy-checked"
    }
    COLLECTIONS {
        uuid id PK
        uuid user_id FK "-> USERS.id, CASCADE"
        varchar name UK "unique per user"
        boolean is_public
    }
    COLLECTION_ITEMS {
        uuid collection_id PK "also FK, composite -> COLLECTIONS"
        uuid note_id PK "also FK, composite -> NOTES"
        uuid owner_id FK
        integer position
    }
    FLASHCARDS {
        uuid id PK
        uuid note_id FK "composite w/ owner_id -> NOTES"
        uuid owner_id FK
        text question
        text answer
        numeric ease_factor "SM-2, CHECK 1.30-2.50"
        integer interval_days
        timestamptz due_at
    }
    RESOURCES {
        uuid id PK
        uuid note_id FK "composite w/ owner_id -> NOTES"
        uuid owner_id FK
        varchar resource_type "pdf/link/video/image/audio"
        varchar title
        text url
    }
    ACTIVITY_LOGS {
        bigint id PK "IDENTITY, append-only"
        uuid user_id FK "-> USERS.id, SET NULL"
        varchar action_type
        varchar entity_type
        uuid entity_id
        jsonb metadata "column name; SQLAlchemy attr is metadata_"
    }
    NOTIFICATIONS {
        bigint id PK "IDENTITY"
        uuid user_id FK "-> USERS.id, CASCADE"
        varchar type
        varchar title
        boolean is_read "partial index WHERE is_read=false"
    }

    USERS ||--o{ WORKSPACES        : owns
    USERS ||--o{ NOTES             : creates
    USERS ||--o{ TAGS              : owns
    USERS ||--o{ COLLECTIONS       : owns
    USERS ||--o{ ACTIVITY_LOGS     : "acted (SET NULL)"
    USERS ||--o{ NOTIFICATIONS     : receives
    USERS ||--o{ NOTE_VERSIONS     : "edited (SET NULL)"
    WORKSPACES ||--o{ NOTEBOOKS    : "contains (composite FK, owner_id carried)"
    NOTEBOOKS  |o--o{ NOTES        : "files (composite FK; ON DELETE SET NULL notebook_id only)"
    NOTES ||--o{ NOTE_VERSIONS     : "history of (CASCADE)"
    NOTES ||--o{ FLASHCARDS        : "generates (composite FK)"
    NOTES ||--o{ RESOURCES         : "attaches (composite FK)"
    NOTES ||--o{ KNOWLEDGE_LINKS   : "is source of (composite FK w/ created_by — ADR-007)"
    NOTES ||--o{ KNOWLEDGE_LINKS   : "is target of (plain FK — any note incl. others' public)"
    RELATIONSHIP_TYPES ||--o{ KNOWLEDGE_LINKS : "classifies (RESTRICT)"
    NOTES ||--o{ NOTE_TAGS         : "tagged via (composite FK)"
    TAGS  ||--o{ NOTE_TAGS         : "labels via (composite FK)"
    NOTES ||--o{ COLLECTION_ITEMS  : "grouped via (composite FK)"
    COLLECTIONS ||--o{ COLLECTION_ITEMS : "contains (composite FK)"
```

**Reading the two `NOTES ||--o{ KNOWLEDGE_LINKS` lines together is the whole graph
design.** `knowledge_links` is a self-referencing many-to-many junction on `notes` — two
foreign keys, both pointing back at the same table. The asymmetry between them (source
is a composite FK requiring `created_by`, target is a plain FK) *is* the security model
from ADR-007: you may only draw an edge out of a note you own, but you may point it at
any note you can read, including someone else's public one.

**`NOTEBOOKS |o--o{ NOTES`** uses the zero-or-one marker on the notebook side because
`notebook_id` is nullable — a note can exist unfiled. Deleting a notebook nulls
`notebook_id` on its notes rather than deleting them (PostgreSQL 15's column-list
`SET NULL`, §2.4 of `02-DATABASE.md`).

**Every relationship into `NOTES`, `NOTEBOOKS`, `NOTE_TAGS`, and `COLLECTION_ITEMS`
carries an owner/creator column that's part of a *composite* foreign key** — that's
ADR-001, tenancy enforced by the database rather than by application code. It's the
single idea worth being able to point at and explain unprompted in a viva.

---

## 2. Physical Schema Diagram — table groups and the SQL layer

The ER diagram shows entities and relationships. This shows the schema the way
`02-DATABASE.md` §2.4 groups it (Identity/Hierarchy → Notes → Graph → Classification →
Study aids → Audit), plus what the SQL layer (`03-SQL-LAYER.md`) attaches to each group —
which views read it, which triggers write to it, and where the GIN/partial indexes sit.

```mermaid
flowchart TB
    subgraph A["Group A — Identity &amp; Hierarchy"]
        direction TB
        USERS[("users")]
        WORKSPACES[("workspaces")]
        NOTEBOOKS[("notebooks")]
        USERS -->|"owner_id · CASCADE"| WORKSPACES
        WORKSPACES -->|"(id,owner_id) composite · CASCADE"| NOTEBOOKS
    end

    subgraph B["Group B — Notes, the centre"]
        direction TB
        NOTES[("notes<br/>+ word_count, search_vector<br/>GENERATED columns")]
        NOTE_VERSIONS[("note_versions<br/>append-only, trigger-written")]
        NOTES -->|"CASCADE"| NOTE_VERSIONS
    end

    subgraph C["Group C — The Graph"]
        direction TB
        REL_TYPES[("relationship_types<br/>7 seeded rows")]
        LINKS[("knowledge_links<br/>self-referencing M:N")]
        REL_TYPES -->|"RESTRICT"| LINKS
    end

    subgraph D["Group D — Classification &amp; Grouping"]
        direction TB
        TAGS[("tags")]
        NOTE_TAGS[("note_tags")]
        COLLECTIONS[("collections")]
        COLLECTION_ITEMS[("collection_items")]
        TAGS -->|"CASCADE"| NOTE_TAGS
        COLLECTIONS -->|"CASCADE"| COLLECTION_ITEMS
    end

    subgraph E["Group E — Study Aids"]
        direction TB
        FLASHCARDS[("flashcards<br/>SM-2 fields")]
        RESOURCES[("resources<br/>PDF/link/video")]
    end

    subgraph F["Group F — Audit (trigger-written only)"]
        direction TB
        ACTIVITY[("activity_logs")]
        NOTIF[("notifications")]
    end

    A -->|"(notebook_id,creator_id) composite<br/>SET NULL (notebook_id)"| NOTES
    NOTES -->|"composite FK"| C
    NOTES -->|"composite FK"| D
    NOTES -->|"composite FK"| E
    NOTES ==trg_notes_create_version==> NOTE_VERSIONS
    NOTES ==trg_notes_activity_log==> ACTIVITY
    LINKS ==trg_knowledge_links_notify==> NOTIF

    classDef trig stroke:#f59e0b,stroke-width:2px;
    class NOTE_VERSIONS,ACTIVITY,NOTIF trig
```

**Legend — what's attached to which table, per `03-SQL-LAYER.md`:**

| Object | Type | Table(s) | Purpose |
|---|---|---|---|
| `idx_notes_search_vector` | GIN | notes | full-text search |
| `idx_notes_creator_id_updated_at` | partial B-tree | notes | "my notes, newest first" |
| `idx_knowledge_links_source_note_id` / `_target_note_id` | B-tree | knowledge_links | recursive traversal, both directions |
| `idx_note_versions_note_id_version_num` | B-tree | note_versions | latest-version lookups |
| `idx_notifications_user_id_created_at` | partial B-tree | notifications | unread bell badge |
| `idx_notes_notebook_id` | partial B-tree | notes | notes within a notebook |
| `idx_flashcards_owner_id_due_at` | B-tree | flashcards | cards due for review |
| `idx_notes_title_trgm` | GIN + trigram | notes | fuzzy/typo title search |
| `idx_knowledge_links_source_note_id_origin` | B-tree | knowledge_links | wiki-link reconciliation |
| `v_note_graph_stats` | view | notes, knowledge_links, note_versions | per-note degree/version stats |
| `v_note_search` | view | notes | search result shaping |
| `v_user_dashboard` | view | users, notes, workspaces, knowledge_links | Phase 4 §4.8a's `/dashboard` |
| `v_orphan_notes` | view | notes, knowledge_links | notes connected to nothing |
| `trg_notes_create_version` | trigger (BEFORE UPDATE) | notes → note_versions | auto-versioning |
| `trg_knowledge_links_notify` | trigger (AFTER INSERT) | knowledge_links → notifications | "someone linked your note" |
| `trg_notes_activity_log` | trigger (AFTER I/U/D) | notes → activity_logs | audit trail |
| `sp_rollback_note_version` | procedure | notes, note_versions | restore + re-version |
| `fn_max_graph_depth` | function | notes, knowledge_links | recursive CTE, depth only |
| `fn_shortest_path` | function | notes, knowledge_links | recursive CTE, BFS shortest path |

---

## 3. User Flow Diagrams

### 3.1 New user → first working graph

```mermaid
flowchart TD
    Start(["Visitor opens the app"]) --> SignedIn{"Has a Supabase<br/>session?"}
    SignedIn -- No --> Login["/login or /signup<br/>(supabase-js, direct)"]
    Login --> SupaAuth["Supabase Auth issues<br/>access + refresh JWT"]
    SupaAuth --> FirstCall["First API call carries the JWT"]
    FirstCall --> AutoCreate["FastAPI verifies JWT,<br/>auto-creates users row<br/>from the sub claim (ADR-013)"]
    SignedIn -- Yes --> Dashboard
    AutoCreate --> Dashboard["/dashboard<br/>= v_user_dashboard, one query"]
    Dashboard --> MakeWS["Create a workspace<br/>POST /workspaces"]
    MakeWS --> MakeNB["Create a notebook<br/>POST /notebooks"]
    MakeNB --> MakeNote["Create a note<br/>POST /notes"]
    MakeNote --> Edit["Type in the Tiptap editor"]
    Edit --> WikiLink{"Typed [[Title]]?"}
    WikiLink -- Yes --> Autocomplete["Popup suggests matching<br/>note titles"]
    Autocomplete --> Insert["Insert [[Title]] as plain text"]
    WikiLink -- No --> Debounce
    Insert --> Debounce["1.5s debounce, then<br/>PATCH /notes/{id}"]
    Debounce --> Reconcile["WikiLinkService reconciles<br/>origin='wiki' edges"]
    Reconcile --> Graph["/graph — recursive CTE,<br/>depth slider 1-5, Redis-cached"]
    Graph --> Search["/search — ts_rank_cd<br/>ranked, highlighted"]
    Graph --> Review["/review — SM-2<br/>flashcards due_at"]
    Graph --> Collections["/collections — ordered<br/>note groupings"]
```

### 3.2 Sequence — editing a note (the flagship demo)

Grounded in `00-ARCHITECTURE.md` §0.4 and the versioning trigger in `03-SQL-LAYER.md`
§3.4. This is the single flow every phase of the build points back to.

```mermaid
sequenceDiagram
    actor U as User
    participant FE as Browser (Tiptap editor)
    participant API as FastAPI (NoteService)
    participant DB as PostgreSQL (notes)
    participant TRG as Trigger engine

    U->>FE: types in the editor
    FE->>FE: debounce 1.5s after last keystroke
    FE->>API: PATCH /api/v1/notes/{id}  {content}
    API->>API: get_current_user() verifies JWT,<br/>loads users row
    API->>API: NoteService._assert_can_write<br/>(creator_id == user.id)
    API->>DB: UPDATE notes SET content=..., updated_at=now()
    activate DB
    DB->>TRG: BEFORE UPDATE fires trg_notes_create_version
    TRG->>DB: INSERT INTO note_versions (OLD content, MAX(version_num)+1)
    Note over TRG,DB: row-level exclusive lock already held by<br/>the UPDATE — the MAX() read can't race
    DB->>DB: word_count, search_vector<br/>GENERATED columns recompute
    DB-->>TRG: AFTER UPDATE fires trg_notes_activity_log
    TRG->>DB: INSERT INTO activity_logs (action='update', metadata jsonb)
    deactivate DB
    DB-->>API: commit (get_db() commits at request end)
    API->>API: WikiLinkService.reconcile() if content changed
    API-->>FE: 200 NoteResponse {word_count, unresolved_wiki_links}
    FE-->>U: "Saved — version created"
    FE->>API: (async) invalidate noteKeys.versions(id)
    API-->>FE: GET /notes/{id}/versions → history panel updates
```

**The point this diagram makes visible:** nothing in `app/` ever inserts into
`note_versions` or `activity_logs`. Both rows exist because of what PostgreSQL did
*inside the same UPDATE statement*, which is also why a rollback (an ordinary `UPDATE`
run by `sp_rollback_note_version`) is itself versioned — see §3.3.

### 3.3 Sequence — creating a knowledge link (manual or wiki) → notification

```mermaid
sequenceDiagram
    actor U as User (owns note A)
    participant FE as Browser
    participant API as FastAPI (LinkService / WikiLinkService)
    participant DB as PostgreSQL

    alt Manual link
        U->>FE: opens link dialog, picks note B + relationship type
        FE->>API: POST /api/v1/links {source: A, target: B, rel_type_id}
    else Wiki-link
        U->>FE: types [[B's title]] in note A, saves
        FE->>API: PATCH /api/v1/notes/{A}  {content}
        API->>API: WikiLinkService resolves title -> note B's id
    end
    API->>API: assert A.creator_id == current user (ADR-007)
    API->>DB: INSERT INTO knowledge_links (source=A, target=B, created_by=user, origin=...)
    activate DB
    DB->>DB: composite FK (source_note_id, created_by) -> notes(id, creator_id)<br/>rejects it if the user doesn't own A
    DB->>DB: AFTER INSERT fires trg_knowledge_links_notify
    alt B's owner != A's owner
        DB->>DB: INSERT INTO notifications (user_id = B's owner, type='link_created')
    else B's owner == A's owner
        DB->>DB: guard trips — no notification (no self-notify)
    end
    deactivate DB
    DB-->>API: commit
    API->>API: invalidate graph:{A's owner}:* in Redis
    API-->>FE: 201 (manual) or updated NoteResponse (wiki)
    Note over FE: Graph canvas re-fetches; new edge appears<br/>with the relationship's colour and arrow style
```

### 3.4 Screens reachable per backend capability

Matches `05-FRONTEND.md` §5.10 — every backend feature has a screen, and every screen
demonstrates a specific piece of SQL.

```mermaid
flowchart LR
    subgraph Screens
        DASH["/dashboard"]
        NOTES["/notes"]
        NOTE["/notes/[id]"]
        GRAPHS["/graph"]
        SEARCH["/search"]
        COLL["/collections"]
        REVIEW["/review"]
        BELL["notification bell"]
    end
    subgraph SQL["What each one proves"]
        V1["v_user_dashboard<br/>(FILTER aggregation)"]
        V2["pagination + partial index<br/>(archived=false)"]
        V3["trigger-written version history<br/>+ sp_rollback_note_version"]
        V4["WITH RECURSIVE + Redis cache"]
        V5["ts_rank_cd + ts_headline<br/>GIN index"]
        V6["M:N junction w/ position ordering"]
        V7["SM-2 fields + due_at partial index"]
        V8["trg_knowledge_links_notify output"]
    end
    DASH --- V1
    NOTES --- V2
    NOTE --- V3
    GRAPHS --- V4
    SEARCH --- V5
    COLL --- V6
    REVIEW --- V7
    BELL --- V8
```

---

## 4. Traceability — every diagram fact, back to its source doc

| Diagram element | Source |
|---|---|
| 15 tables, groups A–F | `02-DATABASE.md` §2.4 |
| Composite FK tenancy pattern | `00-ARCHITECTURE.md` ADR-001; `02-DATABASE.md` §2.3 Principle 1 |
| `knowledge_links` asymmetric source/target FK | `00-ARCHITECTURE.md` ADR-007; `02-DATABASE.md` Group C |
| Generated columns (`word_count`, `search_vector`) | `00-ARCHITECTURE.md` ADR-002; `02-DATABASE.md` §2.3 Principle 2 |
| `notebook_id` SET NULL, column-list form | `02-DATABASE.md` §2.4 Group B, `notes` table |
| 10 indexes, 4 views, 3 triggers, 3 routines | `03-SQL-LAYER.md` §3.2–§3.5 |
| Versioning trigger not a race | `03-SQL-LAYER.md` §3.4 T1 |
| Notification trigger self-notify guard | `03-SQL-LAYER.md` §3.4 T2 |
| Recursive CTE mechanics | `03-SQL-LAYER.md` §3.6 |
| `/dashboard` route (added by this review) | `04-API.md` §4.8a |
| Wiki-link reconciliation (`origin` column) | `04-API.md` §4.9 |
| Request lifecycle (edit-note sequence) | `00-ARCHITECTURE.md` §0.4 |
| Auth flow | `00-ARCHITECTURE.md` §0.5 |
| Screens ↔ SQL mapping | `05-FRONTEND.md` §5.10 |
| Demo script ordering | `08-VIVA.md` §8.4 |

If a future edit changes one of these facts, update the source doc first — this file is
downstream of all eleven, by the same one-source-of-truth rule they use on each other.
