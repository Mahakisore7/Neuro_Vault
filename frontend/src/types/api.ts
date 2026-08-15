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
