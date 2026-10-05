// Hand-written mirrors of backend/app/schemas/*.py. Keep field names and
// optionality in sync with the Pydantic models — nothing generates this file.

export interface UserResponse {
  id: string;
  email: string;
  display_name: string;
  avatar_url: string | null;
  bio: string | null;
  created_at: string;
}

export interface UserUpdate {
  display_name?: string;
  bio?: string | null;
  avatar_url?: string | null;
}

export interface Workspace {
  id: string;
  owner_id: string;
  name: string;
  slug: string;
  description: string | null;
  created_at: string;
  updated_at: string;
}

export interface WorkspaceCreate {
  name: string;
  slug: string;
  description?: string | null;
}

export interface WorkspaceUpdate {
  name?: string;
  description?: string | null;
}

export interface Notebook {
  id: string;
  workspace_id: string;
  owner_id: string;
  name: string;
  description: string | null;
  color: string;
  created_at: string;
  updated_at: string;
}

export interface NotebookCreate {
  workspace_id: string;
  name: string;
  description?: string | null;
  color?: string;
}

export interface NotebookUpdate {
  name?: string;
  description?: string | null;
  color?: string;
}

export interface Note {
  id: string;
  creator_id: string;
  notebook_id: string | null;
  title: string;
  content: string | null;
  is_public: boolean;
  pinned: boolean;
  archived: boolean;
  word_count: number;
  created_at: string;
  updated_at: string;
}

export interface NoteSummary {
  id: string;
  title: string;
  is_public: boolean;
  pinned: boolean;
  archived: boolean;
  word_count: number;
  updated_at: string;
}

export interface NoteCreate {
  title: string;
  content?: string | null;
  notebook_id?: string | null;
  is_public?: boolean;
}

export interface NoteUpdate {
  title?: string;
  content?: string | null;
  notebook_id?: string | null;
  is_public?: boolean;
  pinned?: boolean;
  archived?: boolean;
}

export interface Tag {
  id: number;
  name: string;
  slug: string;
  color: string;
}

export interface TagCreate {
  name: string;
  slug: string;
  color?: string;
}

export interface TagUpdate {
  name?: string;
  color?: string;
}

// title_highlight / snippet delimit matches with "\u0001" ... "\u0002" —
// render with <Highlighted>, never as HTML.
export interface NoteSearchResult {
  id: string;
  title: string;
  title_highlight: string;
  snippet: string;
  rank: number;
  is_own: boolean;
  updated_at: string;
}

export interface NoteVersionSummary {
  version_num: number;
  title: string;
  edited_by: string | null;
  created_at: string;
}

export interface Collection {
  id: string;
  name: string;
  description: string | null;
  item_count: number;
  created_at: string;
  updated_at: string;
}

export interface CollectionItem {
  note_id: string;
  title: string;
  word_count: number;
  archived: boolean;
  position: number;
  added_at: string;
}

export interface CollectionDetail extends Collection {
  items: CollectionItem[];
}

export interface CollectionCreate {
  name: string;
  description?: string | null;
}

export interface CollectionUpdate {
  name?: string;
  description?: string | null;
}

export interface RelationshipType {
  id: number;
  name: string;
  description: string | null;
  color: string;
  is_symmetric: boolean;
}

export interface KnowledgeLink {
  id: string;
  source_note_id: string;
  target_note_id: string;
  rel_type_id: number;
  strength: number;
  description: string | null;
  origin: string;
  created_at: string;
}

export interface KnowledgeLinkCreate {
  target_note_id: string;
  rel_type_id: number;
  strength?: number;
  description?: string | null;
}

export interface NoteGraphNode {
  id: string;
  title: string;
  is_public: boolean;
  depth: number;
}

export interface NoteGraphEdge {
  id: string;
  source_note_id: string;
  target_note_id: string;
  rel_type_id: number;
  rel_type_name: string;
  strength: number;
}

export interface NoteGraph {
  nodes: NoteGraphNode[];
  edges: NoteGraphEdge[];
}

export interface Flashcard {
  id: string;
  note_id: string;
  note_title: string;
  question: string;
  answer: string;
  ease_factor: number;
  interval_days: number;
  repetitions: number;
  due_at: string;
  last_result: number | null;
  created_at: string;
  updated_at: string;
}

export interface FlashcardCreate {
  note_id: string;
  question: string;
  answer: string;
}

export interface FlashcardUpdate {
  question?: string;
  answer?: string;
}

export interface FlashcardSummary {
  total: number;
  due: number;
  next_due_at: string | null;
}

// metadata is written by database triggers (fn_log_note_activity /
// fn_log_link_activity); `event` is always present, other keys depend on it.
export interface ActivityEntry {
  id: number;
  action_type: "create" | "update" | "delete" | "link" | "unlink";
  entity_type: "note" | "link";
  entity_id: string | null;
  metadata: {
    event: string;
    title?: string;
    changes?: string[];
    source_note_id?: string;
    source_title?: string;
    target_note_id?: string;
    target_title?: string;
    relationship?: string;
  };
  created_at: string;
  first_at: string;
  count: number;
}

export interface Notification {
  id: number;
  type: string;
  title: string;
  body: string | null;
  link_url: string | null;
  is_read: boolean;
  created_at: string;
}
