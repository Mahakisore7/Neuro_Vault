import { Check, FileText, RotateCcw, Search } from "lucide-react";

// Small, static pictures of real screens for the landing page's feature
// tiles. Built from the app's own tokens, so they match the product and
// follow the theme. Decorative: the tile's text carries the meaning.

const frame = "rounded-lg border bg-background p-3 text-left shadow-soft";

const TYPES = [
  { name: "prerequisite_for", color: "#F59E0B", note: "Functional Dependencies" },
  { name: "supports", color: "#16A34A", note: "Query Optimization" },
  { name: "see_also", color: "#0D9488", note: "B+ Trees" },
];

export function LinkTypesPreview() {
  return (
    <div aria-hidden className={`${frame} space-y-2`}>
      {TYPES.map((t) => (
        <div
          key={t.name}
          className="flex items-center gap-2 rounded-full border bg-card px-2.5 py-1 text-xs"
        >
          <span className="size-2 rounded-full" style={{ background: t.color }} />
          <span className="text-muted-foreground">{t.name}</span>
          <span className="truncate font-medium">{t.note}</span>
        </div>
      ))}
    </div>
  );
}

export function WikiLinkPreview() {
  return (
    <div aria-hidden className={`${frame} space-y-2 text-[13px] leading-6`}>
      <p>
        Normalization builds on <span className="wiki-link">[[Functional Dependencies]]</span>
        <span className="ml-0.5 inline-block h-4 w-px translate-y-0.5 animate-pulse bg-foreground" />
      </p>
      <div className="flex items-center gap-1.5 rounded-md border bg-card px-2 py-1 text-xs text-muted-foreground">
        <Check className="size-3 text-success" />
        Linked in your graph when the note saves
      </div>
    </div>
  );
}

export function SearchPreview() {
  const rows = [
    { t: "Normalization: 1NF to BCNF", s: "…the normal forms: 1NF, 2NF, 3NF, BCNF…" },
    { t: "Functional Dependencies", s: "…the first step of any normal form check…" },
  ];
  return (
    <div aria-hidden className={`${frame} space-y-2`}>
      <div className="flex items-center gap-2 border-b pb-2 text-sm">
        <Search className="size-3.5 text-muted-foreground" />
        <span>normal form</span>
        <kbd className="ml-auto rounded border bg-muted px-1.5 font-mono text-[10px] text-muted-foreground">
          Ctrl K
        </kbd>
      </div>
      {rows.map((r, i) => (
        <div key={r.t} className={`rounded-md px-2 py-1.5 ${i === 0 ? "bg-muted" : ""}`}>
          <p className="flex items-center gap-1.5 text-xs font-medium">
            <FileText className="size-3 text-muted-foreground" />
            {r.t}
          </p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            {r.s.split("normal").map((part, j, a) => (
              <span key={j}>
                {part}
                {j < a.length - 1 && (
                  <mark className="rounded-sm bg-primary/15 px-0.5 text-foreground">normal</mark>
                )}
              </span>
            ))}
          </p>
        </div>
      ))}
    </div>
  );
}

export function VersionsPreview() {
  const v = [
    { n: "v7", t: "just now", now: true },
    { n: "v6", t: "12 min ago" },
    { n: "v5", t: "yesterday" },
  ];
  return (
    <div aria-hidden className={`${frame} space-y-1`}>
      {v.map((x) => (
        <div
          key={x.n}
          className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-xs ${
            x.now ? "bg-muted font-medium" : ""
          }`}
        >
          <span className="rounded bg-card px-1.5 font-mono text-[10px] ring-1 ring-border">
            {x.n}
          </span>
          <span className="text-muted-foreground">{x.t}</span>
          {!x.now && (
            <span className="ml-auto flex items-center gap-1 text-primary">
              <RotateCcw className="size-3" />
              Restore
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

export function FlashcardPreview() {
  return (
    <div aria-hidden className={`${frame} space-y-2.5`}>
      <p className="text-[13px] font-medium">
        Which normal form requires every determinant to be a candidate key?
      </p>
      <p className="text-[13px] text-muted-foreground">BCNF</p>
      <div className="grid grid-cols-4 gap-1.5 text-center text-[11px] font-medium">
        <span className="rounded-md bg-destructive/10 py-1.5 text-destructive">Again</span>
        <span className="rounded-md border py-1.5">Hard</span>
        <span className="rounded-md border py-1.5">Good</span>
        <span className="rounded-md bg-primary py-1.5 text-primary-foreground">Easy</span>
      </div>
    </div>
  );
}

export function SqlPreview() {
  return (
    <pre
      aria-hidden
      className={`${frame} overflow-hidden font-mono text-[11px] leading-5 whitespace-pre-wrap`}
    >
      <span className="text-muted-foreground">-- the route between two ideas</span>
      {"\n"}
      <span className="text-primary">SELECT</span> * <span className="text-primary">FROM</span>{" "}
      fn_shortest_path(
      {"\n  "}
      <span className="text-muted-foreground">:from_note, :to_note, :me</span>
      {"\n"});
    </pre>
  );
}
