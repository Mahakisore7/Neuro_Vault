"use client";

import {
  CornerDownLeft,
  FilePlus2,
  FileText,
  Globe,
  Keyboard,
  Loader2,
  Moon,
  Search,
  UserRound,
} from "lucide-react";
import { useTheme } from "next-themes";
import { useRouter } from "next/navigation";
import { Fragment, useEffect, useState } from "react";
import { toast } from "sonner";

import { NAV_GROUPS } from "@/components/layout/sidebar";
import { OPEN_SHORTCUTS_EVENT } from "@/components/keyboard-shortcuts";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { useCreateNote, useNoteSearch } from "@/hooks/use-notes";
import type { NoteSearchResult } from "@/types/api";

const START = "\u0001";
const STOP = "\u0002";

// The API marks matches with sentinel characters instead of <mark> tags, so
// note text is only ever rendered as React text nodes — never as HTML.
function Highlighted({ text }: { text: string }) {
  const parts: { text: string; hit: boolean }[] = [];
  let i = 0;
  while (i < text.length) {
    const start = text.indexOf(START, i);
    if (start === -1) {
      parts.push({ text: text.slice(i), hit: false });
      break;
    }
    const stop = text.indexOf(STOP, start + 1);
    if (stop === -1) {
      parts.push({ text: text.slice(i).replaceAll(START, ""), hit: false });
      break;
    }
    if (start > i) parts.push({ text: text.slice(i, start), hit: false });
    parts.push({ text: text.slice(start + 1, stop), hit: true });
    i = stop + 1;
  }
  return (
    <>
      {parts.map((p, idx) =>
        p.hit ? (
          <mark key={idx} className="rounded-sm bg-primary/20 px-0.5 text-foreground">
            {p.text}
          </mark>
        ) : (
          <Fragment key={idx}>{p.text}</Fragment>
        ),
      )}
    </>
  );
}

// One row of the palette: a command, a destination, or a note. A single
// flat list so the arrow keys move through all of them in order.
type Item =
  | { kind: "command"; id: string; label: string; icon: typeof Search; run: () => void }
  | { kind: "note"; id: string; note: NoteSearchResult };

