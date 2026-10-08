import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { noteKeys } from "@/hooks/use-notes";
import { api } from "@/lib/api";
import type { Tag, TagCreate, TagUpdate } from "@/types/api";

export const tagKeys = {
  all: ["tags"] as const,
  forNote: (noteId: string) => [...tagKeys.all, "note", noteId] as const,
};

export function useTags() {
  return useQuery({
    queryKey: tagKeys.all,
    queryFn: async () => (await api.get<Tag[]>("/tags")).data,
  });
}

export function useCreateTag() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: TagCreate) => (await api.post<Tag>("/tags", payload)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: tagKeys.all }),
  });
}

export function useUpdateTag(id: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: TagUpdate) =>
      (await api.patch<Tag>(`/tags/${id}`, payload)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: tagKeys.all }),
  });
}

export function useDeleteTag() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => {
      await api.delete(`/tags/${id}`);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: tagKeys.all }),
  });
}

export function useNoteTags(noteId: string | undefined) {
  return useQuery({
    queryKey: tagKeys.forNote(noteId ?? ""),
    queryFn: async () => (await api.get<Tag[]>(`/notes/${noteId}/tags`)).data,
    enabled: Boolean(noteId),
  });
}

export function useAttachTag(noteId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (tagId: number) => {
      await api.post(`/notes/${noteId}/tags/${tagId}`);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: tagKeys.forNote(noteId) });
      // The Tags page lists notes by tag, so that list is now stale too.
      qc.invalidateQueries({ queryKey: [...noteKeys.all, "list"] });
    },
  });
}

export function useDetachTag(noteId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (tagId: number) => {
      await api.delete(`/notes/${noteId}/tags/${tagId}`);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: tagKeys.forNote(noteId) });
      // The Tags page lists notes by tag, so that list is now stale too.
      qc.invalidateQueries({ queryKey: [...noteKeys.all, "list"] });
    },
  });
}
