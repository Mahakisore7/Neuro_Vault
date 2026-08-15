import { AlertTriangle, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";

export function ErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-destructive/30 bg-destructive/5 py-20 text-center">
      <AlertTriangle className="mb-3 size-8 text-destructive" />
      <p className="font-medium">Couldn&apos;t load this</p>
      <p className="mb-4 text-sm text-muted-foreground">
        Something went wrong talking to the server.
      </p>
      <Button variant="outline" size="sm" onClick={onRetry}>
        <RefreshCw />
        Try again
      </Button>
    </div>
  );
}
