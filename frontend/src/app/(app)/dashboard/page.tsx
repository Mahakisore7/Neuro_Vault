"use client";

import { FileText, GraduationCap, Link2, type LucideIcon, Trash2, Type } from "lucide-react";
import Link from "next/link";

import { ErrorState } from "@/components/error-state";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useDashboard } from "@/hooks/use-dashboard";
import { useMe } from "@/hooks/use-user";
import { usePageTitle } from "@/hooks/use-page-title";
import { timeAgo } from "@/lib/time";
import type { DashboardNote } from "@/types/api";

const fmt = new Intl.NumberFormat();

function Stat({
  icon: Icon,
  label,
  value,
  detail,
  href,
  highlight = false,
}: {
  icon: LucideIcon;
  label: string;
  value: number;
  detail?: string;
  href?: string;
  highlight?: boolean;
}) {
  const body = (
    <div
      className={`h-full rounded-xl border px-4 py-3 transition-colors ${
        highlight ? "border-primary/40 bg-primary/5" : "bg-card"
      } ${href ? "hover:bg-muted/50" : ""}`}
    >
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Icon className="size-3.5" />
        {label}
      </div>
      <p className="mt-1 text-2xl font-semibold tracking-tight tabular-nums">{fmt.format(value)}</p>
      {detail && <p className="text-xs text-muted-foreground">{detail}</p>}
    </div>
  );
  return href ? (
    <Link href={href} className="block rounded-xl focus-visible:ring-2 focus-visible:ring-ring">
      {body}
    </Link>
  ) : (
    body
  );
}

function NoteList({
  title,
  description,
  notes,
  empty,
  meta,
}: {
  title: string;
  description: string;
  notes: DashboardNote[];
  empty: string;
  meta: (n: DashboardNote) => string;
}) {
  return (
    <section className="rounded-xl border bg-card">
      <div className="border-b px-4 py-3">
        <h2 className="text-sm font-medium">{title}</h2>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      {notes.length === 0 ? (
        <p className="px-4 py-6 text-center text-sm text-muted-foreground">{empty}</p>
      ) : (
        <ul className="divide-y">
          {notes.map((n) => (
            <li key={n.id}>
              <Link
                href={`/notes/${n.id}`}
                className="flex items-baseline justify-between gap-3 px-4 py-2.5 hover:bg-muted/50"
              >
                <span className="min-w-0 truncate text-sm">{n.title}</span>
                <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                  {meta(n)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export default function DashboardPage() {
  const { data: me } = useMe();
  const { data, isLoading, isError, refetch } = useDashboard();
  usePageTitle("Home");

  return (
    <div className="mx-auto max-w-5xl px-6 py-10">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">
          {me ? `Welcome back, ${me.display_name}` : "Welcome back"}
        </h1>
        <p className="text-sm text-muted-foreground">
          {data?.totals.last_edited_at
            ? `You last edited a note ${timeAgo(data.totals.last_edited_at)}.`
            : "Your knowledge base at a glance."}
        </p>
      </div>

      {isError && <ErrorState onRetry={() => refetch()} />}

      {isLoading && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {[1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-24 rounded-xl" />
            ))}
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-56 rounded-xl" />
            ))}
          </div>
        </div>
      )}

      {data && data.totals.total_notes === 0 && data.totals.archived_notes === 0 && (
        <div className="flex flex-col items-center rounded-xl border border-dashed px-6 py-16 text-center">
          <FileText className="mb-3 size-8 text-muted-foreground" />
          <p className="font-medium">Nothing here yet</p>
          <p className="mb-4 max-w-sm text-sm text-muted-foreground">
            Create a workspace and a notebook, write a few notes, then link them together — this
            page fills in as your graph grows.
          </p>
          <Button asChild>
            <Link href="/workspaces">Go to workspaces</Link>
          </Button>
        </div>
      )}

      {data && (data.totals.total_notes > 0 || data.totals.archived_notes > 0) && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat
              icon={FileText}
              label="Notes"
              value={data.totals.total_notes}
              detail={`${data.totals.public_notes} public · ${data.totals.pinned_notes} pinned`}
            />
            <Stat icon={Type} label="Words" value={data.totals.total_words} />
            <Stat
              icon={Link2}
              label="Links you've made"
              value={data.totals.link_count}
              detail={`across ${data.totals.workspace_count} ${
                data.totals.workspace_count === 1 ? "workspace" : "workspaces"
              }`}
            />
            <Stat
              icon={GraduationCap}
              label="Cards due"
              value={data.totals.cards_due}
              detail={`of ${data.totals.total_cards} flashcards`}
              href="/review"
              highlight={data.totals.cards_due > 0}
            />
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <NoteList
              title="Most connected"
              description="Your hub notes, by links in either direction."
              notes={data.most_connected}
              empty="No links yet."
              meta={(n) => `${n.degree} ${n.degree === 1 ? "link" : "links"}`}
            />
            <NoteList
              title="Not linked to anything"
              description="Connect these to bring them into your graph."
              notes={data.orphans}
              empty="Every note is linked — nice."
              meta={(n) => `${fmt.format(n.word_count)} words`}
            />
            <NoteList
              title="Recently edited"
              description="Pick up where you left off."
              notes={data.recent}
              empty="No notes yet."
              meta={(n) => timeAgo(n.updated_at)}
            />
          </div>

          {data.totals.archived_notes > 0 && (
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Trash2 className="size-3.5" />
              {data.totals.archived_notes} {data.totals.archived_notes === 1 ? "note" : "notes"} in{" "}
              <Link href="/trash" className="underline underline-offset-2">
                Trash
              </Link>
              , not counted above.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
