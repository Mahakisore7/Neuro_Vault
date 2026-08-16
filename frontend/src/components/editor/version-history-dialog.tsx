"use client";

import { History, RotateCcw } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { useNoteVersions, useRollbackVersion } from "@/hooks/use-notes";

export function VersionHistoryDialog({ noteId }: { noteId: string }) {
  const [open, setOpen] = useState(false);
  const { data: versions, isLoading } = useNoteVersions(open ? noteId : undefined);
  const rollback = useRollbackVersion(noteId);

  async function handleRestore(versionNum: number) {
    if (!confirm(`Restore version ${versionNum}? The current content becomes a new version, so this can always be undone too.`)) {
      return;
    }
    try {
      await rollback.mutateAsync(versionNum);
      toast.success(`Restored version ${versionNum}`);
      setOpen(false);
    } catch {
      toast.error("Couldn't restore that version.");
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" title="Version history">
          <History className="size-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Version history</DialogTitle>
        </DialogHeader>

        {isLoading && (
          <div className="space-y-2">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-12 rounded-lg" />
            ))}
          </div>
        )}

        {!isLoading && versions?.length === 0 && (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No earlier versions yet — every real edit is saved automatically from here on.
          </p>
        )}

        {!isLoading && versions && versions.length > 0 && (
          <div className="max-h-80 space-y-1.5 overflow-y-auto">
            {versions.map((v) => (
              <div
                key={v.version_num}
                className="flex items-center justify-between rounded-lg border px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">Version {v.version_num}</p>
                  <p className="text-xs text-muted-foreground">
                    {new Date(v.created_at).toLocaleString()}
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="shrink-0"
                  disabled={rollback.isPending}
                  onClick={() => handleRestore(v.version_num)}
                >
                  <RotateCcw />
                  Restore
                </Button>
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
