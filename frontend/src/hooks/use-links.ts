import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "@/lib/api";
import type { KnowledgeLink, KnowledgeLinkCreate, NoteGraph, RelationshipType } from "@/types/api";

export const linkKeys = {
  all: ["links"] as const,
  forNote: (noteId: string) => [...linkKeys.all, "note", noteId] as const,
  graph: (noteId: string, maxDepth: number) =>
    [...linkKeys.all, "graph", noteId, maxDepth] as const,
};

export function useRelationshipTypes() {
  return useQuery({
    queryKey: ["relationship-types"],
    queryFn: async () => (await api.get<RelationshipType[]>("/relationship-types")).data,
    staleTime: Infinity, // seeded, fixed vocabulary — never changes at runtime
  });
}

export function useNoteLinks(noteId: string | undefined) {
  return useQuery({
    queryKey: linkKeys.forNote(noteId ?? ""),
    queryFn: async () => (await api.get<KnowledgeLink[]>(`/notes/${noteId}/links`)).data,
    enabled: Boolean(noteId),
  });
}

export function useCreateLink(noteId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: KnowledgeLinkCreate) =>
      (await api.post<KnowledgeLink>(`/notes/${noteId}/links`, payload)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: linkKeys.forNote(noteId) }),
  });
}

export function useDeleteLink(noteId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (linkId: string) => {
      await api.delete(`/notes/${noteId}/links/${linkId}`);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: linkKeys.forNote(noteId) }),
  });
}

export function useNoteGraph(noteId: string | undefined, maxDepth: number) {
  return useQuery({
    queryKey: linkKeys.graph(noteId ?? "", maxDepth),
    queryFn: async () =>
      (await api.get<NoteGraph>(`/notes/${noteId}/graph`, { params: { max_depth: maxDepth } }))
        .data,
    enabled: Boolean(noteId),
  });
}
