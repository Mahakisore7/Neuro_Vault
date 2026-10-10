"use client";

import type { Editor } from "@tiptap/react";
import { FileText } from "lucide-react";
import { useEffect, useRef, useState } from "react";

type Candidate = { id: string; title: string };
type Open = { query: string; from: number; to: number; top: number; left: number };

// The text right before the cursor, if it's an unfinished "[[query".
const TRIGGER = /\[\[([^[\]|\n]{0,80})$/;
const MAX_SHOWN = 8;

/**
 * Typing "[[" in the editor opens a list of the author's notes, narrowed as
 * they type; Enter or a click completes it to "[[Title]]". Arrow keys move,
 * Escape dismisses. The keys are intercepted only while the list is open.
 */
export function WikiLinkSuggest({ editor, notes }: { editor: Editor; notes: Candidate[] }) {
  const [open, setOpen] = useState<Open | null>(null);
  const [active, setActive] = useState(0);
  const dismissedAt = useRef<number | null>(null);

  const query = open?.query.trim().toLowerCase() ?? "";
  const matches = open
    ? notes
        .filter((n) => n.title.toLowerCase().includes(query))
        // Titles that start with what was typed first, then alphabetical.
        .sort(
          (a, b) =>
            Number(!a.title.toLowerCase().startsWith(query)) -
              Number(!b.title.toLowerCase().startsWith(query)) || a.title.localeCompare(b.title),
        )
        .slice(0, MAX_SHOWN)
    : [];
  const activeIndex = Math.min(active, Math.max(matches.length - 1, 0));

  // Refs so the DOM key listener below always sees the current list without
  // being re-registered on every keystroke.
  const state = useRef({ open, matches, activeIndex });
  useEffect(() => {
    state.current = { open, matches, activeIndex };
  });

  useEffect(() => {
    const check = () => {
      const { $from, empty } = editor.state.selection;
      const typed = empty ? $from.parent.textBetween(0, $from.parentOffset, undefined, "￼") : "";
      const m = TRIGGER.exec(typed);
      if (!m || dismissedAt.current === $from.pos - m[1].length) {
        setOpen(null);
        return;
      }
      dismissedAt.current = null;
      const coords = editor.view.coordsAtPos($from.pos);
      if (state.current.open?.query !== m[1]) setActive(0);
      setOpen({
        query: m[1],
        from: $from.pos - m[1].length - 2,
        to: $from.pos,
        top: coords.bottom + 6,
        left: coords.left,
      });
    };
    editor.on("update", check);
    editor.on("selectionUpdate", check);
    return () => {
      editor.off("update", check);
      editor.off("selectionUpdate", check);
    };
  }, [editor]);

  function choose(title: string) {
    const current = state.current.open;
    if (!current) return;
    editor
      .chain()
      .focus()
      .insertContentAt({ from: current.from, to: current.to }, `[[${title}]] `)
      .run();
    setOpen(null);
  }
  const chooseRef = useRef(choose);
  useEffect(() => {
    chooseRef.current = choose;
  });

  useEffect(() => {
    const dom = editor.view.dom;
    // Capture phase: runs before ProseMirror turns Enter into a new paragraph.
    const onKeyDown = (e: KeyboardEvent) => {
      const { open: current, matches: list, activeIndex: idx } = state.current;
      if (!current) return;
      if (e.key === "Escape") {
        e.preventDefault();
        dismissedAt.current = current.from + 2;
        setOpen(null);
      } else if (list.length && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
        e.preventDefault();
        setActive((idx + (e.key === "ArrowDown" ? 1 : list.length - 1)) % list.length);
      } else if (list.length && (e.key === "Enter" || e.key === "Tab")) {
        e.preventDefault();
        chooseRef.current(list[idx].title);
      }
    };
    dom.addEventListener("keydown", onKeyDown, true);
    return () => dom.removeEventListener("keydown", onKeyDown, true);
  }, [editor]);

  if (!open) return null;

  return (
    <div
      role="listbox"
      aria-label="Link to a note"
      className="fixed z-50 w-72 overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
      style={{ top: open.top, left: open.left }}
    >
      {matches.length === 0 ? (
        <p className="px-2 py-1.5 text-xs text-muted-foreground">
          No note titled like that yet. Finish with ]] and Ctrl+click it to create one.
        </p>
      ) : (
        matches.map((n, i) => (
          <button
            key={n.id}
            type="button"
            role="option"
            aria-selected={i === activeIndex}
            // mousedown, not click: keeps focus (and the cursor) in the editor.
            onMouseDown={(e) => {
              e.preventDefault();
              choose(n.title);
            }}
            onMouseEnter={() => setActive(i)}
            className={`flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm ${
              i === activeIndex ? "bg-muted" : ""
            }`}
          >
            <FileText className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="truncate">{n.title}</span>
          </button>
        ))
      )}
      <p className="border-t px-2 pt-1 pb-0.5 text-[10px] text-muted-foreground">
        Enter to link · Esc to dismiss
      </p>
    </div>
  );
}
