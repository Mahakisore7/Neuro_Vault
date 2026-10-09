import type { Page, Route } from "@playwright/test";

// The built app talks to two origins: the FastAPI backend and Supabase.
// These tests replace both with in-memory fakes, so they run in CI with no
// database, no Supabase project and no real account - they test the
// frontend's behaviour, while the backend has its own pytest suite.
export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
export const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://ci-placeholder.supabase.co";

export const ME = {
  id: "00000000-0000-4000-8000-000000000001",
  email: "student@example.test",
  display_name: "Test Student",
  avatar_url: null,
  bio: null,
  created_at: "2026-09-01T10:00:00Z",
};
const STRANGER_ID = "00000000-0000-4000-8000-000000000002";
const WORKSPACE_ID = "10000000-0000-4000-8000-000000000001";
const NOTEBOOK_ID = "20000000-0000-4000-8000-000000000001";

const now = "2026-10-09T09:00:00Z";

type Note = {
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
};

function note(id: string, title: string, extra: Partial<Note> = {}): Note {
  return {
    id,
    creator_id: ME.id,
    notebook_id: NOTEBOOK_ID,
    title,
    content: `<p>${title} body.</p>`,
    is_public: false,
    pinned: false,
    archived: false,
    word_count: 3,
    created_at: now,
    updated_at: now,
    ...extra,
  };
}

export const NOTE_IDS = {
  normalization: "30000000-0000-4000-8000-000000000001",
  joins: "30000000-0000-4000-8000-000000000002",
  trashedA: "30000000-0000-4000-8000-000000000003",
  trashedB: "30000000-0000-4000-8000-000000000004",
  strangers: "30000000-0000-4000-8000-000000000005",
};

/** What the fake backend recorded, for assertions. */
export type Recorded = { method: string; path: string; body: unknown };

export class MockBackend {
  notes: Note[] = [
    note(NOTE_IDS.normalization, "Normalization", { pinned: true }),
    note(NOTE_IDS.joins, "SQL Joins"),
    note(NOTE_IDS.trashedA, "Old draft", { archived: true }),
    note(NOTE_IDS.trashedB, "Scratch", { archived: true }),
    note(NOTE_IDS.strangers, "Someone else's public note", {
      creator_id: STRANGER_ID,
      notebook_id: null,
      is_public: true,
    }),
  ];
  requests: Recorded[] = [];
  /** Milliseconds to hold each PATCH /notes/{id} before answering. */
  patchDelayMs = 0;

  constructor(private page: Page) {}

  async install() {
    // A signed-in session, written where supabase-js looks for it before
    // any app script runs. expires_at is far ahead, so the client never
    // tries to refresh it over the network.
    const ref = new URL(SUPABASE_URL).hostname.split(".")[0];
    const session = {
      access_token: "e2e-access-token",
      refresh_token: "e2e-refresh-token",
      token_type: "bearer",
      expires_in: 3600,
      expires_at: 4102444800, // 2100-01-01
      user: {
        id: ME.id,
        email: ME.email,
        aud: "authenticated",
        role: "authenticated",
        app_metadata: { provider: "email", providers: ["email"] },
        user_metadata: { full_name: ME.display_name },
        created_at: ME.created_at,
      },
    };
    await this.page.addInitScript(
      ([key, value]) => window.localStorage.setItem(key, value),
      [`sb-${ref}-auth-token`, JSON.stringify(session)] as const,
    );

    await this.page.route(`${SUPABASE_URL}/**`, (route) => this.supabase(route));
    await this.page.route(`${API_URL}/**`, (route) => this.api(route));
  }

  private async supabase(route: Route) {
    const url = new URL(route.request().url());
    if (url.pathname === "/auth/v1/user") {
      return route.fulfill({ json: { id: ME.id, email: ME.email, app_metadata: { providers: ["email"] } } });
    }
    if (url.pathname === "/auth/v1/logout") return route.fulfill({ status: 204 });
    return route.fulfill({ status: 404, json: { msg: `e2e: no Supabase mock for ${url.pathname}` } });
  }

  private summary(n: Note) {
    const { id, title, is_public, pinned, archived, word_count, updated_at } = n;
    return { id, title, is_public, pinned, archived, word_count, updated_at };
  }

