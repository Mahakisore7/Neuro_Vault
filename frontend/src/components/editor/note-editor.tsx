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
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const save = useCallback(
    (content: string) => {
      setSaveState("saving");
      updateNote.mutate(
        { content },
        {
          onSuccess: () => setSaveState("saved"),
          onError: () => setSaveState("unsaved"),
        },
      );
    },
    [updateNote],
  );

  const editor = useEditor({
    // Next.js renders this on the server during `next build`. Without
    // immediatelyRender: false, Tiptap warns about an SSR hydration
    // mismatch, because the editor DOM it produces isn't deterministic.
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
      // 1500ms debounce. Every save fires the versioning trigger (once
      // 03-SQL-LAYER lands), so saving on each keystroke would produce a
      // version row per character.
      timer.current = setTimeout(() => save(editor.getHTML()), 1500);
    },
    editorProps: {
      attributes: {
        class:
          "prose prose-sm dark:prose-invert max-w-none min-h-96 focus:outline-none px-1 py-2",
      },
    },
  });

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-end text-sm text-muted-foreground">
        <span aria-live="polite">
          {saveState === "unsaved" && "Unsaved changes"}
          {saveState === "saving" && "Saving…"}
          {saveState === "saved" && "Saved"}
        </span>
      </div>
      <EditorContent editor={editor} />
    </div>
  );
}
