"use client";

import { ArrowDown, ArrowLeft, ArrowUp, Plus, X } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { ErrorState } from "@/components/error-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import {
  useAddCollectionItem,
  useCollection,
  useRemoveCollectionItem,
  useReorderCollection,
} from "@/hooks/use-collections";
import { useAllNotes } from "@/hooks/use-notes";
import { usePageTitle } from "@/hooks/use-page-title";

export default function CollectionDetailPage() {
  const { collectionId } = useParams<{ collectionId: string }>();
  const router = useRouter();
  const { data: collection, isLoading, isError, refetch } = useCollection(collectionId);
  usePageTitle(collection?.name);
  const addItem = useAddCollectionItem(collectionId);
  const removeItem = useRemoveCollectionItem(collectionId);
  const reorder = useReorderCollection(collectionId);

  const [pickerOpen, setPickerOpen] = useState(false);
  const [query, setQuery] = useState("");
  const { data: allNotes } = useAllNotes({ enabled: pickerOpen });

  const memberIds = new Set((collection?.items ?? []).map((i) => i.note_id));
  const candidates = (allNotes ?? [])
    .filter((n) => !memberIds.has(n.id))
    .filter((n) => n.title.toLowerCase().includes(query.toLowerCase()));

  async function handleAdd(noteId: string) {
    try {
      await addItem.mutateAsync(noteId);
      setPickerOpen(false);
      setQuery("");
    } catch {
      toast.error("Couldn't add that note.");
    }
  }

  async function handleRemove(noteId: string) {
    try {
      await removeItem.mutateAsync(noteId);
    } catch {
      toast.error("Couldn't remove that note.");
    }
  }

  function move(index: number, delta: -1 | 1) {
    if (!collection) return;
    const ids = collection.items.map((i) => i.note_id);
    const target = index + delta;
    if (target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target], ids[index]];
    reorder.mutate(ids, { onError: () => toast.error("Couldn't reorder — changes undone.") });
  }

  if (isError) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-10">
        <ErrorState onRetry={() => refetch()} />
      </div>
    );
  }

  if (isLoading || !collection) {
    return (
      <div className="mx-auto max-w-3xl space-y-4 px-6 py-10">
        <Skeleton className="h-8 w-48" />
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-12 rounded-lg" />
        ))}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-6 py-10">
      <button
        onClick={() => router.push("/collections")}
        className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" />
        Collections
      </button>

      <div className="mb-6 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-semibold tracking-tight">{collection.name}</h1>
          {collection.description && (
            <p className="text-sm text-muted-foreground">{collection.description}</p>
          )}
        </div>

        <Popover
          open={pickerOpen}
          onOpenChange={(o) => {
            setPickerOpen(o);
            if (!o) setQuery("");
          }}
        >
          <PopoverTrigger asChild>
            <Button>
              <Plus />
              Add note
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-72 p-2">
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
                  {allNotes ? "No other notes to add." : "Loading…"}
                </p>
              ) : (
                candidates.map((n) => (
                  <button
                    key={n.id}
                    type="button"
                    disabled={addItem.isPending}
                    onClick={() => handleAdd(n.id)}
                    className="flex w-full items-center rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted"
                  >
                    {n.title}
                  </button>
                ))
              )}
            </div>
          </PopoverContent>
        </Popover>
      </div>

      {collection.items.length === 0 ? (
        <div className="rounded-xl border border-dashed py-16 text-center">
          <p className="font-medium">This collection is empty</p>
          <p className="text-sm text-muted-foreground">Use &ldquo;Add note&rdquo; to start it.</p>
        </div>
      ) : (
        <ol className="space-y-2">
          {collection.items.map((item, index) => (
            <li
              key={item.note_id}
              className="flex items-center gap-3 rounded-lg border bg-card px-3 py-2"
            >
              <span className="w-5 text-right text-xs text-muted-foreground tabular-nums">
                {index + 1}
              </span>
              <Link
                href={`/notes/${item.note_id}`}
                className="min-w-0 flex-1 truncate text-sm font-medium hover:underline"
              >
                {item.title}
              </Link>
              {item.archived && <Badge variant="secondary">In Trash</Badge>}
              <span className="text-xs text-muted-foreground">{item.word_count} words</span>
              <div className="flex items-center">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Move ${item.title} up`}
                  disabled={index === 0 || reorder.isPending}
                  onClick={() => move(index, -1)}
                >
                  <ArrowUp />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Move ${item.title} down`}
                  disabled={index === collection.items.length - 1 || reorder.isPending}
                  onClick={() => move(index, 1)}
                >
                  <ArrowDown />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Remove ${item.title} from collection`}
                  onClick={() => handleRemove(item.note_id)}
                >
                  <X />
                </Button>
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