  private async api(route: Route) {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname.replace(/^\/api\/v1/, "");
    const method = req.method();
    const body = req.postData() ? JSON.parse(req.postData()!) : null;
    this.requests.push({ method, path, body });

    const own = this.notes.filter((n) => n.creator_id === ME.id);
    const match = (re: RegExp) => path.match(re);
    let m: RegExpMatchArray | null;

    if (method === "GET" && path === "/users/me") return route.fulfill({ json: ME });
    if (method === "GET" && path === "/users/me/export") {
      return route.fulfill({
        json: { format: "neurovault-export", version: 1, notes: own },
        headers: {
          "content-disposition": 'attachment; filename="neurovault-export-test.json"',
          // Mirrors the real API's CORS config: without this, the browser
          // hides the header from the app and the filename is lost.
          "access-control-expose-headers": "Content-Disposition",
        },
      });
    }
    if (method === "GET" && path === "/flashcards/summary")
      return route.fulfill({ json: { total: 0, due: 0, next_due_at: null } });
    if (method === "GET" && path === "/notifications/unread-count")
      return route.fulfill({ json: { count: 0 } });
    if (method === "GET" && path === "/dashboard") {
      const live = own.filter((n) => !n.archived);
      const dn = (n: Note) => ({ id: n.id, title: n.title, updated_at: n.updated_at, word_count: n.word_count, degree: 1 });
      return route.fulfill({
        json: {
          totals: {
            total_notes: live.length,
            pinned_notes: live.filter((n) => n.pinned).length,
            public_notes: 0,
            archived_notes: own.length - live.length,
            total_words: 6,
            workspace_count: 1,
            link_count: 1,
            total_cards: 0,
            cards_due: 0,
            last_edited_at: now,
          },
          most_connected: live.map(dn),
          orphans: [],
          recent: live.map(dn),
        },
      });
    }
    if (method === "GET" && path === "/notes") {
      const archived = url.searchParams.get("archived") === "true";
      const offset = Number(url.searchParams.get("offset") ?? 0);
      const rows = own.filter((n) => n.archived === archived).slice(offset);
      return route.fulfill({ json: rows.map((n) => this.summary(n)) });
    }
    if (method === "GET" && path === "/notes/search") {
      const q = (url.searchParams.get("q") ?? "").toLowerCase();
      const hits = own.filter((n) => !n.archived && n.title.toLowerCase().includes(q));
      return route.fulfill({
        json: hits.map((n) => ({
          id: n.id,
          title: n.title,
          title_highlight: n.title,
          snippet: "",
          rank: 1,
          is_own: true,
          updated_at: n.updated_at,
          fuzzy: false,
        })),
      });
    }
    if (method === "DELETE" && path === "/notes/trash") {
      const before = this.notes.length;
      this.notes = this.notes.filter((n) => !(n.creator_id === ME.id && n.archived));
      return route.fulfill({ json: { deleted: before - this.notes.length } });
    }
    if ((m = match(/^\/notes\/([^/]+)$/))) {
      const found = this.notes.find((n) => n.id === m![1]);
      if (!found) return route.fulfill({ status: 404, json: { detail: "Note not found" } });
      if (method === "GET") return route.fulfill({ json: found });
      if (method === "PATCH") {
        if (this.patchDelayMs) await new Promise((r) => setTimeout(r, this.patchDelayMs));
        Object.assign(found, body, { updated_at: new Date().toISOString() });
        return route.fulfill({ json: found });
      }
    }
    if (method === "GET" && match(/^\/notes\/[^/]+\/(tags|links|versions)$/)) return route.fulfill({ json: [] });
    if (method === "GET" && path === "/flashcards") return route.fulfill({ json: [] });
    if (method === "GET" && path === "/tags") return route.fulfill({ json: [] });
    if (method === "GET" && path === "/relationship-types") return route.fulfill({ json: [] });
    if (method === "GET" && path === `/notebooks/${NOTEBOOK_ID}`) {
      return route.fulfill({
        json: { id: NOTEBOOK_ID, workspace_id: WORKSPACE_ID, owner_id: ME.id, name: "DBMS", description: null, color: "#6366F1", created_at: now, updated_at: now },
      });
    }
    if (method === "GET" && path === `/workspaces/${WORKSPACE_ID}`) {
      return route.fulfill({
        json: { id: WORKSPACE_ID, owner_id: ME.id, name: "Semester 5", slug: "semester-5", description: null, created_at: now, updated_at: now },
      });
    }

    // Loud, so a page calling an endpoint this fake doesn't know about shows
    // up as a failing request instead of a silently empty screen.
    return route.fulfill({ status: 501, json: { detail: `e2e: no mock for ${method} ${path}` } });
  }

  /** The content of the most recent PATCH to a note, as the server received it. */
  lastSavedContent(noteId: string): string | undefined {
    const patches = this.requests.filter(
      (r) => r.method === "PATCH" && r.path === `/notes/${noteId}` && r.body && typeof r.body === "object" && "content" in r.body,
    );
    return (patches.at(-1)?.body as { content?: string } | undefined)?.content;
  }
}
