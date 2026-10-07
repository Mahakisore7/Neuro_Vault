"use client"; // error boundaries must be client components

import { AlertTriangle } from "lucide-react";
import Link from "next/link";
import { useEffect } from "react";

import { Button } from "@/components/ui/button";
import { usePageTitle } from "@/hooks/use-page-title";

// Catches a crash inside any signed-in page. The sidebar and header live in
// the layout above this boundary, so they stay usable and only the page area
// shows this. Next 16 names the recovery callback `retry` (it was `reset`).
export default function AppError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  usePageTitle("Something went wrong");
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-4 px-6 py-24 text-center">
      <div className="flex size-12 items-center justify-center rounded-xl bg-destructive/10 text-destructive">
        <AlertTriangle className="size-6" />
      </div>
      <div className="space-y-1">
        <h1 className="text-xl font-semibold tracking-tight">This page hit a problem</h1>
        <p className="text-sm text-muted-foreground">
          Something went wrong while showing it. Your notes are safe — try again, or head back
          to Home.
        </p>
        {error.digest && (
          <p className="pt-1 font-mono text-xs text-muted-foreground">Reference: {error.digest}</p>
        )}
      </div>
      <div className="flex gap-2">
        <Button onClick={() => retry()}>Try again</Button>
        <Button variant="outline" asChild>
          <Link href="/dashboard">Go to Home</Link>
        </Button>
      </div>
    </div>
  );
}
