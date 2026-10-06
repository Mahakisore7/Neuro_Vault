"use client";

import { Globe, Loader2, Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { Fragment, useEffect, useState } from "react";

import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { useNoteSearch } from "@/hooks/use-notes";

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

export function SearchDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);

  const debounced = useDebouncedValue(query, 200);
  const { data: results = [], isFetching } = useNoteSearch(debounced);
  const active = Math.min(activeIndex, Math.max(results.length - 1, 0));

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

  function go(id: string) {
    close();
    router.push(`/notes/${id}`);
  }

  function onInputKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex(Math.min(active + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex(Math.max(active - 1, 0));
    } else if (e.key === "Enter" && results[active]) {
      e.preventDefault();
      go(results[active].id);
    }
  }

  const hasQuery = debounced.trim().length > 0;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex h-8 w-64 items-center gap-2 rounded-md border border-border bg-background px-2.5 text-sm text-muted-foreground transition-colors hover:bg-muted"
      >
        <Search className="size-3.5" />
        <span className="flex-1 text-left">Search notes…</span>
        <kbd className="rounded border border-border px-1.5 font-mono text-[10px]">Ctrl K</kbd>
      </button>

      <Dialog open={open} onOpenChange={(o) => (o ? setOpen(true) : close())}>
        <DialogContent showCloseButton={false} className="top-[20%] translate-y-0 gap-0 p-0 sm:max-w-xl">
          <DialogTitle className="sr-only">Search notes</DialogTitle>
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
              placeholder="Search titles and content…"
              aria-label="Search notes"
              className="h-12 flex-1 bg-transparent text-sm outline-none"
            />
            {isFetching && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
          </div>

          <div className="max-h-96 overflow-y-auto p-1.5" role="listbox">
            {!hasQuery && (
              <p className="px-3 py-6 text-center text-sm text-muted-foreground">
                Type to search. Use quotes for an exact phrase, or a leading - to exclude a word.
              </p>
            )}
            {hasQuery && !isFetching && results.length === 0 && (
              <p className="px-3 py-6 text-center text-sm text-muted-foreground">
                No notes match &ldquo;{debounced.trim()}&rdquo;.
              </p>
            )}
            {/* The backend only falls back to similar titles when no word
                matched, so either every result is fuzzy or none is. */}
            {results[0]?.fuzzy && (
              <p className="px-3 pt-1 pb-1.5 text-xs text-muted-foreground">
                No exact matches — notes with similar titles:
              </p>
            )}
            {results.map((r, idx) => (
              <button
                key={r.id}
                type="button"
                role="option"
                aria-selected={idx === active}
                onMouseEnter={() => setActiveIndex(idx)}
                onClick={() => go(r.id)}
                className={`flex w-full flex-col gap-0.5 rounded-md px-3 py-2 text-left ${
                  idx === active ? "bg-muted" : ""
                }`}
              >
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
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
