"use client";

import { ArrowLeft, Globe, Lock, Pin, PinOff } from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { VersionHistoryDialog } from "@/components/editor/version-history-dialog";
import { NoteEditor } from "@/components/editor/note-editor";
import { FlashcardPanel } from "@/components/notes/flashcard-panel";
import { LinkPanel } from "@/components/notes/link-panel";
import { TagPicker } from "@/components/notes/tag-picker";
import { useNote, useUpdateNote } from "@/hooks/use-notes";
import { useMe } from "@/hooks/use-user";
import { usePageTitle } from "@/hooks/use-page-title";

export default function NoteDetailPage() {
  const { noteId } = useParams<{ noteId: string }>();
  const router = useRouter();
  const { data: note, isLoading } = useNote(noteId);
  usePageTitle(note?.title);
  const updateNote = useUpdateNote(noteId);
  const { data: me } = useMe();

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
      <button
        onClick={() => router.back()}
        className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" />
        Back
      </button>

      <div className="mb-6 flex items-start justify-between gap-4">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={commitTitle}
          className="w-full flex-1 border-none bg-transparent text-3xl font-semibold tracking-tight outline-none"
        />
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
      </div>

      <div className="mb-2">
        <TagPicker noteId={note.id} />
      </div>

      <div className="mb-4 flex flex-wrap items-start gap-x-2">
        <div className="min-w-0 flex-1">
          <LinkPanel noteId={note.id} />
        </div>
        {/* Flashcards are private study state - only on notes you own. */}
        {me?.id === note.creator_id && <FlashcardPanel noteId={note.id} />}
      </div>

      {/* Keyed so moving straight to another note remounts the editor,
          which saves the previous note's outstanding edits on the way out. */}
      <NoteEditor key={note.id} note={note} />
    </div>
  );
}
