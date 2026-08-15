import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "@/lib/api";
import type { Notebook, NotebookCreate, NotebookUpdate } from "@/types/api";

export const notebookKeys = {
  all: ["notebooks"] as const,
  list: (workspaceId: string) => [...notebookKeys.all, "list", workspaceId] as const,
  detail: (id: string) => [...notebookKeys.all, "detail", id] as const,
};

export function useNotebooks(workspaceId: string | undefined) {
  return useQuery({
    queryKey: notebookKeys.list(workspaceId ?? ""),
    queryFn: async () =>
      (await api.get<Notebook[]>("/notebooks", { params: { workspace_id: workspaceId } })).data,
    enabled: Boolean(workspaceId),
  });
}

export function useNotebook(id: string | undefined) {
  return useQuery({
    queryKey: notebookKeys.detail(id ?? ""),
    queryFn: async () => (await api.get<Notebook>(`/notebooks/${id}`)).data,
    enabled: Boolean(id),
  });
}

export function useCreateNotebook(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: Omit<NotebookCreate, "workspace_id">) =>
      (await api.post<Notebook>("/notebooks", { ...payload, workspace_id: workspaceId })).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: notebookKeys.list(workspaceId) }),
  });
}

export function useUpdateNotebook(id: string, workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: NotebookUpdate) =>
      (await api.patch<Notebook>(`/notebooks/${id}`, payload)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: notebookKeys.list(workspaceId) });
      qc.invalidateQueries({ queryKey: notebookKeys.detail(id) });
    },
  });
}

export function useDeleteNotebook(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/notebooks/${id}`);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: notebookKeys.list(workspaceId) }),
  });
}
