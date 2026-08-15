# Phase 5 — Frontend

**Goal:** every backend capability reachable from the UI, with the two features that
demonstrate the database work — the versioning trigger and the recursive CTE — made
*visible* rather than merely present.

**Time:** ~8 hours · **Prerequisite:** [`04-API.md`](04-API.md)

**Done when:**

```
login → create → edit → history → rollback → link → graph → search
works end to end against the running backend
pnpm type-check && pnpm lint && pnpm build → clean
```

---

## 5.1 The shape of this frontend

```
src/
├── app/
│   ├── (auth)/                  route group — no URL segment
│   │   ├── layout.tsx           centred card, no nav
│   │   ├── login/page.tsx
│   │   └── signup/page.tsx
│   ├── (app)/                   authenticated shell
│   │   ├── layout.tsx           sidebar + auth guard
│   │   ├── dashboard/page.tsx
│   │   ├── notes/
│   │   │   ├── page.tsx
│   │   │   └── [id]/page.tsx    editor + graph + versions
│   │   ├── graph/page.tsx       whole-workspace canvas
│   │   ├── search/page.tsx
│   │   ├── collections/page.tsx
│   │   ├── review/page.tsx      flashcards
│   │   └── settings/page.tsx
│   ├── layout.tsx               root: fonts, providers
│   ├── providers.tsx            TanStack Query + Toaster
│   └── page.tsx                 landing → redirect
├── components/
│   ├── ui/                      shadcn primitives (already scaffolded)
│   ├── editor/                  Tiptap
│   ├── graph/                   Cytoscape
│   └── layout/                  sidebar, header, notification bell
├── hooks/                       one file per resource
├── lib/
│   ├── api.ts                   axios instance + interceptors
│   ├── supabase.ts              browser client
│   └── utils.ts                 cn()  ← the file .gitignore was eating
└── types/api.ts                 hand-written mirrors of the Pydantic schemas
```

**Parentheses in `(auth)` and `(app)` make a route group.** It organises files and
applies a shared layout without adding a URL segment — `/(app)/dashboard/page.tsx`
serves `/dashboard`, not `/app/dashboard`. This is how two different chromes (bare card
vs. full sidebar) coexist without a conditional in one layout.

---

## 5.2 The auth guard is not a security boundary

Say this out loud before writing any of it, because it is the thing an examiner will
probe and the thing that is easiest to get intellectually wrong.

The app is a **static export** ([ADR-010](../../adr/0010-static-export-frontend.md)). There is no
server, so there is no middleware, so there is no server-side redirect. The guard below
runs in the browser, after the JavaScript has already been downloaded.

```
What the guard does:      stops a signed-out user seeing an empty app shell
What the guard does NOT:  protect any data
What protects the data:   FastAPI verifying the JWT (Phase 4) + RLS (Phase 3)
```

Anyone can delete the guard from their own browser's memory. They get an app shell with
no data in it, because every request that returns data is authorized on the server.

> **Viva question:** *Your login check is client-side JavaScript. Isn't that insecure?*
>
> "It would be if it were the only check. It is a UX affordance — it stops a signed-out
> user seeing a flash of the empty shell before being redirected. Every piece of actual
> data comes from an API call carrying a JWT that FastAPI verifies, and the database
> itself enforces Row Level Security on the direct Supabase path. Bypassing the
> client-side guard gets you an empty layout. The rule is that authentication decisions
> made in code the user controls are decorative — the boundary has to be somewhere the
> user cannot reach."

---

## 5.3 The Supabase client and the API client

```ts
// src/lib/supabase.ts
import { createClient } from "@supabase/supabase-js";

export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true, // required for email-confirmation callbacks
    },
  },
);
```

We use `supabase-js` directly. **`@supabase/auth-ui-react` is archived by Supabase**,
pulls a legacy styling system, and its peer range excludes React 19. The forms below are
less code than configuring the widget would have been.

```ts
// src/lib/api.ts
import axios, { AxiosError } from "axios";

import { supabase } from "./supabase";

export const api = axios.create({
  baseURL: `${process.env.NEXT_PUBLIC_API_URL}/api/v1`,
  headers: { "Content-Type": "application/json" },
});

// Attach the current access token to every request. Reading it from the client
// on each call — rather than caching it in a module variable — means a token
// refreshed in another tab is picked up immediately.
api.interceptors.request.use(async (config) => {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (session?.access_token) {
    config.headers.Authorization = `Bearer ${session.access_token}`;
  }
  return config;
});

// One 401 → one refresh attempt → one retry. The _retry flag is what stops an
// infinite loop when the refresh itself is what is failing.
api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const original = error.config as (typeof error.config & { _retry?: boolean }) | undefined;

    if (error.response?.status === 401 && original && !original._retry) {
      original._retry = true;
      const { data, error: refreshError } = await supabase.auth.refreshSession();
      if (!refreshError && data.session) {
        original.headers.Authorization = `Bearer ${data.session.access_token}`;
        return api(original);
      }
      await supabase.auth.signOut();
      window.location.href = "/login";
    }
    return Promise.reject(error);
  },
);
```

