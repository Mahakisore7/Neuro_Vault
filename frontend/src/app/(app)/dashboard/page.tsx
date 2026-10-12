"use client";

import {
  ArrowRight,
  ArrowUpRight,
  CheckCircle2,
  CircleDashed,
  Clock,
  FileText,
  GraduationCap,
  Link2,
  type LucideIcon,
  Network,
  PenLine,
  Trash2,
  Type,
} from "lucide-react";
import Link from "next/link";

import { ErrorState } from "@/components/error-state";
import { CountUp } from "@/components/motion";
import { NewNoteButton } from "@/components/notes/new-note-button";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useDashboard } from "@/hooks/use-dashboard";
import { useNote } from "@/hooks/use-notes";
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
    <>
      <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <Icon className={`size-3.5 ${highlight ? "text-primary" : ""}`} />
        {label}
        {href && (
          <ArrowUpRight className="ml-auto size-3.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" />
        )}
      </div>
      <p
        className={`mt-2 text-[1.75rem] leading-none font-semibold tracking-[-0.03em] tabular-nums ${
          highlight ? "text-primary" : ""
        }`}
      >
        <CountUp value={value} />
      </p>
      <p className="mt-1.5 min-h-4 text-xs text-muted-foreground">{detail}</p>
    </>
  );
  const cls = "group block px-5 py-4 transition-colors";
  return href ? (
    <Link
      href={href}
      className={`${cls} hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none`}
    >
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

function Panel({
  icon: Icon,
  title,
  description,
  action,
  children,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: { href: string; label: string };
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col overflow-hidden rounded-xl border bg-card shadow-soft">
      <header className="flex items-start gap-3 px-4 pt-4 pb-3">
        <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
          <Icon className="size-3.5" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold">{title}</h2>
          <p className="text-xs text-muted-foreground">{description}</p>
        </div>
        {action && (
          <Link
            href={action.href}
            className="shrink-0 rounded text-xs font-medium text-muted-foreground hover:text-foreground"
          >
            {action.label}
          </Link>
        )}
      </header>
      <div className="flex-1">{children}</div>
    </section>
  );
}

function NoteRows({
  notes,
  empty,
  meta,
  bar,
}: {
  notes: DashboardNote[];
  empty: { icon: LucideIcon; text: string };
  meta: (n: DashboardNote) => string;
  /** 0..1: a thin proportion bar under the title, e.g. share of the top note's links. */
  bar?: (n: DashboardNote) => number;
}) {
  if (notes.length === 0) {
    return (
      <div className="flex h-full min-h-40 flex-col items-center justify-center gap-2 px-4 pb-6 text-center text-sm text-muted-foreground">
        <empty.icon className="size-5 opacity-60" />
        {empty.text}
      </div>
    );
  }
  return (
    <ul className="px-1.5 pb-1.5">
      {notes.map((n) => (
        <li key={n.id}>
          <Link
            href={`/notes/${n.id}`}
            className="flex items-center gap-3 rounded-md px-2.5 py-2 transition-colors hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:outline-none"
          >
            <FileText className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-medium">{n.title}</span>
              {bar && (
                <span aria-hidden className="mt-1 block h-1 overflow-hidden rounded-full bg-muted">
                  <span
                    className="block h-full rounded-full bg-primary/60"
                    style={{ width: `${Math.max(bar(n) * 100, 6)}%` }}
                  />
                </span>
              )}
            </span>
            <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{meta(n)}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** Plain text of a note's HTML, for a two-line preview. */
function excerpt(html: string | null | undefined, max = 180) {
  const text = (html ?? "")
    .replace(/<\/(p|li|h[1-6]|blockquote)>/g, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > max ? `${text.slice(0, max).trimEnd()}…` : text;
}

/** The note you edited last, with a preview: the most likely next click. */
function ContinueCard({ note }: { note: DashboardNote }) {
  const { data: full } = useNote(note.id);
  const preview = excerpt(full?.content);
  return (
    <Link
      href={`/notes/${note.id}`}
      className="card-interactive group relative block overflow-hidden rounded-xl border bg-card p-5 shadow-soft"
    >
      <div
        aria-hidden
        className="pointer-events-none absolute -top-16 -right-16 size-48 rounded-full bg-primary/10 blur-3xl transition-opacity duration-500 group-hover:opacity-100 sm:opacity-70"
      />
      <div className="relative flex items-start gap-4">
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <PenLine className="size-3.5 text-primary" />
            Continue writing · {timeAgo(note.updated_at)}
          </p>
          <h2 className="mt-1.5 truncate text-lg font-semibold tracking-[-0.015em]">
            {note.title}
          </h2>
          <p className="mt-1 line-clamp-2 min-h-10 text-sm leading-5 text-muted-foreground">
            {preview || "No text yet."}
          </p>
        </div>
        <span className="mt-1 flex size-8 shrink-0 items-center justify-center rounded-full border bg-background text-muted-foreground transition-all duration-300 group-hover:translate-x-0.5 group-hover:border-primary/40 group-hover:text-primary">
          <ArrowRight className="size-4" />
        </span>
      </div>
    </Link>
  );
}

function greeting(hour: number) {
  if (hour >= 5 && hour < 12) return "Good morning";
  if (hour >= 12 && hour < 18) return "Good afternoon";
  return "Good evening";
}

const longDate = new Intl.DateTimeFormat(undefined, {
  weekday: "long",
  day: "numeric",
  month: "long",
});

export default function DashboardPage() {
  const { data: me } = useMe();
  const { data, isLoading, isError, refetch } = useDashboard();
  usePageTitle("Home");
  const now = new Date();
  const firstName = me?.display_name.trim().split(/\s+/)[0];
  const maxDegree = Math.max(1, ...(data?.most_connected.map((n) => n.degree ?? 0) ?? []));
  const due = data?.totals.cards_due ?? 0;

  return (
    <div className="mx-auto max-w-6xl px-4 pt-8 pb-16 sm:px-8">
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-medium text-muted-foreground">{longDate.format(now)}</p>
          <h1 className="mt-1 text-[1.625rem] leading-9 font-semibold tracking-[-0.025em]">
            {greeting(now.getHours())}
            {firstName ? `, ${firstName}` : ""}
          </h1>
          <p className="text-sm text-muted-foreground">
            {data?.totals.last_edited_at
              ? `You last edited a note ${timeAgo(data.totals.last_edited_at)}.`
              : "Your knowledge base at a glance."}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {due > 0 && (
            <Button variant="outline" asChild>
              <Link href="/review">
                <GraduationCap />
                Review {due} {due === 1 ? "card" : "cards"}
              </Link>
            </Button>
          )}
          <NewNoteButton />
        </div>
      </div>

      {isError && <ErrorState onRetry={() => refetch()} />}

      {isLoading && (
        <div className="space-y-6">
          <Skeleton className="h-[104px] rounded-xl" />
          <div className="grid gap-4 lg:grid-cols-3">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-72 rounded-xl" />
            ))}
          </div>
        </div>
      )}

      {data && data.totals.total_notes === 0 && data.totals.archived_notes === 0 && (
        <div className="flex flex-col items-center rounded-xl border border-dashed bg-card/50 px-6 py-20 text-center">
          <span className="mb-4 flex size-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Network className="size-5" />
          </span>
          <p className="text-base font-semibold">Start your knowledge graph</p>
          <p className="mt-1 mb-6 max-w-sm text-sm text-muted-foreground">
            Write a note, then link it to others by typing{" "}
            <code className="rounded bg-muted px-1 font-mono text-xs">[[</code>. This page fills in
            as your graph grows.
          </p>
          <div className="flex flex-wrap justify-center gap-2">
            <NewNoteButton>Write your first note</NewNoteButton>
            <Button variant="outline" asChild>
              <Link href="/workspaces">Set up a workspace</Link>
            </Button>
          </div>
        </div>
      )}

      {data && (data.totals.total_notes > 0 || data.totals.archived_notes > 0) && (
        <div className="space-y-6">
          {data.recent[0] && <ContinueCard note={data.recent[0]} />}

          {/* One strip with dividers rather than four floating boxes: the
              numbers read as a single summary line. */}
          <div className="grid grid-cols-2 overflow-hidden rounded-xl border bg-card shadow-soft md:grid-cols-4 [&>*]:border-border max-md:[&>*:nth-child(-n+2)]:border-b max-md:[&>*:nth-child(odd)]:border-r md:[&>*:not(:last-child)]:border-r">
            <Stat
              icon={FileText}
              label="Notes"
              value={data.totals.total_notes}
              detail={`${data.totals.public_notes} public · ${data.totals.pinned_notes} pinned`}
            />
            <Stat
              icon={Type}
              label="Words"
              value={data.totals.total_words}
              detail={`about ${Math.max(1, Math.round(data.totals.total_words / 230))} min of reading`}
            />
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

          <div className="stagger grid gap-4 lg:grid-cols-3">
            <Panel
              icon={Network}
              title="Most connected"
              description="Hub notes, by links in either direction."
            >
              <NoteRows
                notes={data.most_connected}
                empty={{ icon: Link2, text: "No links yet." }}
                meta={(n) => `${n.degree} ${n.degree === 1 ? "link" : "links"}`}
                bar={(n) => (n.degree ?? 0) / maxDegree}
              />
            </Panel>
            <Panel
              icon={CircleDashed}
              title="Not linked to anything"
              description="Connect these to bring them into your graph."
            >
              <NoteRows
                notes={data.orphans}
                empty={{ icon: CheckCircle2, text: "Every note is linked." }}
                meta={(n) => `${fmt.format(n.word_count)} words`}
              />
            </Panel>
            <Panel
              icon={Clock}
              title="Recently edited"
              description="Pick up where you left off."
              action={{ href: "/activity", label: "All activity" }}
            >
              <NoteRows
                notes={data.recent}
                empty={{ icon: FileText, text: "No notes yet." }}
                meta={(n) => timeAgo(n.updated_at)}
              />
            </Panel>
          </div>

          {data.totals.archived_notes > 0 && (
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Trash2 className="size-3.5" />
              {data.totals.archived_notes} {data.totals.archived_notes === 1 ? "note" : "notes"} in{" "}
              <Link href="/trash" className="underline underline-offset-2 hover:text-foreground">
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
