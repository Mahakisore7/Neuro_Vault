"use client";

import { Loader2, SquarePen } from "lucide-react";
import { useRouter } from "next/navigation";
import type { ComponentProps } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { useCreateNote } from "@/hooks/use-notes";

/**
 * One click to a blank page. The note starts unfiled - the quickest capture
 * is a blank page, not a "which notebook?" question first (the same
 * behaviour as "New note" in the command palette).
 */
export function NewNoteButton({
  onCreated,
  children = "New note",
  ...props
}: Omit<ComponentProps<typeof Button>, "onClick"> & { onCreated?: () => void }) {
  const router = useRouter();
  const createNote = useCreateNote();

  async function create() {
    try {
      const note = await createNote.mutateAsync({ title: "Untitled" });
      onCreated?.();
      router.push(`/notes/${note.id}`);
    } catch {
      toast.error("Couldn't create the note.");
    }
  }

  return (
    <Button {...props} onClick={create} disabled={createNote.isPending || props.disabled}>
      {createNote.isPending ? <Loader2 className="animate-spin" /> : <SquarePen />}
      {children}
    </Button>
  );
}
