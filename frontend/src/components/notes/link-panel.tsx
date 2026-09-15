"use client";

import { ArrowRight, Link2, Network, X } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useCreateLink, useDeleteLink, useNoteLinks, useRelationshipTypes } from "@/hooks/use-links";
import { useAllNotes } from "@/hooks/use-notes";

export function LinkPanel({ noteId }: { noteId: string }) {
  const { data: links } = useNoteLinks(noteId);
  const { data: relationshipTypes } = useRelationshipTypes();
  const { data: allNotes } = useAllNotes();
  const createLink = useCreateLink(noteId);
  const deleteLink = useDeleteLink(noteId);

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [targetId, setTargetId] = useState<string | null>(null);
  const [relTypeId, setRelTypeId] = useState<number | null>(null);

  const candidates = (allNotes ?? [])
    .filter((n) => n.id !== noteId)
    .filter((n) => n.title.toLowerCase().includes(query.toLowerCase()));

  const titleById = new Map((allNotes ?? []).map((n) => [n.id, n.title]));
  const relTypeById = new Map((relationshipTypes ?? []).map((t) => [t.id, t]));

  function resetForm() {
    setQuery("");
    setTargetId(null);
    setRelTypeId(null);
  }

  async function handleCreate() {
    if (!targetId || !relTypeId) return;
    try {
      await createLink.mutateAsync({ target_note_id: targetId, rel_type_id: relTypeId });
      setOpen(false);
      resetForm();
    } catch {
      toast.error("Couldn't create that link.");
    }
  }

  async function handleDelete(linkId: string) {
    try {
      await deleteLink.mutateAsync(linkId);
    } catch {
      toast.error("Couldn't remove that link.");
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {(links ?? []).map((link) => {
        const outgoing = link.source_note_id === noteId;
        const otherId = outgoing ? link.target_note_id : link.source_note_id;
        const relType = relTypeById.get(link.rel_type_id);
        return (
          <span
            key={link.id}
            className="flex items-center gap-1.5 rounded-full border border-border py-0.5 pr-1 pl-2.5 text-xs"
          >
            <span
              className="size-2 shrink-0 rounded-full"
              style={{ backgroundColor: relType?.color ?? "#888888" }}
            />
            <span className="text-muted-foreground">{relType?.name ?? "relates_to"}</span>
            {!outgoing && <span className="text-muted-foreground">from</span>}
            <Link href={`/notes/${otherId}`} className="font-medium hover:underline">
              {titleById.get(otherId) ?? "Untitled"}
            </Link>
            {/* Only an outgoing link can be deleted from here — DELETE
                /notes/{note_id}/links/{link_id} requires note_id to be the
                link's source (ADR-007: an edge originates from a note you
                own). An incoming link is deleted from the OTHER note's page. */}
            {outgoing && (
              <button
                type="button"
                onClick={() => handleDelete(link.id)}
                aria-label="Remove link"
                className="rounded-full p-0.5 hover:bg-black/10 dark:hover:bg-white/10"
              >
                <X className="size-3" />
              </button>
            )}
          </span>
        );
      })}

      <Popover
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) resetForm();
        }}
      >
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className="h-6 rounded-full px-2 text-xs">
            <Link2 className="size-3" />
            Link
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-72 p-2">
          <p className="mb-1.5 px-1 text-xs font-medium text-muted-foreground">Link to a note</p>
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search your notes…"
            className="mb-1.5 h-8 text-sm"
          />
          <div className="mb-2 max-h-40 overflow-y-auto">
            {candidates.length === 0 ? (
              <p className="px-1 py-1.5 text-xs text-muted-foreground">No matching notes.</p>
            ) : (
              candidates.map((n) => (
                <button
                  key={n.id}
                  type="button"
                  onClick={() => setTargetId(n.id)}
                  className={`flex w-full items-center rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted ${
                    targetId === n.id ? "bg-muted font-medium" : ""
                  }`}
                >
                  {n.title}
                </button>
              ))
            )}
          </div>

          <p className="mb-1 px-1 text-xs font-medium text-muted-foreground">Relationship</p>
          <div className="mb-3 flex flex-wrap gap-1 px-1">
            {(relationshipTypes ?? []).map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setRelTypeId(t.id)}
                className={`rounded-full border px-2 py-0.5 text-xs ${
                  relTypeId === t.id ? "border-transparent text-white" : "border-border"
                }`}
                style={relTypeId === t.id ? { backgroundColor: t.color } : undefined}
              >
                {t.name}
              </button>
            ))}
          </div>

          <Button
            size="sm"
            className="w-full"
            disabled={!targetId || !relTypeId || createLink.isPending}
            onClick={handleCreate}
          >
            <ArrowRight className="size-3.5" />
            Add link
          </Button>
        </PopoverContent>
      </Popover>

      <Link href={`/notes/${noteId}/graph`}>
        <Button variant="ghost" size="sm" className="h-6 rounded-full px-2 text-xs">
          <Network className="size-3" />
          View graph
        </Button>
      </Link>
    </div>
  );
}
