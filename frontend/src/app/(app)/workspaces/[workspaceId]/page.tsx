"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowLeft, BookOpen, MoreVertical, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { useCreateNotebook, useDeleteNotebook, useNotebooks } from "@/hooks/use-notebooks";
import { useWorkspace } from "@/hooks/use-workspaces";

const schema = z.object({
  name: z.string().min(1, "Name is required").max(255),
  description: z.string().max(2000).optional(),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/, "Pick a color"),
});

type FormValues = z.infer<typeof schema>;

const COLORS = ["#4CAF50", "#2196F3", "#FF9800", "#E91E63", "#9C27B0", "#607D8B"];

export default function NotebooksPage() {
  const { workspaceId } = useParams<{ workspaceId: string }>();
  const { data: workspace } = useWorkspace(workspaceId);
  const { data: notebooks, isLoading } = useNotebooks(workspaceId);
  const createNotebook = useCreateNotebook(workspaceId);
  const deleteNotebook = useDeleteNotebook(workspaceId);
  const [open, setOpen] = useState(false);
  const [selectedColor, setSelectedColor] = useState("#4CAF50");

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: { color: "#4CAF50" } });

  function pickColor(c: string) {
    setSelectedColor(c);
    setValue("color", c);
  }

  async function onSubmit(values: FormValues) {
    try {
      await createNotebook.mutateAsync(values);
      toast.success(`Notebook "${values.name}" created`);
      reset({ color: "#4CAF50" });
      setSelectedColor("#4CAF50");
      setOpen(false);
    } catch {
      toast.error("Couldn't create the notebook.");
    }
  }

  async function handleDelete(id: string, name: string) {
    if (!confirm(`Delete "${name}"? Notes inside become unfiled, not deleted.`)) return;
    try {
      await deleteNotebook.mutateAsync(id);
      toast.success(`Notebook "${name}" deleted`);
    } catch {
      toast.error("Couldn't delete the notebook.");
    }
  }

  return (
    <div className="mx-auto max-w-5xl px-6 py-10">
      <Link
        href="/workspaces"
        className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" />
        Workspaces
      </Link>

      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {workspace?.name ?? <Skeleton className="h-8 w-48" />}
          </h1>
          <p className="text-sm text-muted-foreground">Notebooks in this workspace.</p>
        </div>

        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus />
              New notebook
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create a notebook</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="name">Name</Label>
                <Input id="name" {...register("name")} />
                {errors.name && <p className="text-sm text-destructive">{errors.name.message}</p>}
              </div>
              <div className="space-y-2">
                <Label htmlFor="description">Description (optional)</Label>
                <Input id="description" {...register("description")} />
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
                  {isSubmitting ? "Creating…" : "Create notebook"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {isLoading && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-28 rounded-xl" />
          ))}
        </div>
      )}

      {!isLoading && notebooks?.length === 0 && (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed py-20 text-center">
          <BookOpen className="mb-3 size-8 text-muted-foreground" />
          <p className="font-medium">No notebooks yet</p>
          <p className="text-sm text-muted-foreground">Create one to start writing notes.</p>
        </div>
      )}

      {!isLoading && notebooks && notebooks.length > 0 && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {notebooks.map((nb) => (
            <Card key={nb.id} className="group relative transition-shadow hover:shadow-md">
              <CardHeader className="flex-row items-start justify-between space-y-0">
                <CardTitle className="flex items-center gap-2 text-base">
                  <span
                    className="size-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: nb.color }}
                  />
                  <Link href={`/workspaces/${workspaceId}/notebooks/${nb.id}`} className="hover:underline">
                    {nb.name}
                  </Link>
                </CardTitle>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="size-7">
                      <MoreVertical className="size-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem
                      variant="destructive"
                      onClick={() => handleDelete(nb.id, nb.name)}
                    >
                      <Trash2 />
                      Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </CardHeader>
              <CardContent>
                {nb.description && (
                  <p className="line-clamp-2 text-sm text-muted-foreground">{nb.description}</p>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
