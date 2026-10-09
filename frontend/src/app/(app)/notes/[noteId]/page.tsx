"use client";

import { ChevronRight, Globe, Lock, Pin, PinOff } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { VersionHistoryDialog } from "@/components/editor/version-history-dialog";
import { NoteEditor } from "@/components/editor/note-editor";
import { FlashcardPanel } from "@/components/notes/flashcard-panel";
import { LinkPanel } from "@/components/notes/link-panel";
import { TagPicker } from "@/components/notes/tag-picker";
import { useNotebook } from "@/hooks/use-notebooks";
import { useNote, useUpdateNote } from "@/hooks/use-notes";
import { useWorkspace } from "@/hooks/use-workspaces";
import { useMe } from "@/hooks/use-user";
import { usePageTitle } from "@/hooks/use-page-title";

export default function NoteDetailPage() {
  const { noteId } = useParams<{ noteId: string }>();
  const { data: note, isLoading } = useNote(noteId);
  usePageTitle(note?.title);
  const updateNote = useUpdateNote(noteId);
  const { data: me } = useMe();
  // A public note from someone else opens read-only: the server would
  // reject every save anyway, so the page shouldn't invite edits.
  const isOwner = Boolean(me && note && me.id === note.creator_id);

  const [title, setTitle] = useState("");
  // Adjusting state during render (guarded so it only fires once per note),
  // not in an effect — the note arrives async from the query, so there's no
  // prop to derive from at mount time the way a plain useState initializer
  // could use.
  const [loadedNoteId, setLoadedNoteId] = useState<string | null>(null);
  if (note && loadedNoteId !== note.id) {
    setLoadedNoteId(note.id);
    setTitle(note.title);
  }

  function commitTitle() {
    if (note && title.trim() && title !== note.title) {
      updateNote.mutate({ title: title.trim() });
    }
  }

  if (isLoading || !note) {
    return (
      <div className="mx-auto max-w-4xl space-y-4 px-6 py-10">
        <Skeleton className="h-8 w-24" />
        <Skeleton className="h-10 w-2/3" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl px-6 py-10">
      {isOwner ? (
        <Breadcrumbs notebookId={note.notebook_id} />
      ) : (
        <p className="mb-4 flex items-center gap-1.5 text-sm text-muted-foreground">
          <Globe className="size-3.5" />
          Public note
        </p>
      )}

      <div className="mb-6 flex items-start justify-between gap-4">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={commitTitle}
          readOnly={!isOwner}
          aria-label="Note title"
          className="w-full flex-1 border-none bg-transparent text-3xl font-semibold tracking-tight outline-none"
        />
        {isOwner && (
          <div className="flex shrink-0 items-center gap-1 pt-2">
            <VersionHistoryDialog noteId={note.id} />
            <Button
              variant="ghost"
              size="icon"
              title={note.pinned ? "Unpin" : "Pin"}
              onClick={() => updateNote.mutate({ pinned: !note.pinned })}
            >
              {note.pinned ? <PinOff className="size-4" /> : <Pin className="size-4" />}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              title={note.is_public ? "Make private" : "Make public"}
              onClick={() => updateNote.mutate({ is_public: !note.is_public })}
            >
              {note.is_public ? <Globe className="size-4" /> : <Lock className="size-4" />}
            </Button>
          </div>
        )}
      </div>

      {isOwner && (
        <div className="mb-2">
          <TagPicker noteId={note.id} />
        </div>
      )}

      <div className="mb-4 flex flex-wrap items-start gap-x-2">
        <div className="min-w-0 flex-1">
          <LinkPanel noteId={note.id} />
        </div>
        {/* Flashcards are private study state - only on notes you own. */}
        {me?.id === note.creator_id && <FlashcardPanel noteId={note.id} />}
      </div>

      {/* Keyed so moving straight to another note remounts the editor,
          which saves the previous note's outstanding edits on the way out. */}
      <NoteEditor key={note.id} note={note} readOnly={!isOwner} />
    </div>
  );
}

// Where the note lives, as links back up the hierarchy. Replaces a "Back"
// button whose destination depended on browser history: arriving from
// search or a link left it pointing somewhere unrelated.
function Breadcrumbs({ notebookId }: { notebookId: string | null }) {
  const { data: notebook } = useNotebook(notebookId ?? undefined);
  const { data: workspace } = useWorkspace(notebook?.workspace_id);
  const crumb = "truncate hover:text-foreground";

  return (
    <nav aria-label="Breadcrumb" className="mb-4 text-sm text-muted-foreground">
      <ol className="flex min-w-0 items-center gap-1">
        {notebookId === null ? (
          <li>
            <Link href="/unfiled" className={crumb}>
              Unfiled
            </Link>
          </li>
        ) : (
          <>
            <li className="min-w-0">
              <Link href="/workspaces" className={crumb}>
                {workspace?.name ?? "Workspaces"}
              </Link>
            </li>
            <ChevronRight className="size-3.5 shrink-0" aria-hidden />
            <li className="min-w-0">
              {notebook && workspace ? (
                <Link
                  href={`/workspaces/${workspace.id}/notebooks/${notebook.id}`}
                  className={crumb}
                >
                  {notebook.name}
                </Link>
              ) : (
                <span>…</span>
              )}
            </li>
          </>
        )}
      </ol>
    </nav>
  );
}
