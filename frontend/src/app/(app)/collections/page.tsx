"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { isAxiosError } from "axios";
import { Library, MoreVertical, Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { ErrorState } from "@/components/error-state";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
import { Textarea } from "@/components/ui/textarea";
import { useCollections, useCreateCollection, useDeleteCollection } from "@/hooks/use-collections";

const schema = z.object({
  name: z.string().trim().min(1, "Name is required").max(255),
  description: z.string().max(2000).optional(),
});

type FormValues = z.infer<typeof schema>;

export default function CollectionsPage() {
  const router = useRouter();
  const { data: collections, isLoading, isError, refetch } = useCollections();
  const createCollection = useCreateCollection();
  const deleteCollection = useDeleteCollection();
  const [open, setOpen] = useState(false);

  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema) });

  async function onSubmit(values: FormValues) {
    try {
      const created = await createCollection.mutateAsync({
        name: values.name,
        description: values.description?.trim() || null,
      });
      reset();
      setOpen(false);
      router.push(`/collections/${created.id}`);
    } catch (err) {
      // 409 = duplicate name; show the server's message on the field itself.
      if (isAxiosError(err) && err.response?.status === 409) {
        setError("name", { message: err.response.data.detail });
      } else {
        toast.error("Couldn't create the collection.");
      }
    }
  }

  async function handleDelete(id: string, name: string) {
    if (!confirm(`Delete "${name}"? The notes in it aren't affected.`)) return;
    try {
      await deleteCollection.mutateAsync(id);
      toast.success(`"${name}" deleted`);
    } catch {
      toast.error("Couldn't delete the collection.");
    }
  }

  return (
    <div className="mx-auto max-w-5xl px-6 py-10">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Collections</h1>
          <p className="text-sm text-muted-foreground">
            Hand-picked, ordered lists of notes — from any notebook, and a note can be in many.
          </p>
        </div>

        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus />
              New collection
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create a collection</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="name">Name</Label>
                <Input id="name" autoFocus placeholder="Exam revision" {...register("name")} />
                {errors.name && <p className="text-sm text-destructive">{errors.name.message}</p>}
              </div>
              <div className="space-y-2">
                <Label htmlFor="description">Description (optional)</Label>
                <Textarea id="description" rows={2} {...register("description")} />
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
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-28 rounded-xl" />
          ))}
        </div>
      )}

      {isError && !isLoading && <ErrorState onRetry={() => refetch()} />}

      {!isLoading && !isError && collections?.length === 0 && (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed py-20 text-center">
          <Library className="mb-3 size-8 text-muted-foreground" />
          <p className="font-medium">No collections yet</p>
          <p className="text-sm text-muted-foreground">
            Group notes for a topic, an exam, or a reading list.
          </p>
        </div>
      )}

      {!isLoading && collections && collections.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {collections.map((c) => (
            <Card
              key={c.id}
              role="button"
              tabIndex={0}
              onClick={() => router.push(`/collections/${c.id}`)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  router.push(`/collections/${c.id}`);
                }
              }}
              className="cursor-pointer transition-all hover:shadow-sm hover:ring-primary/25"
            >
              <CardHeader className="flex flex-row items-start justify-between space-y-0">
                <div className="min-w-0 flex-1 space-y-1">
                  <CardTitle className="truncate text-base">{c.name}</CardTitle>
                  <CardDescription className="line-clamp-2">
                    {c.description || `${c.item_count} ${c.item_count === 1 ? "note" : "notes"}`}
                  </CardDescription>
                  {c.description && (
                    <p className="text-xs text-muted-foreground">
                      {c.item_count} {c.item_count === 1 ? "note" : "notes"}
                    </p>
                  )}
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
                    <DropdownMenuItem variant="destructive" onClick={() => handleDelete(c.id, c.name)}>
                      <Trash2 />
                      Delete
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
