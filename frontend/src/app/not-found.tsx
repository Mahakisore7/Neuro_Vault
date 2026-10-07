import { Network } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";

// Rendered for any URL that matches no route, and wherever notFound() is
// called. It sits inside the root layout, so it follows the app's theme.
export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-background px-6 text-center">
      <title>Page not found · NeuroVault</title>
      <div className="flex size-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
        <Network className="size-6" />
      </div>
      <div className="space-y-1">
        <p className="text-sm font-medium text-muted-foreground tabular-nums">404</p>
        <h1 className="text-2xl font-semibold tracking-tight text-balance">
          This page isn&rsquo;t linked to anything
        </h1>
        <p className="max-w-sm text-sm text-muted-foreground">
          The address may be mistyped, or the page may have been moved or deleted.
        </p>
      </div>
      <Button asChild>
        <Link href="/dashboard">Go to Home</Link>
      </Button>
    </main>
  );
}