**The `_retry` flag is the entire difference between a working refresh and a browser
tab pinned at 100% CPU.** Without it, a 401 triggers a refresh, the retry 401s again,
which triggers another refresh, forever.

---

## 5.4 Providers

```tsx
// src/app/providers.tsx
"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { useState } from "react";

export function Providers({ children }: { children: React.ReactNode }) {
  // useState, not a module-level constant: one client per component tree.
  // A module-level client is shared across every user in a server-rendered
  // context and leaks one user's cache into another's response.
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            retry: (failureCount, error) => {
              // Never retry a 4xx. The request was wrong; sending it again
              // three more times wastes time and hides the real error.
              const status = (error as { response?: { status?: number } })?.response?.status;
              if (status && status >= 400 && status < 500) return false;
              return failureCount < 2;
            },
            refetchOnWindowFocus: false,
          },
        },
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      {children}
      <ReactQueryDevtools initialIsOpen={false} />
    </QueryClientProvider>
  );
}
```

---

## 5.5 Auth screens

```tsx
// src/app/(auth)/login/page.tsx
"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/lib/supabase";

const schema = z.object({
  email: z.email("Enter a valid email address"),
  password: z.string().min(8, "At least 8 characters"),
});

type FormValues = z.infer<typeof schema>;

export default function LoginPage() {
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema) });

  async function onSubmit(values: FormValues) {
    setServerError(null);
    const { error } = await supabase.auth.signInWithPassword(values);
    if (error) {
      // Deliberately generic: distinguishing "no such user" from "wrong password"
      // turns the login form into an account-enumeration oracle.
      setServerError("Incorrect email or password.");
      return;
    }
    router.push("/dashboard");
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="email">Email</Label>
        <Input id="email" type="email" autoComplete="email" {...register("email")} />
        {errors.email && <p className="text-sm text-destructive">{errors.email.message}</p>}
      </div>

      <div className="space-y-2">
        <Label htmlFor="password">Password</Label>
        <Input
          id="password"
          type="password"
          autoComplete="current-password"
          {...register("password")}
        />
        {errors.password && (
          <p className="text-sm text-destructive">{errors.password.message}</p>
        )}
      </div>

      {serverError && <p className="text-sm text-destructive">{serverError}</p>}

      <Button type="submit" className="w-full" disabled={isSubmitting}>
        {isSubmitting ? "Signing in…" : "Sign in"}
      </Button>
    </form>
  );
}
```

**Import paths are `@/components/ui/button`** — singular `ui`, matching what
`components.json` generated. The previous doc set used `@/components/button`, which
resolves to nothing and produces the `TS2307` wall.

**`z.email()`, not `z.string().email()`.** Zod v4 moved the string formats to top-level
functions; the chained form is deprecated and will warn.

### The guard

```tsx
// src/app/(app)/layout.tsx
"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { Sidebar } from "@/components/layout/sidebar";
import { supabase } from "@/lib/supabase";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) router.replace("/login");
      else setChecked(true);
    });

    // Handles sign-out in another tab, and token expiry with no refresh.
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session) router.replace("/login");
    });

    return () => subscription.unsubscribe();
  }, [router]);

  // Render nothing until the check completes — this is what prevents the flash
  // of empty shell. It is a UX guarantee, not a security one. See §5.2.
  if (!checked) return null;

  return (
    <div className="flex h-screen">
      <Sidebar />
      <main className="flex-1 overflow-y-auto">{children}</main>
    </div>
  );
}
```

**`subscription.unsubscribe()` in the cleanup.** Without it, every navigation adds
another listener and none are ever removed — a memory leak that also fires the redirect
handler N times.

---

## 5.6 Data hooks

One file per resource. This is where TanStack Query's cache invalidation lives.

