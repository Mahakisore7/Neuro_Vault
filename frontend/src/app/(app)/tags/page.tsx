"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { FileText, MoreVertical, Pin, Plus, Tag as TagIcon, Trash2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { ErrorState } from "@/components/error-state";
import { useConfirm } from "@/components/confirm-dialog";
import { Button } from "@/components/ui/button";
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
import { useNotes } from "@/hooks/use-notes";
import { useCreateTag, useDeleteTag, useTags } from "@/hooks/use-tags";
import { usePageTitle } from "@/hooks/use-page-title";

const schema = z.object({
  name: z.string().min(1, "Name is required").max(50),
  slug: z
    .string()
    .min(1, "Slug is required")
    .max(50)
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "Lowercase letters, numbers, and hyphens only"),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/, "Pick a color"),
});

type FormValues = z.infer<typeof schema>;

const COLORS = ["#6366F1", "#4CAF50", "#2196F3", "#FF9800", "#E91E63", "#9C27B0", "#607D8B"];

function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export default function TagsPage() {
  const { data: tags, isLoading, isError, refetch } = useTags();
  usePageTitle("Tags");
  const createTag = useCreateTag();
  const deleteTag = useDeleteTag();
  const confirm = useConfirm();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const selected = tags?.find((t) => t.id === selectedId);
  const [open, setOpen] = useState(false);
  const [selectedColor, setSelectedColor] = useState(COLORS[0]);

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: { color: COLORS[0] } });

  function pickColor(c: string) {
    setSelectedColor(c);
    setValue("color", c);
  }

  async function onSubmit(values: FormValues) {
    try {
      await createTag.mutateAsync(values);
      toast.success(`Tag "${values.name}" created`);
      reset({ color: COLORS[0] });
      setSelectedColor(COLORS[0]);
      setOpen(false);
    } catch {
      toast.error("Couldn't create the tag. Check the slug isn't already taken.");
    }
  }

  async function handleDelete(id: number, name: string) {
    const ok = await confirm({
      title: `Delete the "${name}" tag?`,
      description: "It's removed from every note it's on. The notes themselves stay.",
      confirmLabel: "Delete tag",
      destructive: true,
    });
    if (!ok) return;
    try {
      await deleteTag.mutateAsync(id);
      toast.success(`Tag "${name}" deleted`);
    } catch {
      toast.error("Couldn't delete the tag.");
    }
  }

  return (
    <div className="mx-auto max-w-3xl px-4 pt-8 pb-16 sm:px-8">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-[1.375rem] leading-8 font-semibold tracking-[-0.02em]">Tags</h1>
          <p className="text-sm text-muted-foreground">
            Label notes across every workspace and notebook.
          </p>
        </div>

        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus />
              New tag
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create a tag</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
              <div className="space-y-2 stagger">
                <Label htmlFor="name">Name</Label>
                <Input
                  id="name"
                  autoFocus
                  {...register("name", {
                    onChange: (e) => setValue("slug", slugify(e.target.value)),
                  })}
                />
                {errors.name && <p className="text-sm text-destructive">{errors.name.message}</p>}
              </div>
              <div className="space-y-2 stagger">
                <Label htmlFor="slug">Slug</Label>
                <Input id="slug" {...register("slug")} />
                {errors.slug && <p className="text-sm text-destructive">{errors.slug.message}</p>}
              </div>
              <div className="space-y-2 stagger">
                <Label>Color</Label>
                <div className="flex gap-2">
                  {COLORS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => pickColor(c)}
                      className={`size-7 rounded-full ring-offset-2 transition-all ${
                        selectedColor === c ? "ring-2 ring-foreground" : ""
                      }`}
                      style={{ backgroundColor: c }}
                      aria-label={c}
                    />
                  ))}
                </div>
              </div>
              <DialogFooter>
                <Button type="submit" disabled={isSubmitting}>
                  {isSubmitting ? "Creating…" : "Create tag"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {isLoading && (
        <div className="flex flex-wrap gap-2">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-7 w-20 rounded-full" />
          ))}
        </div>
      )}

      {isError && !isLoading && <ErrorState onRetry={() => refetch()} />}

      {!isLoading && !isError && tags?.length === 0 && (
        <div className="empty-state">
          <TagIcon className="empty-icon" />
          <p className="font-medium">No tags yet</p>
          <p className="text-sm text-muted-foreground">Create one to start labeling notes.</p>
        </div>
      )}

      {!isLoading && tags && tags.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {tags.map((tag) => (
            <div
              key={tag.id}
              className={`group flex items-center gap-1 rounded-full py-0.5 pr-1 pl-3 ${
                tag.id === selectedId ? "ring-2 ring-current" : ""
              }`}
              style={{ backgroundColor: `${tag.color}1A`, color: tag.color }}
            >
              <button
                type="button"
                aria-pressed={tag.id === selectedId}
                onClick={() => setSelectedId(tag.id === selectedId ? null : tag.id)}
                className="rounded-sm text-sm font-medium focus-visible:outline-2 focus-visible:outline-current"
              >
                {tag.name}
              </button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-6 text-inherit hover:bg-black/10 hover:text-inherit dark:hover:bg-white/10"
                  >
                    <MoreVertical className="size-3.5" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    variant="destructive"
                    onClick={() => handleDelete(tag.id, tag.name)}
                  >
                    <Trash2 />
                    Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          ))}
        </div>
      )}

      {!isLoading && tags && tags.length > 0 && !selected && (
        <p className="mt-6 text-sm text-muted-foreground">Select a tag to see its notes.</p>
      )}
      {selected && <TaggedNotes tagId={selected.id} tagName={selected.name} />}
    </div>
  );
}

function TaggedNotes({ tagId, tagName }: { tagId: number; tagName: string }) {
  const { notes, isLoading, isError, refetch, hasNextPage, fetchNextPage, isFetchingNextPage } =
    useNotes({ tag_id: tagId });

  return (
    <section className="mt-8" aria-label={`Notes tagged ${tagName}`}>
      <h2 className="mb-3 text-sm font-medium text-muted-foreground">
        Notes tagged <span className="text-foreground">{tagName}</span>
        {notes && !hasNextPage && <span className="tabular-nums"> · {notes.length}</span>}
      </h2>

      {isLoading && (
        <div className="space-y-2 stagger">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-11 rounded-lg" />
          ))}
        </div>
      )}

      {isError && !isLoading && <ErrorState onRetry={() => refetch()} />}

      {notes?.length === 0 && (
        <div className="empty-state">
          <FileText className="mb-2 size-6 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            No notes carry this tag yet. Add it from a note&rsquo;s tag bar.
          </p>
        </div>
      )}

      {notes && notes.length > 0 && (
        <ul className="divide-y rounded-lg border">
          {notes.map((note) => (
            <li key={note.id}>
              <Link
                href={`/notes/${note.id}`}
                className="flex items-center gap-2 px-4 py-2.5 text-sm hover:bg-muted"
              >
                {note.pinned && <Pin className="size-3.5 shrink-0 text-primary" />}
                <span className="truncate">{note.title}</span>
                <span className="ml-auto shrink-0 text-xs text-muted-foreground tabular-nums">
                  {note.word_count} words
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {hasNextPage && (
        <Button
          variant="outline"
          className="mt-2 w-full"
          disabled={isFetchingNextPage}
          onClick={() => fetchNextPage()}
        >
          {isFetchingNextPage ? "Loading…" : "Load more notes"}
        </Button>
      )}
    </section>
  );
}
