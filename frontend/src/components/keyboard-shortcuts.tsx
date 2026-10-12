"use client";

import { useEffect, useState } from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/** Dispatch on window to open the dialog from elsewhere (the command palette). */
export const OPEN_SHORTCUTS_EVENT = "neurovault:open-shortcuts";

const GROUPS: { title: string; shortcuts: { keys: string[]; label: string }[] }[] = [
  {
    title: "Anywhere",
    shortcuts: [
      { keys: ["Ctrl", "K"], label: "Search notes and run commands" },
      { keys: ["Ctrl", "\\"], label: "Collapse or expand the sidebar" },
      { keys: ["?"], label: "Show these shortcuts" },
      { keys: ["Esc"], label: "Close a dialog or menu" },
    ],
  },
  {
    title: "Writing a note",
    shortcuts: [
      { keys: ["Ctrl", "S"], label: "Save now (it also saves as you type)" },
      { keys: ["Ctrl", "B"], label: "Bold" },
      { keys: ["Ctrl", "I"], label: "Italic" },
      { keys: ["Ctrl", "U"], label: "Underline" },
      { keys: ["Ctrl", "Z"], label: "Undo" },
    ],
  },
  {
    title: "Reviewing flashcards",
    shortcuts: [
      { keys: ["Space"], label: "Show the answer" },
      { keys: ["1"], label: "Again (forgot)" },
      { keys: ["2"], label: "Hard" },
      { keys: ["3"], label: "Good" },
      { keys: ["4"], label: "Easy" },
    ],
  },
];

// "?" is an ordinary character while typing, so it only opens the dialog
// when focus isn't in something editable.
function isTyping(target: EventTarget | null) {
  const el = target as HTMLElement | null;
  return Boolean(
    el &&
    (el.isContentEditable ||
      el.tagName === "INPUT" ||
      el.tagName === "TEXTAREA" ||
      el.tagName === "SELECT"),
  );
}

export function KeyboardShortcuts() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "?" && !e.ctrlKey && !e.metaKey && !isTyping(e.target)) {
        e.preventDefault();
        setOpen(true);
      }
    };
    const onOpen = () => setOpen(true);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener(OPEN_SHORTCUTS_EVENT, onOpen);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener(OPEN_SHORTCUTS_EVENT, onOpen);
    };
  }, []);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>On a Mac, use ⌘ where these say Ctrl.</DialogDescription>
        </DialogHeader>
        <div className="space-y-5">
          {GROUPS.map((group) => (
            <section key={group.title}>
              <h3 className="mb-2 text-[11px] font-medium tracking-wider text-muted-foreground uppercase">
                {group.title}
              </h3>
              <dl className="divide-y rounded-md border">
                {group.shortcuts.map((s) => (
                  <div
                    key={s.label}
                    className="flex items-center justify-between gap-4 px-3 py-2 text-sm"
                  >
                    <dt>{s.label}</dt>
                    <dd className="flex shrink-0 gap-1">
                      {s.keys.map((k) => (
                        <kbd
                          key={k}
                          className="min-w-6 rounded border bg-muted px-1.5 py-0.5 text-center font-mono text-xs"
                        >
                          {k}
                        </kbd>
                      ))}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
