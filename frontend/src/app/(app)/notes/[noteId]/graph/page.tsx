"use client";

import { ArrowLeft } from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";

import { ErrorState } from "@/components/error-state";
import { NoteGraph } from "@/components/notes/note-graph";
import { Skeleton } from "@/components/ui/skeleton";
import { useNoteGraph, useRelationshipTypes } from "@/hooks/use-links";
import { useNote } from "@/hooks/use-notes";

const MAX_DEPTH_CEILING = 6; // mirrors backend settings.graph_max_depth

export default function NoteGraphPage() {
  const { noteId } = useParams<{ noteId: string }>();
  const router = useRouter();
  const [maxDepth, setMaxDepth] = useState(3);

  const { data: note, isLoading: noteLoading } = useNote(noteId);
  const {
    data: graph,
    isLoading: graphLoading,
    isError,
    refetch,
  } = useNoteGraph(noteId, maxDepth);
  const { data: relationshipTypes } = useRelationshipTypes();

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
            Notes reachable from this one, traced by the recursive query — ring 0 is this note,
            each ring out is one more hop.
          </p>
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
          <NoteGraph graph={graph} rootId={noteId} relationshipTypes={relationshipTypes ?? []} />
        )}
      </div>
    </div>
  );
}
