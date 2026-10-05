"use client";

import { GraduationCap, Trash2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useCreateFlashcard, useDeleteFlashcard, useNoteFlashcards } from "@/hooks/use-flashcards";

function dueLabel(dueAt: string) {
  const days = Math.ceil((new Date(dueAt).getTime() - Date.now()) / 86_400_000);
  if (days <= 0) return "due now";
  return days === 1 ? "due tomorrow" : `due in ${days} days`;
}

// Cards belong to their owner only, so the panel is shown on your own notes.
export function FlashcardPanel({ noteId }: { noteId: string }) {
  const { data: cards } = useNoteFlashcards(noteId);
  const createCard = useCreateFlashcard(noteId);
  const deleteCard = useDeleteFlashcard();

  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const canSave = question.trim() !== "" && answer.trim() !== "" && !createCard.isPending;

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!canSave) return;
    try {
      await createCard.mutateAsync({ question: question.trim(), answer: answer.trim() });
      setQuestion("");
      setAnswer("");
    } catch {
      toast.error("Couldn't save that card.");
    }
  }

  async function handleDelete(id: string) {
    try {
      await deleteCard.mutateAsync(id);
    } catch {
      toast.error("Couldn't delete that card.");
    }
  }

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground">
          <GraduationCap className="size-4" />
          Flashcards
          {cards && cards.length > 0 && <span className="tabular-nums">· {cards.length}</span>}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Flashcards</DialogTitle>
          <DialogDescription>
            New cards are due straight away and show up in{" "}
            <Link href="/review" className="underline underline-offset-2">
              Review
            </Link>
            .
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleCreate} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="fc-question">Question</Label>
            <Textarea
              id="fc-question"
              rows={2}
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="What does a LEFT JOIN keep that an INNER JOIN drops?"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="fc-answer">Answer</Label>
            <Textarea
              id="fc-answer"
              rows={2}
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
            />
          </div>
          <div className="flex justify-end">
            <Button type="submit" size="sm" disabled={!canSave}>
              {createCard.isPending ? "Adding…" : "Add card"}
            </Button>
          </div>
        </form>

        {cards && cards.length > 0 && (
          <ul className="max-h-64 space-y-2 overflow-y-auto border-t pt-3">
            {cards.map((card) => (
              <li key={card.id} className="flex items-start gap-2 rounded-md border px-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{card.question}</p>
                  <p className="text-sm text-muted-foreground">{card.answer}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{dueLabel(card.due_at)}</p>
                </div>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Delete card"
                  onClick={() => handleDelete(card.id)}
                >
                  <Trash2 />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}
