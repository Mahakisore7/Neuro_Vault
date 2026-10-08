import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "@/lib/api";
import type {
  Note,
  NoteCreate,
  NoteSearchResult,
  NoteSummary,
  NoteUpdate,
  NoteVersionSummary,
} from "@/types/api";

export const noteKeys = {
  all: ["notes"] as const,
  list: (filters: Record<string, unknown>) => [...noteKeys.all, "list", filters] as const,
  detail: (id: string) => [...noteKeys.all, "detail", id] as const,
};

const PAGE_SIZE = 50;
const MAX_LIMIT = 100; // the API's per-request cap on GET /notes

// Follows offset until a short page, so a list is never silently cut off
// at the API's per-request cap.
async function fetchEveryNote(params: Record<string, unknown> = {}) {
  const notes: NoteSummary[] = [];
  for (let offset = 0; ; offset += MAX_LIMIT) {
    const page = (
      await api.get<NoteSummary[]>("/notes", { params: { ...params, limit: MAX_LIMIT, offset } })
    ).data;
    notes.push(...page);
    if (page.length < MAX_LIMIT) return notes;
  }
}

// One notebook's (or one tag's) notes, a page at a time. The API caps each
// response, so a plain query silently stopped at the first 50 notes;
// fetchNextPage() asks for the next slice until a short page says there's
// no more.
export function useNotes(filters: { notebook_id?: string; tag_id?: number }) {
  const query = useInfiniteQuery({
    queryKey: noteKeys.list({ ...filters, paged: true }),
    queryFn: async ({ pageParam }) =>
      (
        await api.get<NoteSummary[]>("/notes", {
          params: { ...filters, limit: PAGE_SIZE, offset: pageParam },
        })
      ).data,
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) =>
      lastPage.length < PAGE_SIZE ? undefined : allPages.length * PAGE_SIZE,
    enabled: Boolean(filters.notebook_id || filters.tag_id),
  });
  return { ...query, notes: query.data?.pages.flat() };
}

// Notes left behind when their notebook was deleted (notebook_id set to
// NULL, not removed - see docs/adr, the notebook delete confirm dialog).
// unfiled is its own query flag: omitting notebook_id already means "every
// note", so it can't also mean "no notebook" without the two colliding.
export function useUnfiledNotes() {
  const filters = { unfiled: true };
  return useQuery({
    queryKey: noteKeys.list(filters),
    queryFn: () => fetchEveryNote(filters),
  });
}

// Every note the caller owns, across every notebook and workspace — for
// pickers (e.g. choosing a target note to link to) that need the whole set.
// Stopping at the first 100 used to leave older notes impossible to pick.
export function useAllNotes(options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: noteKeys.list({ all: true }),
    queryFn: () => fetchEveryNote(),
    enabled: options.enabled ?? true,
  });
}

export function useNoteSearch(q: string) {
  const trimmed = q.trim();
  return useQuery({
    queryKey: [...noteKeys.all, "search", trimmed],
    queryFn: async () =>
      (await api.get<NoteSearchResult[]>("/notes/search", { params: { q: trimmed } })).data,
    enabled: trimmed.length > 0,
    // Keep showing the previous results while the next keystroke's query is
    // in flight, instead of flashing an empty list on every character.
    placeholderData: (previous) => previous,
  });
}

export function useArchivedNotes() {
  const filters = { archived: true };
  return useQuery({
    queryKey: noteKeys.list(filters),
    queryFn: () => fetchEveryNote(filters),
  });
}

// Takes the id per call (unlike useUpdateNote) because the Trash list acts
// on many notes from one component.
export function useRestoreNote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) =>
      (await api.patch<Note>(`/notes/${id}`, { archived: false })).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: noteKeys.all }),
  });
}

export function usePurgeNote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/notes/${id}/permanent`);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: noteKeys.all }),
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