```ts
// src/hooks/use-notes.ts
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "@/lib/api";
import type { Note, NoteSummary, NoteUpdate } from "@/types/api";

export const noteKeys = {
  all: ["notes"] as const,
  lists: () => [...noteKeys.all, "list"] as const,
  list: (filters: Record<string, unknown>) => [...noteKeys.lists(), filters] as const,
  details: () => [...noteKeys.all, "detail"] as const,
  detail: (id: string) => [...noteKeys.details(), id] as const,
  graph: (id: string, depth: number) => [...noteKeys.all, "graph", id, depth] as const,
  versions: (id: string) => [...noteKeys.all, "versions", id] as const,
};

export function useNotes(filters: { notebook_id?: string; archived?: boolean } = {}) {
  return useQuery({
    queryKey: noteKeys.list(filters),
    queryFn: async () => (await api.get<NoteSummary[]>("/notes", { params: filters })).data,
  });
}

export function useNote(id: string) {
  return useQuery({
    queryKey: noteKeys.detail(id),
    queryFn: async () => (await api.get<Note>(`/notes/${id}`)).data,
    enabled: Boolean(id),
  });
}

export function useUpdateNote(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (patch: NoteUpdate) => (await api.patch<Note>(`/notes/${id}`, patch)).data,
    onSuccess: (updated) => {
      qc.setQueryData(noteKeys.detail(id), updated);
      qc.invalidateQueries({ queryKey: noteKeys.lists() });
      // The trigger just wrote a new row. Nothing told the client that —
      // invalidating is how a server-side side effect becomes visible.
      qc.invalidateQueries({ queryKey: noteKeys.versions(id) });
    },
  });
}
```

**The `noteKeys` factory exists so invalidation is not stringly-typed.**
`invalidateQueries({ queryKey: ["notes"] })` scattered across twelve files is twelve
chances to typo a key and silently break refetching — a bug with no error, only stale
data. The hierarchy also means invalidating `noteKeys.all` invalidates every note query
at once, because TanStack Query matches key prefixes.

**Invalidating `versions` after an update is the interesting line.** The version row was
created by a PostgreSQL trigger. The API response says nothing about it. Without that
invalidation the history panel shows stale data and the trigger looks broken.

---

## 5.7 The editor — making the trigger visible

```tsx
// src/components/editor/note-editor.tsx
"use client";

import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useCallback, useEffect, useRef, useState } from "react";

import { useUpdateNote } from "@/hooks/use-notes";
import type { Note } from "@/types/api";

type SaveState = "idle" | "unsaved" | "saving" | "saved";

export function NoteEditor({ note }: { note: Note }) {
  const updateNote = useUpdateNote(note.id);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [unresolvedLinks, setUnresolvedLinks] = useState<string[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const save = useCallback(
    (content: string) => {
      setSaveState("saving");
      updateNote.mutate(
        { content },
        {
          // unresolved_wiki_links comes back on every save that touched
          // content — the API's write-time feedback from WikiLinkService
          // (04-API.md §4.9). It is not persisted; a GET won't repeat it.
          onSuccess: (updated) => {
            setSaveState("saved");
            setUnresolvedLinks(updated.unresolved_wiki_links);
          },
          onError: () => setSaveState("unsaved"),
        },
      );
    },
    [updateNote],
  );

  const editor = useEditor({
    // Next.js static export renders this on the server during `pnpm build`.
    // Without immediatelyRender: false, Tiptap warns about an SSR hydration
    // mismatch, because the editor DOM it produces is not deterministic.
    immediatelyRender: false,
    extensions: [
      StarterKit,
      Link.configure({ openOnClick: false }),
      Placeholder.configure({ placeholder: "Start writing…" }),
    ],
    content: note.content ?? "",
    onUpdate: ({ editor }) => {
      setSaveState("unsaved");
      if (timer.current) clearTimeout(timer.current);
      // 1500ms debounce. Every save fires the versioning trigger, so saving on
      // each keystroke would produce a version row per character — a correct
      // system producing useless history.
      timer.current = setTimeout(() => save(editor.getHTML()), 1500);
    },
  });

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>{note.word_count} words</span>
        <span aria-live="polite">
          {saveState === "unsaved" && "Unsaved changes"}
          {saveState === "saving" && "Saving…"}
          {saveState === "saved" && "Saved — version created"}
        </span>
      </div>
      <EditorContent editor={editor} className="prose max-w-none min-h-96" />
      {unresolvedLinks.length > 0 && (
        <p className="text-sm text-muted-foreground">
          Not found: {unresolvedLinks.map((t) => `[[${t}]]`).join(", ")} — check the
          spelling, or create that note.
        </p>
      )}
    </div>
  );
}
```

**"Saved — version created" is a deliberate teaching label.** It tells the user — and
the examiner — that a database trigger just ran. Pair it with the history panel open and
you can *show* the version count increment with no application code responsible for it.

