import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "@/lib/api";
import type { Workspace, WorkspaceCreate, WorkspaceUpdate } from "@/types/api";

export const workspaceKeys = {
  all: ["workspaces"] as const,
  detail: (id: string) => [...workspaceKeys.all, id] as const,
};

export function useWorkspaces() {
  return useQuery({
    queryKey: workspaceKeys.all,
    queryFn: async () => (await api.get<Workspace[]>("/workspaces")).data,
  });
}

export function useWorkspace(id: string | undefined) {
  return useQuery({
    queryKey: workspaceKeys.detail(id ?? ""),
    queryFn: async () => (await api.get<Workspace>(`/workspaces/${id}`)).data,
    enabled: Boolean(id),
  });
}

export function useCreateWorkspace() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: WorkspaceCreate) =>
      (await api.post<Workspace>("/workspaces", payload)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: workspaceKeys.all }),
  });
}

export function useUpdateWorkspace(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: WorkspaceUpdate) =>
      (await api.patch<Workspace>(`/workspaces/${id}`, payload)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: workspaceKeys.all });
      qc.invalidateQueries({ queryKey: workspaceKeys.detail(id) });
    },
  });
}

export function useDeleteWorkspace() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/workspaces/${id}`);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: workspaceKeys.all }),
  });
}
