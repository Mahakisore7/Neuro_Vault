"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Inbox, MoreVertical, Pin, Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { ErrorState } from "@/components/error-state";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useCreateNote, useDeleteNote, useRestoreNote, useUnfiledNotes } from "@/hooks/use-notes";
import { usePageTitle } from "@/hooks/use-page-title";

const schema = z.object({
  title: z.string().min(1, "Title is required").max(255),
});

type FormValues = z.infer<typeof schema>;

export default function UnfiledNotesPage() {
  const router = useRouter();
  const { data: notes, isLoading, isError, refetch } = useUnfiledNotes();
  usePageTitle("Unfiled");
  const createNote = useCreateNote();
  const deleteNote = useDeleteNote();
  const restoreNote = useRestoreNote();
  const [open, setOpen] = useState(false);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema) });

  async function onSubmit(values: FormValues) {
    try {
      const note = await createNote.mutateAsync({ title: values.title });
      reset();
      setOpen(false);
      router.push(`/notes/${note.id}`);
    } catch {
      toast.error("Couldn't create the note.");
    }
  }

  async function handleDelete(id: string, title: string) {
    // Reversible, so no "are you sure?" - act at once and offer Undo instead.
    try {
      await deleteNote.mutateAsync(id);
      toast(`"${title}" moved to Trash`, {
        action: {
          label: "Undo",
          onClick: () =>
            restoreNote.mutate(id, {
              onError: () => toast.error("Couldn't restore it — it's still in Trash."),
            }),
        },
      });
    } catch {
      toast.error("Couldn't move the note to Trash.");
    }
  }

  return (
    <div className="mx-auto max-w-3xl px-4 pt-8 pb-16 sm:px-8">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-[1.375rem] leading-8 font-semibold tracking-[-0.02em]">Unfiled notes</h1>
          <p className="text-sm text-muted-foreground">
            Notes with no notebook — either created here directly, or left behind when their
            notebook was deleted.
          </p>
        </div>

        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus />
              New note
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create a note</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
              <div className="space-y-2 stagger">
                <Label htmlFor="title">Title</Label>
                <Input id="title" autoFocus {...register("title")} />
                {errors.title && (
                  <p className="text-sm text-destructive">{errors.title.message}</p>
                )}
              </div>
              <DialogFooter>
                <Button type="submit" disabled={isSubmitting}>
                  {isSubmitting ? "Creating…" : "Create & open"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {isLoading && (
        <div className="space-y-2 stagger">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-14 rounded-lg" />
          ))}
        </div>
      )}

      {isError && !isLoading && <ErrorState onRetry={() => refetch()} />}

      {!isLoading && !isError && notes?.length === 0 && (
        <div className="empty-state">
          <Inbox className="empty-icon" />
          <p className="font-medium">Nothing unfiled</p>
          <p className="text-sm text-muted-foreground">
            Every note is safely inside a notebook.
          </p>
        </div>
      )}

      {!isLoading && notes && notes.length > 0 && (
        <div className="space-y-2 stagger">
          {notes.map((note) => (
            <Card
              key={note.id}
              role="button"
              tabIndex={0}
              onClick={() => router.push(`/notes/${note.id}`)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  router.push(`/notes/${note.id}`);
                }
              }}
              className="card-interactive"
            >
              <CardHeader className="flex flex-row items-center justify-between space-y-0 py-3">
                <div className="flex min-w-0 flex-1 items-center gap-2">
                  {note.pinned && <Pin className="size-3.5 shrink-0 text-primary" />}
                  <CardTitle className="truncate text-base font-normal">{note.title}</CardTitle>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {note.word_count} words
                  </span>
                </div>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-7"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <MoreVertical className="size-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
                    <DropdownMenuItem
                      variant="destructive"
                      onClick={() => handleDelete(note.id, note.title)}
                    >
                      <Trash2 />
                      Move to Trash
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </CardHeader>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
