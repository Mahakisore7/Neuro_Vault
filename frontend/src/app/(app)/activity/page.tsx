"use client";

import {
  ArchiveRestore,
  FilePlus2,
  FolderInput,
  Globe,
  History,
  Link2,
  Lock,
  type LucideIcon,
  Pencil,
  Trash2,
  Unlink,
  XCircle,
} from "lucide-react";
import Link from "next/link";

import { ErrorState } from "@/components/error-state";
import { Skeleton } from "@/components/ui/skeleton";
import { useActivityFeed } from "@/hooks/use-notifications";
import { usePageTitle } from "@/hooks/use-page-title";
import { timeAgo } from "@/lib/time";
import type { ActivityEntry } from "@/types/api";

const EVENTS: Record<string, { icon: LucideIcon; verb: string }> = {
  created: { icon: FilePlus2, verb: "Created" },
  edited: { icon: Pencil, verb: "Edited" },
  moved: { icon: FolderInput, verb: "Moved" },
  published: { icon: Globe, verb: "Made public" },
  unpublished: { icon: Lock, verb: "Made private" },
  trashed: { icon: Trash2, verb: "Moved to Trash" },
  restored: { icon: ArchiveRestore, verb: "Restored" },
  deleted: { icon: XCircle, verb: "Deleted forever" },
  linked: { icon: Link2, verb: "Linked" },
  unlinked: { icon: Unlink, verb: "Unlinked" },
};

function NoteRef({ id, title, live }: { id?: string | null; title?: string; live: boolean }) {
  const label = title || "Untitled";
  // A purged note has no page any more; its title survives only in the log.
  if (!id || !live) return <span className="font-medium">{label}</span>;
  return (
    <Link href={`/notes/${id}`} className="font-medium hover:underline">
      {label}
    </Link>
  );
}

function Description({ entry }: { entry: ActivityEntry }) {
  const m = entry.metadata;
  const verb = EVENTS[m.event]?.verb ?? m.event;

  if (entry.entity_type === "link") {
    return (
      <>
        {verb} <NoteRef id={m.source_note_id} title={m.source_title} live /> →{" "}
        <NoteRef id={m.target_note_id} title={m.target_title} live />
        {m.relationship && (
          <span className="text-muted-foreground"> ({m.relationship.replaceAll("_", " ")})</span>
        )}
      </>
    );
  }

  return (
    <>
      {verb} <NoteRef id={entry.entity_id} title={m.title} live={m.event !== "deleted"} />
      {entry.count > 1 && <span className="text-muted-foreground"> · {entry.count} saves</span>}
    </>
  );
}

function dayLabel(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return d.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
}

export default function ActivityPage() {
  const { data: feed, isLoading, isError, refetch } = useActivityFeed();
  usePageTitle("Activity");

  // Group consecutive entries by calendar day; the feed is already newest-first.
  const days: { label: string; entries: ActivityEntry[] }[] = [];
  for (const entry of feed ?? []) {
    const label = dayLabel(entry.created_at);
    const last = days.at(-1);
    if (last?.label === label) last.entries.push(entry);
    else days.push({ label, entries: [entry] });
  }

  return (
    <div className="mx-auto max-w-3xl px-6 py-10">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">Activity</h1>
        <p className="text-sm text-muted-foreground">
          Everything that&rsquo;s happened to your notes and links, recorded automatically by the
          database.
        </p>
      </div>

      {isError && <ErrorState onRetry={() => refetch()} />}

      {isLoading && (
        <div className="space-y-3">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-10 rounded-lg" />
          ))}
        </div>
      )}

      {feed && feed.length === 0 && (
        <div className="flex flex-col items-center rounded-xl border border-dashed py-16 text-center">
          <History className="mb-3 size-8 text-muted-foreground" />
          <p className="font-medium">No activity yet</p>
          <p className="text-sm text-muted-foreground">Create or edit a note and it shows up here.</p>
        </div>
      )}

      <div className="space-y-8">
        {days.map((day) => (
          <section key={day.label}>
            <h2 className="mb-3 text-xs font-medium tracking-wide text-muted-foreground uppercase">
              {day.label}
            </h2>
            <ol className="space-y-1">
              {day.entries.map((entry) => {
                const Icon = EVENTS[entry.metadata.event]?.icon ?? History;
                return (
                  <li
                    key={entry.id}
                    className="flex items-start gap-3 rounded-md px-2 py-2 hover:bg-muted/50"
                  >
                    <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-muted">
                      <Icon className="size-3.5 text-muted-foreground" />
                    </span>
                    <p className="min-w-0 flex-1 text-sm">
                      <Description entry={entry} />
                    </p>
                    <time
                      dateTime={entry.created_at}
                      title={new Date(entry.created_at).toLocaleString()}
                      className="shrink-0 text-xs text-muted-foreground tabular-nums"
                    >
                      {timeAgo(entry.created_at)}
                    </time>
                  </li>
                );
              })}
            </ol>
          </section>
        ))}
      </div>
    </div>
  );
}
