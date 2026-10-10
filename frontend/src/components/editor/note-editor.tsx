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
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { linkKeys } from "@/hooks/use-links";
import { noteKeys, useAllNotes, useCreateNote } from "@/hooks/use-notes";
import { api } from "@/lib/api";
import type { Note } from "@/types/api";

import { EditorFloatingMenu } from "./editor-floating-menu";
import { EditorToolbar } from "./editor-toolbar";
import { REFRESH_WIKI_LINKS, WikiLink, wikiLinkStorage } from "./wiki-link-extension";
import { WikiLinkSuggest } from "./wiki-link-suggest";

type SaveState = "idle" | "unsaved" | "saving" | "saved" | "error";

// 1500ms debounce. Every save fires the versioning trigger, so saving on
// each keystroke would produce a version row per character.
const AUTOSAVE_DELAY_MS = 1500;

/** readOnly: someone else's public note - viewable, never saved. */
export function NoteEditor({ note, readOnly = false }: { note: Note; readOnly?: boolean }) {
  const qc = useQueryClient();
  const router = useRouter();
  // mutateAsync is stable across renders; the mutation object itself isn't.
  const { mutateAsync: createNoteAsync } = useCreateNote();
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Edited content not sent yet. null = nothing outstanding.
  const pending = useRef<string | null>(null);
  // Saves still on the wire. Kept as a promise chain so each PATCH starts
  // only after the previous one settles: two saves can never land out of
  // order and leave the older text on the server.
  const inFlight = useRef(0);
  const queue = useRef<Promise<unknown>>(Promise.resolve());

  // Plain api calls rather than a useMutation: the save on leaving the page
  // runs after this component unmounts, when a mutation's per-call
  // callbacks no longer fire.
  const flush = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    const content = pending.current;
    if (content === null) return;
    pending.current = null;
    inFlight.current += 1;
    setSaveState("saving");

    const request = queue.current.then(() => api.patch<Note>(`/notes/${note.id}`, { content }));
    queue.current = request.catch(() => undefined);
    request
      .then(({ data }) => {
        qc.setQueryData(noteKeys.detail(note.id), data);
        // Lists only: refetching this note's detail mid-typing is exactly
        // what used to overwrite newer keystrokes.
        qc.invalidateQueries({ queryKey: [...noteKeys.all, "list"] });
        // The server reconciled [[wiki-links]] on this save, so the link bar
        // and graph may have changed.
        qc.invalidateQueries({ queryKey: linkKeys.forNote(note.id) });
        inFlight.current -= 1;
        if (pending.current === null && inFlight.current === 0) setSaveState("saved");
      })
      .catch(() => {
        inFlight.current -= 1;
        // Keep the newest text: if more typing is already pending, that
        // supersedes this failed save.
        if (pending.current === null) pending.current = content;
        setSaveState("error");
      });
  }, [note.id, qc]);

  // The unmount cleanup and the window listeners need the current flush,
  // not the one captured when they were registered.
  const flushRef = useRef(flush);
  useEffect(() => {
    flushRef.current = flush;
  }, [flush]);

  // The author's notes, for [[wiki-link]] highlighting and autocomplete.
  // Not for someone else's public note: their links resolve against their
  // notes, which this viewer can't see.
  const { data: allNotes } = useAllNotes({ enabled: !readOnly });
  const candidates = useMemo(
    () =>
      (allNotes ?? []).filter((n) => n.id !== note.id).map((n) => ({ id: n.id, title: n.title })),
    [allNotes, note.id],
  );
  const editor = useEditor({
    // Next.js renders this on the server during `next build`. Without
    // immediatelyRender: false, Tiptap warns about an SSR hydration
    // mismatch, because the editor DOM it produces isn't deterministic.
    immediatelyRender: false,
    editable: !readOnly,
    extensions: [
      StarterKit,
      Underline,
      Highlight.configure({ multicolor: false }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Link.configure({ openOnClick: false }),
      Placeholder.configure({ placeholder: "Start writing…" }),
      CharacterCount,
      ...(readOnly ? [] : [WikiLink]),
    ],
    content: note.content ?? "",
    onUpdate: ({ editor }) => {
      pending.current = editor.getHTML();
      setSaveState("unsaved");
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => flushRef.current(), AUTOSAVE_DELAY_MS);
    },
    editorProps: {
      attributes: {
        class:
          "prose dark:prose-invert max-w-none min-h-[32rem] focus:outline-none px-6 py-6 [&_ul[data-type=taskList]]:list-none [&_ul[data-type=taskList]]:pl-0 [&_ul[data-type=taskList]_li]:flex [&_ul[data-type=taskList]_li]:items-start [&_ul[data-type=taskList]_li]:gap-2",
      },
    },
  });

  useEffect(() => {
    // Leaving the note (or switching to another) saves what's outstanding
    // instead of dropping the last few seconds of typing with the timer.
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (pending.current === null && inFlight.current === 0) return;
      flushRef.current();
      e.preventDefault(); // the browser's "leave site?" prompt
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault(); // not the browser's "save page as"
        flushRef.current();
      }
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      window.removeEventListener("keydown", onKeyDown);
      flushRef.current();
    };
  }, []);

  // Hand the [[wiki-link]] extension the current note list, and redraw the
  // highlights whenever it changes (a note created or renamed).
  useEffect(() => {
    if (!editor || editor.isDestroyed || readOnly) return;
    const byTitle = new Map(candidates.map((n) => [n.title.toLowerCase(), n.id]));
    const storage = wikiLinkStorage(editor);
    storage.isResolved = (title) => byTitle.has(title.toLowerCase());
    // Ctrl+click on a [[title]]: open that note, or create it if none exists.
    storage.onOpen = async (title) => {
      const id = byTitle.get(title.toLowerCase());
      if (id) {
        router.push(`/notes/${id}`);
        return;
      }
      try {
        const created = await createNoteAsync({ title, notebook_id: note.notebook_id });
        // Save this note again so the server links it to the new one: its
        // text hasn't changed, so no save would otherwise happen.
        pending.current = editor.getHTML();
        flushRef.current();
        toast.success(`Created "${title}"`);
        router.push(`/notes/${created.id}`);
      } catch {
        toast.error(`Couldn't create "${title}".`);
      }
    };
    editor.view.dispatch(editor.state.tr.setMeta(REFRESH_WIKI_LINKS, true));
  }, [candidates, editor, readOnly, router, createNoteAsync, note.notebook_id]);

  // Tiptap's `content` option only seeds the editor at creation - it does
  // not react to prop changes. This applies a change that came from outside
  // the editor (a version rollback). It must stand down while local edits
  // are outstanding: a save's response carries the text as it was SENT, and
  // writing that back would erase whatever was typed during the round trip.
  useEffect(() => {
    if (!editor) return;
    if (pending.current !== null || inFlight.current > 0) return;
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
        {readOnly ? (
          <span>Read-only: this public note belongs to someone else</span>
        ) : (
          <span aria-live="polite" className="flex items-center gap-2">
            {saveState === "unsaved" && "Unsaved changes"}
            {saveState === "saving" && "Saving…"}
            {saveState === "saved" && "Saved"}
            {saveState === "error" && (
              <>
                <span className="text-destructive">Couldn&rsquo;t save</span>
                <Button variant="outline" size="sm" className="h-6 px-2 text-xs" onClick={flush}>
                  Retry
                </Button>
              </>
            )}
            <kbd
              className="hidden rounded border px-1 font-mono text-[10px] sm:inline"
              title="Save now"
            >
              Ctrl S
            </kbd>
          </span>
        )}
      </div>

      <div className="rounded-lg border bg-card ring-1 ring-transparent transition-shadow focus-within:ring-ring/30">
        {editor && !readOnly && <EditorToolbar editor={editor} />}
        {editor && !readOnly && <EditorFloatingMenu editor={editor} />}
        {editor && !readOnly && <WikiLinkSuggest editor={editor} notes={candidates} />}
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}
