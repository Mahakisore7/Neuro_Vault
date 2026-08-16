"use client";

import { ArrowLeft, Globe, Lock, Pin, PinOff } from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { NoteEditor } from "@/components/editor/note-editor";
import { useNote, useUpdateNote } from "@/hooks/use-notes";

export default function NoteDetailPage() {
  const { noteId } = useParams<{ noteId: string }>();
  const router = useRouter();
  const { data: note, isLoading } = useNote(noteId);
  const updateNote = useUpdateNote(noteId);

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

      <NoteEditor note={note} />
    </div>
  );
}
