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
import { useCreateNote, useDeleteNote, useUnfiledNotes } from "@/hooks/use-notes";

const schema = z.object({
  title: z.string().min(1, "Title is required").max(255),
});

type FormValues = z.infer<typeof schema>;

export default function UnfiledNotesPage() {
  const router = useRouter();
  const { data: notes, isLoading, isError, refetch } = useUnfiledNotes();
  const createNote = useCreateNote();
  const deleteNote = useDeleteNote();
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
    if (!confirm(`Archive "${title}"? It won't appear in this list anymore.`)) return;
    try {
      await deleteNote.mutateAsync(id);
      toast.success(`"${title}" archived`);
    } catch {
      toast.error("Couldn't archive the note.");
    }
  }

  return (
    <div className="mx-auto max-w-3xl px-6 py-10">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Unfiled notes</h1>
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
              <div className="space-y-2">
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
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-14 rounded-lg" />
          ))}
        </div>
      )}

      {isError && !isLoading && <ErrorState onRetry={() => refetch()} />}

      {!isLoading && !isError && notes?.length === 0 && (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed py-20 text-center">
          <Inbox className="mb-3 size-8 text-muted-foreground" />
          <p className="font-medium">Nothing unfiled</p>
          <p className="text-sm text-muted-foreground">
            Every note is safely inside a notebook.
          </p>
        </div>
      )}

      {!isLoading && notes && notes.length > 0 && (
        <div className="space-y-2">
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
              className="cursor-pointer transition-all hover:shadow-sm hover:ring-primary/25"
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
                      Archive
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