export function SearchDialog() {
  const router = useRouter();
  const { resolvedTheme, setTheme } = useTheme();
  const createNote = useCreateNote();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);

  const debounced = useDebouncedValue(query, 200);
  const { data: results = [], isFetching } = useNoteSearch(debounced);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  function close() {
    setOpen(false);
    setQuery("");
    setActiveIndex(0);
  }

  async function newNote() {
    try {
      // Unfiled until the user files it: the quickest capture is a blank
      // page, not a "which notebook?" question first.
      const note = await createNote.mutateAsync({ title: "Untitled" });
      router.push(`/notes/${note.id}`);
    } catch {
      toast.error("Couldn't create the note.");
    }
  }

  const commands: Item[] = [
    { kind: "command", id: "new-note", label: "New note", icon: FilePlus2, run: newNote },
    ...NAV_GROUPS.flatMap((g) => g.items).map((item): Item => ({
      kind: "command",
      id: item.href,
      label: `Go to ${item.label}`,
      icon: item.icon,
      run: () => router.push(item.href),
    })),
    {
      kind: "command",
      id: "/profile",
      label: "Go to Profile",
      icon: UserRound,
      run: () => router.push("/profile"),
    },
    {
      kind: "command",
      id: "theme",
      label: resolvedTheme === "dark" ? "Switch to light theme" : "Switch to dark theme",
      icon: Moon,
      run: () => setTheme(resolvedTheme === "dark" ? "light" : "dark"),
    },
    {
      kind: "command",
      id: "shortcuts",
      label: "Keyboard shortcuts",
      icon: Keyboard,
      run: () => window.dispatchEvent(new Event(OPEN_SHORTCUTS_EVENT)),
    },
  ];

  const trimmed = query.trim().toLowerCase();
  const hasQuery = debounced.trim().length > 0;
  // Every word typed must appear in the command's label, in any order:
  // "theme dark" and "dark theme" both find "Switch to dark theme".
  const matchingCommands = trimmed
    ? commands.filter(
        (c) =>
          c.kind === "command" &&
          trimmed.split(/\s+/).every((w) => c.label.toLowerCase().includes(w)),
      )
    : commands;
  const noteItems: Item[] = hasQuery
    ? results.map((note) => ({ kind: "note", id: note.id, note }))
    : [];
  // While searching, notes are what you're most likely after; commands that
  // also match follow them. With nothing typed, the palette is all commands.
  const items = hasQuery ? [...noteItems, ...matchingCommands] : matchingCommands;
  const active = Math.min(activeIndex, Math.max(items.length - 1, 0));

  function choose(item: Item) {
    close();
    if (item.kind === "note") router.push(`/notes/${item.note.id}`);
    else item.run();
  }

  function onInputKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex(Math.min(active + 1, items.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex(Math.max(active - 1, 0));
    } else if (e.key === "Enter" && items[active]) {
      e.preventDefault();
      choose(items[active]);
    }
  }

  const firstCommandIndex = items.findIndex((i) => i.kind === "command");

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex h-8 w-full max-w-72 items-center gap-2 rounded-md border border-border bg-muted/50 px-2.5 text-[13px] text-muted-foreground shadow-soft transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        <Search className="size-3.5" />
        <span className="flex-1 truncate text-left">Search or jump to…</span>
        <kbd className="hidden rounded border border-border bg-background px-1.5 font-mono text-[10px] leading-4 sm:inline">
          Ctrl K
        </kbd>
      </button>

      <Dialog open={open} onOpenChange={(o) => (o ? setOpen(true) : close())}>
        <DialogContent
          showCloseButton={false}
          className="top-[18%] translate-y-0 gap-0 overflow-hidden p-0 shadow-raised sm:max-w-xl"
        >
          <DialogTitle className="sr-only">Search notes and commands</DialogTitle>
          <div className="flex items-center gap-2 border-b px-3">
            <Search className="size-4 shrink-0 text-muted-foreground" />
            <input
              autoFocus
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setActiveIndex(0);
              }}
              onKeyDown={onInputKeyDown}
              placeholder="Search notes, or type a command…"
              aria-label="Search notes and commands"
              aria-controls="palette-list"
              aria-activedescendant={items[active] ? `palette-${items[active].id}` : undefined}
              role="combobox"
              aria-expanded="true"
              className="h-12 flex-1 bg-transparent text-sm outline-none"
            />
            {isFetching && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
          </div>

          <div id="palette-list" className="max-h-96 overflow-y-auto p-1.5" role="listbox">
            {hasQuery && !isFetching && items.length === 0 && (
              <p className="px-3 py-6 text-center text-sm text-muted-foreground">
                No notes or commands match &ldquo;{debounced.trim()}&rdquo;.
              </p>
            )}
            {/* The backend only falls back to similar titles when no word
                matched, so either every result is fuzzy or none is. */}
            {hasQuery && results[0]?.fuzzy && (
              <p className="px-3 pt-1 pb-1.5 text-xs text-muted-foreground">
                No exact matches. Notes with similar titles:
              </p>
            )}

            {items.map((item, idx) => {
              const selected = idx === active;
              const common = {
                id: `palette-${item.id}`,
                role: "option" as const,
                "aria-selected": selected,
                onMouseEnter: () => setActiveIndex(idx),
                onClick: () => choose(item),
              };
              const heading =
                idx === firstCommandIndex ? (
                  <p className="px-3 pt-2 pb-1 text-[11px] font-medium tracking-wider text-muted-foreground uppercase">
                    {hasQuery ? "Commands" : "Jump to or do"}
                  </p>
                ) : null;

              if (item.kind === "note") {
                const r = item.note;
                return (
                  <button
                    key={item.id}
                    type="button"
                    {...common}
                    className={`flex w-full gap-2.5 rounded-md px-3 py-2 text-left ${selected ? "bg-muted" : ""}`}
                  >
                    <FileText className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                    <span className="flex min-w-0 flex-col gap-0.5">
                      <span className="flex items-center gap-1.5 text-sm font-medium">
                        <Highlighted text={r.title_highlight} />
                        {!r.is_own && (
                          <span className="flex items-center gap-1 text-xs font-normal text-muted-foreground">
                            <Globe className="size-3" />
                            public
                          </span>
                        )}
                      </span>
                      {r.snippet && (
                        <span className="line-clamp-2 text-xs text-muted-foreground">
                          <Highlighted text={r.snippet} />
                        </span>
                      )}
                    </span>
                  </button>
                );
              }

              const Icon = item.icon;
              return (
                <Fragment key={item.id}>
                  {heading}
                  <button
                    type="button"
                    {...common}
                    className={`flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-left text-sm ${selected ? "bg-muted" : ""}`}
                  >
                    <Icon className="size-4 shrink-0 text-muted-foreground" />
                    <span className="flex-1">{item.label}</span>
                    {selected && <CornerDownLeft className="size-3.5 text-muted-foreground" />}
                  </button>
                </Fragment>
              );
            })}
          </div>

          <div className="flex items-center gap-3 border-t px-3 py-2 text-[11px] text-muted-foreground">
            <span>
              <kbd className="font-mono">↑↓</kbd> move
            </span>
            <span>
              <kbd className="font-mono">Enter</kbd> open
            </span>
            <span>
              <kbd className="font-mono">Esc</kbd> close
            </span>
            <span className="ml-auto">Quotes for an exact phrase, - to exclude a word</span>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
