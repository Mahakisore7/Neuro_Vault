import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "@/lib/api";
import type { Note, NoteCreate, NoteSummary, NoteUpdate, NoteVersionSummary } from "@/types/api";

export const noteKeys = {
  all: ["notes"] as const,
  list: (filters: Record<string, unknown>) => [...noteKeys.all, "list", filters] as const,
  detail: (id: string) => [...noteKeys.all, "detail", id] as const,
};

export function useNotes(filters: { notebook_id?: string; archived?: boolean } = {}) {
  return useQuery({
    queryKey: noteKeys.list(filters),
    queryFn: async () => (await api.get<NoteSummary[]>("/notes", { params: filters })).data,
    enabled: Boolean(filters.notebook_id),
  });
}

// Notes left behind when their notebook was deleted (notebook_id set to
// NULL, not removed - see docs/adr, the notebook delete confirm dialog).
// unfiled is its own query flag: omitting notebook_id already means "every
// note", so it can't also mean "no notebook" without the two colliding.
export function useUnfiledNotes() {
  const filters = { unfiled: true };
  return useQuery({
    queryKey: noteKeys.list(filters),
    queryFn: async () => (await api.get<NoteSummary[]>("/notes", { params: filters })).data,
  });
}

export function useNote(id: string | undefined) {
  return useQuery({
    queryKey: noteKeys.detail(id ?? ""),
    queryFn: async () => (await api.get<Note>(`/notes/${id}`)).data,
    enabled: Boolean(id),
  });
}

export function useCreateNote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: NoteCreate) => (await api.post<Note>("/notes", payload)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: noteKeys.all }),
  });
}

export function useUpdateNote(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (patch: NoteUpdate) => (await api.patch<Note>(`/notes/${id}`, patch)).data,
    onSuccess: (updated) => {
      qc.setQueryData(noteKeys.detail(id), updated);
      qc.invalidateQueries({ queryKey: noteKeys.all });
    },
  });
}

export function useDeleteNote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/notes/${id}`);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: noteKeys.all }),
  });
}

export function useNoteVersions(noteId: string | undefined) {
  return useQuery({
    queryKey: [...noteKeys.detail(noteId ?? ""), "versions"],
    queryFn: async () =>
      (await api.get<NoteVersionSummary[]>(`/notes/${noteId}/versions`)).data,
    enabled: Boolean(noteId),
  });
}

export function useRollbackVersion(noteId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (versionNum: number) =>
      (await api.post<Note>(`/notes/${noteId}/versions/${versionNum}/rollback`)).data,
    onSuccess: (updated) => {
      qc.setQueryData(noteKeys.detail(noteId), updated);
      qc.invalidateQueries({ queryKey: [...noteKeys.detail(noteId), "versions"] });
    },
  });
}