**The debounce interval is a database decision, not a UX one.** Each save is an
`UPDATE`, each `UPDATE` fires `trg_notes_create_version`, and each firing writes a row.
At 1500 ms a paragraph produces a handful of meaningful versions instead of hundreds.

---

## 5.8 Wiki-link autocomplete

Typing `[[` should offer a list of the user's note titles, the same way every tool that
has this feature behaves. Tiptap's `@tiptap/suggestion` package — the same mechanism
that powers `/` slash-commands and `@` mentions — handles the trigger detection and
popup positioning; the only work is wiring it to a search and an insertion.

```tsx
// src/components/editor/wiki-link-extension.ts
import { Extension } from "@tiptap/core";
import Suggestion, { type SuggestionOptions } from "@tiptap/suggestion";

import { api } from "@/lib/api";
import type { NoteSummary } from "@/types/api";

export const WikiLink = Extension.create({
  name: "wikiLink",

  addOptions() {
    return {
      suggestion: {
        char: "[[",
        // Typing "]]" ends the match, so `[[BCN` is a live query and
        // `[[BCNF]]` is not — this is what stops the popup reopening on
        // text that is already a resolved link.
        allowedPrefixes: null,
        items: async ({ query }: { query: string }) => {
          if (query.length < 1) return [];
          const { data } = await api.get<NoteSummary[]>("/notes", {
            params: { search: query, limit: 8 },
          });
          return data;
        },
        render: () => {
          let popup: HTMLDivElement;
          return {
            onStart: (props) => {
              popup = document.createElement("div");
              popup.className = "wiki-link-suggestions";
              document.body.appendChild(popup);
              renderList(popup, props);
            },
            onUpdate: (props) => renderList(popup, props),
            onExit: () => popup.remove(),
          };

          function renderList(
            el: HTMLDivElement,
            props: { items: NoteSummary[]; command: (item: { title: string }) => void },
          ) {
            el.innerHTML = "";
            props.items.forEach((note) => {
              const row = document.createElement("button");
              row.textContent = note.title;
              row.onclick = () => props.command({ title: note.title });
              el.appendChild(row);
            });
          }
        },
        command: ({ editor, range, props }) => {
          // Insert the literal text "[[Title]]" — a plain string, not a
          // special node. The backend's WikiLinkService (04-API.md §4.9)
          // parses this same substring back out of the stored HTML, so
          // insertion and extraction agree on one format with no schema
          // for a custom node to keep in sync.
          editor
            .chain()
            .focus()
            .insertContentAt(range, `[[${(props as { title: string }).title}]]`)
            .run();
        },
      } satisfies Partial<SuggestionOptions>,
    };
  },

  addProseMirrorPlugins() {
    return [Suggestion({ editor: this.editor, ...this.options.suggestion })];
  },
});
```

Add it to the extension list in `NoteEditor` (§5.7):

```tsx
extensions: [
  StarterKit,
  Link.configure({ openOnClick: false }),
  Placeholder.configure({ placeholder: "Start writing…" }),
  WikiLink,
],
```

**This inserts plain text, deliberately, not a custom Tiptap node.** A custom node would
need its own schema, its own serialization to and from HTML, and would have to stay in
lockstep with the backend's regex forever. Plain text keeps exactly one format — the
literal `[[Title]]` substring — shared by the editor and the reconciler, with nothing to
keep synchronized. The cost is that a resolved link isn't visually styled differently
from typed-but-unmatched text; the unresolved banner in §5.7 is what closes that gap
without the complexity of a custom node.

> **Viva question:** *Why not make `[[wiki-links]]` a real link a user can click?*
>
> "That's a legitimate next step — a Tiptap Mark that renders `[[Title]]` as a styled,
> clickable span pointing at the note's route. I kept the MVP as plain text because the
> backend's extraction only needs to find a substring, and a Mark adds a second
> representation — the mark's attributes and the text inside it — that could drift out
> of sync if a title is edited elsewhere. Once the plain-text version is solid, wrapping
> it in a Mark is a rendering change, not a data model change."

---

## 5.9 The graph canvas

```tsx
// src/components/graph/graph-canvas.tsx
"use client";

import cytoscape, { type Core } from "cytoscape";
import { useEffect, useRef } from "react";

import type { GraphResponse } from "@/types/api";

export function GraphCanvas({
  graph,
  onNodeClick,
}: {
  graph: GraphResponse;
  onNodeClick?: (id: string) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const cy = useRef<Core | null>(null);

  useEffect(() => {
    if (!container.current) return;

    cy.current = cytoscape({
      container: container.current,
      elements: [
        ...graph.nodes.map((n) => ({
          data: { id: n.id, label: n.title, depth: n.depth, owned: n.is_owned },
        })),
        ...graph.edges.map((e) => ({
          data: {
            id: e.id,
            source: e.source,
            target: e.target,
            label: e.rel_type,
            color: e.color,
            width: Math.max(1, e.strength / 2),
            arrow: e.is_symmetric ? "none" : "triangle",
          },
        })),
      ],
      style: [
        {
          selector: "node",
          style: {
            label: "data(label)",
            "text-wrap": "ellipsis",
            "text-max-width": "120px",
            "font-size": "11px",
            // Depth is the recursive CTE's output. Colouring by it makes the
            // traversal itself visible: the root is dark, each hop is lighter.
            "background-color": (el: cytoscape.NodeSingular) =>
              ["#1e293b", "#3b82f6", "#93c5fd", "#dbeafe"][
                Math.min(el.data("depth") as number, 3)
              ],
            "border-width": (el: cytoscape.NodeSingular) => (el.data("owned") ? 0 : 2),
            "border-style": "dashed",
          },
        },
        {
          selector: "edge",
          style: {
            label: "data(label)",
            "font-size": "9px",
            width: "data(width)",
            "line-color": "data(color)",
            "target-arrow-color": "data(color)",
            "target-arrow-shape": "data(arrow)",
            "curve-style": "bezier",
          },
        },
      ],
      // cose is force-directed: connected nodes attract, all nodes repel.
      // Clusters emerge from the data rather than from a fixed layout, which is
      // what makes the structure of the knowledge graph legible at a glance.
      layout: { name: "cose", animate: true, nodeRepulsion: 8000, idealEdgeLength: 120 },
    });

    if (onNodeClick) {
      cy.current.on("tap", "node", (evt) => onNodeClick(evt.target.id()));
    }

    return () => {
      cy.current?.destroy(); // Cytoscape attaches listeners outside React
      cy.current = null;
    };
  }, [graph, onNodeClick]);

  return <div ref={container} className="h-[600px] w-full rounded-lg border" />;
}
```

**`cy.destroy()` in the cleanup is mandatory.** Cytoscape manages its own canvas and
event listeners outside React's tree; without an explicit teardown they survive unmount
and accumulate on every navigation.

**Node colour encodes `depth`, and depth comes from the recursive CTE.** The visual is
a direct rendering of the SQL. When you demo this, say that — it connects the thing on
screen to the thing being graded.

**Dashed borders mark notes you do not own** — public notes of other users that your
graph reaches. It makes ADR-007's ownership model visible.

---

## 5.10 Screens to build

| Screen | Demonstrates |
|---|---|
| `/dashboard` | The `v_user_dashboard` view, whole |
| `/notes` | Pagination, filtering, pinned-first ordering |
| `/notes/[id]` | Editor + version history + rollback + local graph |
| `/graph` | Whole-workspace recursive traversal, depth slider 1–5 |
| `/search` | `ts_rank_cd` ordering with `<mark>` snippets from `ts_headline` |
| `/collections` | M:N junction with ordering |
| `/review` | Flashcards, SM-2 scheduling, `due_at` index |
| Notification bell | The link trigger's output, partial index on unread |

**The depth slider on `/graph` earns its place.** Moving it from 1 to 5 and watching the
node count grow is the clearest possible demonstration that traversal is recursive and
depth-bounded — and it makes the cache visible too, since re-selecting a depth you have
already viewed returns instantly.

---

## 5.11 Phase 5 checklist

```
□ Sign up → email confirm → login → /dashboard
□ Signed-out visit to /dashboard redirects, with no flash of the shell
□ Create a note, type, wait 1.5s, see "Saved — version created"
□ History panel shows the new version WITHOUT a manual page refresh
□ Rollback restores content AND adds a version of what it replaced
□ Link two notes; the graph adds an edge with the right colour and arrow
□ Typing [[ opens a note-title popup; selecting one inserts [[Title]]
□ Saving with a resolved [[Title]] creates a graph edge with no dialog
□ An unmatched [[Typo]] shows the "Not found" banner instead of failing
□ Depth slider 1→5 changes the node count
□ Another user's public note appears with a dashed border
□ Search highlights matches; title hits rank above body hits
□ Notification bell increments when someone links your public note
□ Sign out in one tab redirects the other tab
□ pnpm type-check && pnpm lint && pnpm build all clean
□ `git archive HEAD` into a clean dir → pnpm install && pnpm build still works
```

The last line is the §1.13 check again. Run it before submission — it is the only one
that catches a file that exists on your disk and in no commit.

---

**Next:** [`06-QUALITY.md`](06-QUALITY.md) — tests that prove the triggers and the CTE
work.
