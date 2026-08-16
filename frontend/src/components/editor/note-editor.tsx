"use client";

import CharacterCount from "@tiptap/extension-character-count";
import Highlight from "@tiptap/extension-highlight";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import TaskItem from "@tiptap/extension-task-item";
import TaskList from "@tiptap/extension-task-list";
import Underline from "@tiptap/extension-underline";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useCallback, useEffect, useRef, useState } from "react";

import { useUpdateNote } from "@/hooks/use-notes";
import type { Note } from "@/types/api";

import { EditorFloatingMenu } from "./editor-floating-menu";
import { EditorToolbar } from "./editor-toolbar";

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
      Underline,
      Highlight.configure({ multicolor: false }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Link.configure({ openOnClick: false }),
      Placeholder.configure({ placeholder: "Start writing…" }),
      CharacterCount,
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
          "prose dark:prose-invert max-w-none min-h-[32rem] focus:outline-none px-6 py-6 [&_ul[data-type=taskList]]:list-none [&_ul[data-type=taskList]]:pl-0 [&_ul[data-type=taskList]_li]:flex [&_ul[data-type=taskList]_li]:items-start [&_ul[data-type=taskList]_li]:gap-2",
      },
    },
  });

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  // Tiptap's `content` option only seeds the editor at creation - it does
  // not react to prop changes. Typing already keeps editor and note.content
  // in sync via the debounced save above, so this only actually does
  // anything for a change that came from outside the editor's own typing
  // (a version rollback): compare before writing, or every render after an
  // ordinary autosave would needlessly reset the selection/undo stack.
  useEffect(() => {
    if (!editor) return;
    if (note.content !== editor.getHTML()) {
      editor.commands.setContent(note.content ?? "", { emitUpdate: false });
    }
  }, [note.content, editor]);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>
          {editor && (
            <>
              {editor.storage.characterCount.words()} words ·{" "}
              {editor.storage.characterCount.characters()} characters
            </>
          )}
        </span>
        <span aria-live="polite">
          {saveState === "unsaved" && "Unsaved changes"}
          {saveState === "saving" && "Saving…"}
          {saveState === "saved" && "Saved"}
        </span>
      </div>

      <div className="rounded-lg border bg-card ring-1 ring-transparent transition-shadow focus-within:ring-ring/30">
        {editor && <EditorToolbar editor={editor} />}
        {editor && <EditorFloatingMenu editor={editor} />}
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}
