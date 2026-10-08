"use client";

import { ArrowLeft, ArrowRight, Route, X } from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";

import { ErrorState } from "@/components/error-state";
import { NoteGraph } from "@/components/notes/note-graph";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import {
  useNoteGraph,
  useNoteStats,
  useRelationshipTypes,
  useShortestPath,
} from "@/hooks/use-links";
import { useAllNotes, useNote } from "@/hooks/use-notes";
import { usePageTitle } from "@/hooks/use-page-title";

const MAX_DEPTH_CEILING = 6; // mirrors backend settings.graph_max_depth

export default function NoteGraphPage() {
  const { noteId } = useParams<{ noteId: string }>();
  const router = useRouter();
  const [maxDepth, setMaxDepth] = useState(3);

  const { data: note, isLoading: noteLoading } = useNote(noteId);
  usePageTitle(note ? `${note.title} — graph` : undefined);
  const {
    data: graph,
    isLoading: graphLoading,
    isError,
    refetch,
  } = useNoteGraph(noteId, maxDepth);
  const { data: relationshipTypes } = useRelationshipTypes();
  const { data: stats } = useNoteStats(noteId);

  const [pickerOpen, setPickerOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [targetId, setTargetId] = useState<string | null>(null);
  const { data: allNotes } = useAllNotes({ enabled: pickerOpen });
  const { data: path, isFetching: pathLoading } = useShortestPath(noteId, targetId);
  const candidates = (allNotes ?? [])
    .filter((n) => n.id !== noteId)
    .filter((n) => n.title.toLowerCase().includes(query.toLowerCase()));
  const hops = path && path.length > 0 ? path.length - 1 : 0;

  const usedTypeIds = new Set((graph?.edges ?? []).map((e) => e.rel_type_id));
  const legend = (relationshipTypes ?? []).filter((t) => usedTypeIds.has(t.id));

  return (
    <div className="mx-auto flex h-[calc(100vh-4rem)] max-w-6xl flex-col px-6 py-6">
      <button
        onClick={() => router.push(`/notes/${noteId}`)}
        className="mb-3 inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" />
        Back to note
      </button>

      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {noteLoading ? <Skeleton className="h-8 w-48" /> : `${note?.title} — graph`}
          </h1>
          <p className="text-sm text-muted-foreground">
            Notes reachable from this one, found by a breadth-first search in the database — ring
            0 is this note, each ring out is one more hop.
          </p>
          {stats && (
            <p className="mt-1 text-xs text-muted-foreground tabular-nums">
              {stats.outgoing_count} outgoing · {stats.incoming_count} incoming ·{" "}
              {stats.version_count} {stats.version_count === 1 ? "version" : "versions"}
              {stats.max_depth > 0 &&
                ` · farthest note ${stats.max_depth} ${stats.max_depth === 1 ? "hop" : "hops"} away`}
            </p>
          )}
        </div>

        <div className="flex items-center gap-1.5">
          <span className="text-xs text-muted-foreground">Depth</span>
          {Array.from({ length: MAX_DEPTH_CEILING }, (_, i) => i + 1).map((d) => (
            <button
              key={d}
              onClick={() => setMaxDepth(d)}
              className={`flex size-6 items-center justify-center rounded-md text-xs ${
                maxDepth === d
                  ? "bg-primary text-primary-foreground"
                  : "border border-border text-muted-foreground hover:bg-muted"
              }`}
            >
              {d}
            </button>
          ))}
        </div>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Popover
          open={pickerOpen}
          onOpenChange={(o) => {
            setPickerOpen(o);
            if (!o) setQuery("");
          }}
        >
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm">
              <Route />
              Find path to…
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-72 p-2">
            <Input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search your notes…"
              className="mb-1.5 h-8 text-sm"
            />
            <div className="max-h-60 overflow-y-auto">
              {candidates.length === 0 ? (
                <p className="px-1 py-1.5 text-xs text-muted-foreground">
                  {allNotes ? "No matching notes." : "Loading…"}
                </p>
              ) : (
                candidates.map((n) => (
                  <button
                    key={n.id}
                    type="button"
                    onClick={() => {
                      setTargetId(n.id);
                      setPickerOpen(false);
                      setQuery("");
                    }}
                    className="flex w-full rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted"
                  >
                    {n.title}
                  </button>
                ))
              )}
            </div>
          </PopoverContent>
        </Popover>

        {targetId && (
          <div className="flex min-w-0 flex-wrap items-center gap-1 text-sm">
            {pathLoading ? (
              <span className="text-muted-foreground">Finding the shortest route…</span>
            ) : path && path.length > 0 ? (
              <>
                {path.map((step, i) => (
                  <span key={step.note_id} className="flex items-center gap-1">
                    {i > 0 && <ArrowRight className="size-3 text-muted-foreground" />}
                    <span className="rounded-md bg-primary/10 px-1.5 py-0.5 text-primary">
                      {step.title}
                    </span>
                  </span>
                ))}
                <span className="ml-1 text-xs text-muted-foreground">
                  {hops} {hops === 1 ? "hop" : "hops"}
                  {hops > maxDepth && " — raise the depth to see it all"}
                </span>
              </>
            ) : (
              <span className="text-muted-foreground">No route between these notes.</span>
            )}
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Clear path"
              onClick={() => setTargetId(null)}
            >
              <X />
            </Button>
          </div>
        )}
      </div>

      {legend.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-3">
          {legend.map((t) => (
            <span key={t.id} className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className="size-2 rounded-full" style={{ backgroundColor: t.color }} />
              {t.name}
            </span>
          ))}
        </div>
      )}

      <div className="min-h-0 flex-1 rounded-xl border border-border bg-card">
        {isError ? (
          <ErrorState onRetry={() => refetch()} />
        ) : graphLoading || !graph ? (
          <div className="flex h-full items-center justify-center">
            <Skeleton className="size-64 rounded-full" />
          </div>
        ) : graph.nodes.length <= 1 ? (
          <div className="flex h-full flex-col items-center justify-center gap-1 text-center">
            <p className="text-sm font-medium">No connections yet</p>
            <p className="text-xs text-muted-foreground">
              Use &ldquo;Link&rdquo; on the note to connect it to something.
            </p>
          </div>
        ) : (
          <NoteGraph
            graph={graph}
            rootId={noteId}
            relationshipTypes={relationshipTypes ?? []}
            highlightPath={targetId ? (path ?? []).map((p) => p.note_id) : []}
          />
        )}
      </div>
    </div>
  );
}
