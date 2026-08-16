"use client";

import { Plus, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useAttachTag, useDetachTag, useNoteTags, useTags } from "@/hooks/use-tags";

export function TagPicker({ noteId }: { noteId: string }) {
  const [open, setOpen] = useState(false);
  const { data: noteTags } = useNoteTags(noteId);
  const { data: allTags } = useTags();
  const attach = useAttachTag(noteId);
  const detach = useDetachTag(noteId);

  const attachedIds = new Set((noteTags ?? []).map((t) => t.id));
  const available = (allTags ?? []).filter((t) => !attachedIds.has(t.id));

  async function handleAttach(tagId: number) {
    setOpen(false);
    try {
      await attach.mutateAsync(tagId);
    } catch {
      toast.error("Couldn't add that tag.");
    }
  }

  async function handleDetach(tagId: number) {
    try {
      await detach.mutateAsync(tagId);
    } catch {
      toast.error("Couldn't remove that tag.");
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {(noteTags ?? []).map((tag) => (
        <span
          key={tag.id}
          className="flex items-center gap-1 rounded-full py-0.5 pr-1 pl-2.5 text-xs font-medium"
          style={{ backgroundColor: `${tag.color}1A`, color: tag.color }}
        >
          {tag.name}
          <button
            type="button"
            onClick={() => handleDetach(tag.id)}
            aria-label={`Remove ${tag.name}`}
            className="rounded-full p-0.5 hover:bg-black/10 dark:hover:bg-white/10"
          >
            <X className="size-3" />
          </button>
        </span>
      ))}

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className="h-6 rounded-full px-2 text-xs">
            <Plus className="size-3" />
            Tag
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-56 p-1.5">
          {available.length === 0 ? (
            <p className="px-2 py-1.5 text-xs text-muted-foreground">
              {allTags?.length
                ? "All tags are already on this note."
                : "No tags yet — create one from the Tags page."}
            </p>
          ) : (
            <div className="flex flex-col">
              {available.map((tag) => (
                <button
                  key={tag.id}
                  type="button"
                  onClick={() => handleAttach(tag.id)}
                  className="flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted"
                >
                  <span
                    className="size-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: tag.color }}
                  />
                  {tag.name}
                </button>
              ))}
            </div>
          )}
        </PopoverContent>
      </Popover>
    </div>
  );
}
