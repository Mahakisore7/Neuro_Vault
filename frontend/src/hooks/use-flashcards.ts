import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "@/lib/api";
import type { Flashcard, FlashcardCreate, FlashcardSummary } from "@/types/api";

export const flashcardKeys = {
  all: ["flashcards"] as const,
  forNote: (noteId: string) => [...flashcardKeys.all, "note", noteId] as const,
  due: () => [...flashcardKeys.all, "due"] as const,
  summary: () => [...flashcardKeys.all, "summary"] as const,
};

export function useNoteFlashcards(noteId: string | undefined) {
  return useQuery({
    queryKey: flashcardKeys.forNote(noteId ?? ""),
    queryFn: async () =>
      (await api.get<Flashcard[]>("/flashcards", { params: { note_id: noteId } })).data,
    enabled: Boolean(noteId),
  });
}

export function useDueFlashcards() {
  return useQuery({
    queryKey: flashcardKeys.due(),
    queryFn: async () => (await api.get<Flashcard[]>("/flashcards/due")).data,
    // A review session works through a fixed queue; refetching on focus
    // mid-session would only reshuffle it.
    refetchOnWindowFocus: false,
  });
}

export function useFlashcardSummary() {
  return useQuery({
    queryKey: flashcardKeys.summary(),
    queryFn: async () => (await api.get<FlashcardSummary>("/flashcards/summary")).data,
  });
}

export function useCreateFlashcard(noteId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: Omit<FlashcardCreate, "note_id">) =>
      (await api.post<Flashcard>("/flashcards", { ...payload, note_id: noteId })).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: flashcardKeys.all }),
  });
}

export function useDeleteFlashcard() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/flashcards/${id}`);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: flashcardKeys.all }),
  });
}

export function useReviewFlashcard() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, quality }: { id: string; quality: number }) =>
      (await api.post<Flashcard>(`/flashcards/${id}/review`, { quality })).data,
    // Deliberately not invalidating the due queue: the review page tracks
    // what it has already shown, and the queue refreshes when it restarts.
    onSuccess: (card) => {
      qc.invalidateQueries({ queryKey: flashcardKeys.summary() });
      qc.invalidateQueries({ queryKey: flashcardKeys.forNote(card.note_id) });
    },
  });
}
