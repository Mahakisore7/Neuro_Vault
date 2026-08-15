"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowLeft, FileText, MoreVertical, Pin, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

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
import { useNotebook } from "@/hooks/use-notebooks";
import { useCreateNote, useDeleteNote, useNotes } from "@/hooks/use-notes";

const schema = z.object({
  title: z.string().min(1, "Title is required").max(255),
});

type FormValues = z.infer<typeof schema>;

export default function NotesPage() {
  const { workspaceId, notebookId } = useParams<{ workspaceId: string; notebookId: string }>();
  const router = useRouter();
  const { data: notebook } = useNotebook(notebookId);
  const { data: notes, isLoading } = useNotes({ notebook_id: notebookId });
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
      const note = await createNote.mutateAsync({ title: values.title, notebook_id: notebookId });
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
      <Link
        href={`/workspaces/${workspaceId}`}
        className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" />
        Notebooks
      </Link>

      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {notebook?.name ?? <Skeleton className="h-8 w-48" />}
          </h1>
          <p className="text-sm text-muted-foreground">Notes in this notebook.</p>
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

      {!isLoading && notes?.length === 0 && (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed py-20 text-center">
          <FileText className="mb-3 size-8 text-muted-foreground" />
          <p className="font-medium">No notes yet</p>
          <p className="text-sm text-muted-foreground">Create one to start writing.</p>
        </div>
      )}

      {!isLoading && notes && notes.length > 0 && (
        <div className="space-y-2">
          {notes.map((note) => (
            <Card key={note.id} className="transition-shadow hover:shadow-sm">
              <CardHeader className="flex-row items-center justify-between space-y-0 py-3">
                <Link href={`/notes/${note.id}`} className="flex min-w-0 flex-1 items-center gap-2">
                  {note.pinned && <Pin className="size-3.5 shrink-0 text-primary" />}
                  <CardTitle className="truncate text-base font-normal">{note.title}</CardTitle>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {note.word_count} words
                  </span>
                </Link>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="size-7">
                      <MoreVertical className="size-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
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
