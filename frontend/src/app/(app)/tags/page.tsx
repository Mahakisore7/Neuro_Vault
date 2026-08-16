"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { MoreVertical, Plus, Tag as TagIcon, Trash2 } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { ErrorState } from "@/components/error-state";
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
import { useCreateTag, useDeleteTag, useTags } from "@/hooks/use-tags";

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
  const createTag = useCreateTag();
  const deleteTag = useDeleteTag();
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
    if (!confirm(`Delete "${name}"? It's removed from every note it's on.`)) return;
    try {
      await deleteTag.mutateAsync(id);
      toast.success(`Tag "${name}" deleted`);
    } catch {
      toast.error("Couldn't delete the tag.");
    }
  }

  return (
    <div className="mx-auto max-w-3xl px-6 py-10">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Tags</h1>
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
              <div className="space-y-2">
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
              <div className="space-y-2">
                <Label htmlFor="slug">Slug</Label>
                <Input id="slug" {...register("slug")} />
                {errors.slug && <p className="text-sm text-destructive">{errors.slug.message}</p>}
              </div>
              <div className="space-y-2">
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
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed py-20 text-center">
          <TagIcon className="mb-3 size-8 text-muted-foreground" />
          <p className="font-medium">No tags yet</p>
          <p className="text-sm text-muted-foreground">Create one to start labeling notes.</p>
        </div>
      )}

      {!isLoading && tags && tags.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {tags.map((tag) => (
            <div
              key={tag.id}
              className="group flex items-center gap-1 rounded-full py-0.5 pr-1 pl-3"
              style={{ backgroundColor: `${tag.color}1A`, color: tag.color }}
            >
              <span className="text-sm font-medium">{tag.name}</span>
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
    </div>
  );
}
