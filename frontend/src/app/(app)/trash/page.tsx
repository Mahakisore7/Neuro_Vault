"use client";

import { RotateCcw, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { useConfirm } from "@/components/confirm-dialog";
import { ErrorState } from "@/components/error-state";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useArchivedNotes, useEmptyTrash, usePurgeNote, useRestoreNote } from "@/hooks/use-notes";
import { usePageTitle } from "@/hooks/use-page-title";

export default function TrashPage() {
  const { data: notes, isLoading, isError, refetch } = useArchivedNotes();
  usePageTitle("Trash");
  const restore = useRestoreNote();
  const purge = usePurgeNote();
  const emptyTrash = useEmptyTrash();
  const confirm = useConfirm();
  const [pendingPurge, setPendingPurge] = useState<{ id: string; title: string } | null>(null);

  async function handleRestore(id: string, title: string) {
    try {
      await restore.mutateAsync(id);
      toast.success(`"${title}" restored`);
    } catch {
      toast.error("Couldn't restore the note.");
    }
  }

  async function handlePurge() {
    if (!pendingPurge) return;
    const { id, title } = pendingPurge;
    try {
      await purge.mutateAsync(id);
      toast.success(`"${title}" deleted permanently`);
    } catch {
      toast.error("Couldn't delete the note.");
    } finally {
      setPendingPurge(null);
    }
  }

  async function handleEmptyTrash() {
    const count = notes?.length ?? 0;
    const ok = await confirm({
      title: `Delete ${count} ${count === 1 ? "note" : "notes"} forever?`,
      description:
        "Everything in Trash is deleted permanently, with its version history, links, tags and flashcards. This can't be undone.",
      confirmLabel: "Empty Trash",
      destructive: true,
    });
    if (!ok) return;
    try {
      const { deleted } = await emptyTrash.mutateAsync();
      toast.success(`Trash emptied: ${deleted} ${deleted === 1 ? "note" : "notes"} deleted`);
    } catch {
      toast.error("Couldn't empty Trash. Nothing was deleted.");
    }
  }

  return (
    <div className="mx-auto max-w-3xl px-4 pt-8 pb-16 sm:px-8">
      <div className="mb-8 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-[1.375rem] leading-8 font-semibold tracking-[-0.02em]">Trash</h1>
          <p className="text-sm text-muted-foreground">
            Archived notes keep their full history and connections until you delete them here.
          </p>
        </div>
        {notes && notes.length > 0 && (
          <Button
            variant="outline"
            className="shrink-0 text-destructive hover:text-destructive"
            disabled={emptyTrash.isPending}
            onClick={handleEmptyTrash}
          >
            <Trash2 />
            {emptyTrash.isPending ? "Emptying…" : "Empty Trash"}
          </Button>
        )}
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
          <Trash2 className="mb-3 size-8 text-muted-foreground" />
          <p className="font-medium">Trash is empty</p>
          <p className="text-sm text-muted-foreground">Archived notes will show up here.</p>
        </div>
      )}

      {!isLoading && notes && notes.length > 0 && (
        <div className="space-y-2">
          {notes.map((note) => (
            <Card key={note.id}>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 py-3">
                <div className="flex min-w-0 flex-1 items-center gap-2">
                  <CardTitle className="truncate text-base font-normal">{note.title}</CardTitle>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {note.word_count} words
                  </span>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={restore.isPending}
                    onClick={() => handleRestore(note.id, note.title)}
                  >
                    <RotateCcw />
                    Restore
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => setPendingPurge({ id: note.id, title: note.title })}
                  >
                    <Trash2 />
                    Delete forever
                  </Button>
                </div>
              </CardHeader>
            </Card>
          ))}
        </div>
      )}

      <AlertDialog
        open={pendingPurge !== null}
        onOpenChange={(open) => !open && setPendingPurge(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete &ldquo;{pendingPurge?.title}&rdquo; forever?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the note, its entire version history, and every link to or from it. It
              can&apos;t be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={purge.isPending}
              onClick={handlePurge}
            >
              Delete forever
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
