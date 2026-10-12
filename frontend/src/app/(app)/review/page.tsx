"use client";

import { CheckCircle2, GraduationCap } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { ErrorState } from "@/components/error-state";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useDueFlashcards, useFlashcardSummary, useReviewFlashcard } from "@/hooks/use-flashcards";
import { usePageTitle } from "@/hooks/use-page-title";

// Four buttons onto SM-2's 0-5 quality scale. "Again" is a lapse (< 3) and
// restarts the card; the other three are passes of increasing ease.
const GRADES = [
  { quality: 1, label: "Again", hint: "Forgot", key: "1", variant: "destructive" },
  { quality: 3, label: "Hard", hint: "Barely", key: "2", variant: "outline" },
  { quality: 4, label: "Good", hint: "Recalled", key: "3", variant: "outline" },
  { quality: 5, label: "Easy", hint: "Instantly", key: "4", variant: "default" },
] as const;

function formatNextDue(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function ReviewPage() {
  const { data: due, isLoading, isError, refetch } = useDueFlashcards();
  const { data: summary } = useFlashcardSummary();
  usePageTitle(summary?.due ? `Review (${summary.due})` : "Review");
  const review = useReviewFlashcard();

  // The queue itself stays as fetched; what's been answered this session is
  // tracked here, so a background refetch can't put a card back in front.
  const [reviewedIds, setReviewedIds] = useState<string[]>([]);
  const [revealed, setRevealed] = useState(false);

  const remaining = (due ?? []).filter((c) => !reviewedIds.includes(c.id));
  const card = remaining[0];
  const sessionSize = reviewedIds.length + remaining.length;

  async function grade(quality: number) {
    if (!card || review.isPending) return;
    try {
      await review.mutateAsync({ id: card.id, quality });
      setReviewedIds((ids) => [...ids, card.id]);
      setRevealed(false);
    } catch {
      toast.error("Couldn't save that review — try again.");
    }
  }

  function restart() {
    setReviewedIds([]);
    setRevealed(false);
    refetch();
  }

  // Keyboard-first: Space reveals, 1-4 grade. Ignored while typing anywhere.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      if (target.closest("input, textarea, [contenteditable=true]")) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (!revealed && (e.key === " " || e.key === "Enter")) {
        e.preventDefault();
        setRevealed(true);
        return;
      }
      const g = revealed ? GRADES.find((x) => x.key === e.key) : undefined;
      if (g) {
        e.preventDefault();
        grade(g.quality);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (isError) {
    return (
      <div className="mx-auto max-w-2xl px-4 pt-8 pb-16 sm:px-8">
        <ErrorState onRetry={() => refetch()} />
      </div>
    );
  }

  if (isLoading || !due) {
    return (
      <div className="mx-auto max-w-2xl space-y-4 px-4 pt-8 pb-16 sm:px-8">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-64 rounded-xl" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl px-4 pt-8 pb-16 sm:px-8">
      <div className="mb-6 flex items-end justify-between gap-4">
        <div>
          <h1 className="text-[1.375rem] leading-8 font-semibold tracking-[-0.02em]">Review</h1>
          <p className="text-sm text-muted-foreground">
            Spaced repetition — cards you know come back less often.
          </p>
        </div>
        {card && (
          <span className="text-sm text-muted-foreground tabular-nums">
            {reviewedIds.length + 1} / {sessionSize}
          </span>
        )}
      </div>

      {card && (
        <div
          className="mb-6 h-1 overflow-hidden rounded-full bg-muted"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={sessionSize}
          aria-valuenow={reviewedIds.length}
        >
          <div
            className="h-full bg-primary transition-[width]"
            style={{ width: `${(reviewedIds.length / sessionSize) * 100}%` }}
          />
        </div>
      )}

      {!card && (
        <div className="empty-state">
          {summary && summary.total === 0 ? (
            <>
              <GraduationCap className="empty-icon" />
              <p className="font-medium">No flashcards yet</p>
              <p className="max-w-sm text-sm text-muted-foreground">
                Open one of your notes and use <span className="font-medium">Flashcards</span> to
                write question-and-answer cards from it.
              </p>
            </>
          ) : (
            <>
              <CheckCircle2 className="mb-3 size-8 text-primary" />
              <p className="font-medium">
                {reviewedIds.length > 0
                  ? `Done — ${reviewedIds.length} ${reviewedIds.length === 1 ? "card" : "cards"} reviewed`
                  : "Nothing due right now"}
              </p>
              {summary?.next_due_at && (
                <p className="text-sm text-muted-foreground">
                  Next card due {formatNextDue(summary.next_due_at)}
                </p>
              )}
              <Button variant="outline" size="sm" className="mt-4" onClick={restart}>
                Check again
              </Button>
            </>
          )}
        </div>
      )}

      {card && (
        <div className="rounded-xl border bg-card">
          <div className="border-b px-6 py-3 text-xs text-muted-foreground">
            From{" "}
            <Link href={`/notes/${card.note_id}`} className="font-medium hover:underline">
              {card.note_title}
            </Link>
          </div>
          <div className="min-h-40 space-y-6 px-6 py-8">
            <p className="text-lg font-medium whitespace-pre-wrap">{card.question}</p>
            {revealed && (
              <p className="border-t pt-6 whitespace-pre-wrap text-muted-foreground">
                {card.answer}
              </p>
            )}
          </div>
          <div className="border-t px-6 py-4">
            {!revealed ? (
              <Button className="w-full" onClick={() => setRevealed(true)}>
                Show answer
                <kbd className="ml-2 text-xs opacity-70">Space</kbd>
              </Button>
            ) : (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {GRADES.map((g) => (
                  <Button
                    key={g.quality}
                    variant={g.variant}
                    disabled={review.isPending}
                    onClick={() => grade(g.quality)}
                    className="h-auto flex-col gap-0 py-2"
                  >
                    <span>{g.label}</span>
                    <span className="text-xs font-normal opacity-70">
                      {g.hint} · {g.key}
                    </span>
                  </Button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
