import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "@/lib/api";
import type {
  Collection,
  CollectionCreate,
  CollectionDetail,
  CollectionUpdate,
} from "@/types/api";

export const collectionKeys = {
  all: ["collections"] as const,
  detail: (id: string) => [...collectionKeys.all, "detail", id] as const,
};

export function useCollections() {
  return useQuery({
    queryKey: collectionKeys.all,
    queryFn: async () => (await api.get<Collection[]>("/collections")).data,
  });
}

export function useCollection(id: string | undefined) {
  return useQuery({
    queryKey: collectionKeys.detail(id ?? ""),
    queryFn: async () => (await api.get<CollectionDetail>(`/collections/${id}`)).data,
    enabled: Boolean(id),
  });
}

export function useCreateCollection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: CollectionCreate) =>
      (await api.post<CollectionDetail>("/collections", payload)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: collectionKeys.all }),
  });
}

export function useDeleteCollection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/collections/${id}`);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: collectionKeys.all }),
  });
}

// Every item mutation returns the full, freshly ordered CollectionDetail,
// so the cache is written directly instead of refetched.
function useDetailMutation<TVars>(id: string, request: (vars: TVars) => Promise<CollectionDetail>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: request,
    onSuccess: (detail) => {
      qc.setQueryData(collectionKeys.detail(id), detail);
      qc.invalidateQueries({ queryKey: collectionKeys.all, exact: true });
    },
  });
}

export function useUpdateCollection(id: string) {
  return useDetailMutation(id, async (payload: CollectionUpdate) =>
    (await api.patch<CollectionDetail>(`/collections/${id}`, payload)).data,
  );
}

export function useAddCollectionItem(id: string) {
  return useDetailMutation(id, async (noteId: string) =>
    (await api.post<CollectionDetail>(`/collections/${id}/items`, { note_id: noteId })).data,
  );
}

export function useRemoveCollectionItem(id: string) {
  return useDetailMutation(id, async (noteId: string) =>
    (await api.delete<CollectionDetail>(`/collections/${id}/items/${noteId}`)).data,
  );
}

export function useReorderCollection(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (noteIds: string[]) =>
      (await api.put<CollectionDetail>(`/collections/${id}/items/order`, { note_ids: noteIds }))
        .data,
    // Optimistic: move the rows immediately, roll back if the server refuses.
    onMutate: async (noteIds) => {
      const key = collectionKeys.detail(id);
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<CollectionDetail>(key);
      if (previous) {
        const byId = new Map(previous.items.map((i) => [i.note_id, i]));
        qc.setQueryData<CollectionDetail>(key, {
          ...previous,
          items: noteIds.flatMap((nid, position) => {
            const item = byId.get(nid);
            return item ? [{ ...item, position }] : [];
          }),
        });
      }
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) qc.setQueryData(collectionKeys.detail(id), context.previous);
    },
    onSuccess: (detail) => qc.setQueryData(collectionKeys.detail(id), detail),
  });
}
