"use client";

import { QueryCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MotionConfig } from "motion/react";
import { useState } from "react";
import { toast } from "sonner";

function messageFor(error: unknown): string {
  const status = (error as { response?: { status?: number } })?.response?.status;
  if (status === 401) return "Your session expired — sign in again.";
  if (status === 403) return "You don't have access to that.";
  if (status === 404) return "That wasn't found — it may have been deleted.";
  if (status !== undefined) return "Something went wrong talking to the server.";
  return "Couldn't reach the server. Check your connection.";
}

export function Providers({ children }: { children: React.ReactNode }) {
  // useState, not a module-level constant: one client per component tree.
  const [queryClient] = useState(
    () =>
      new QueryClient({
        // A failed query with no local error handling used to render as a
        // silent blank page — the JWT-mismatch 401 that motivated this was
        // completely invisible in the UI, only visible in server logs.
        // This is the safety net: every query failure surfaces *something*,
        // even on a screen that never bothered to check `isError` itself.
        queryCache: new QueryCache({
          onError: (error) => toast.error(messageFor(error)),
        }),
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            retry: (failureCount, error) => {
              // Never retry a 4xx. The request was wrong; sending it again
              // three more times wastes time and hides the real error.
              const status = (error as { response?: { status?: number } })?.response?.status;
              if (status && status >= 400 && status < 500) return false;
              return failureCount < 2;
            },
            refetchOnWindowFocus: false,
          },
        },
      }),
  );

  // reducedMotion="user": people who ask their OS for less motion get
  // instant transforms and layout changes from every motion component.
  return (
    <QueryClientProvider client={queryClient}>
      <MotionConfig reducedMotion="user">{children}</MotionConfig>
    </QueryClientProvider>
  );
}
