"use client";

import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";

import { Button } from "@/components/ui/button";
import { useMounted } from "@/hooks/use-mounted";

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  // useState's lazy initializer for next-themes' internal theme state reads
  // localStorage on the client's very FIRST render — which is also React's
  // hydration render. SSR can never see localStorage, so resolvedTheme is
  // undefined there but can already be "dark" on that same first client
  // render if a theme was stored: two different icons for what React treats
  // as one render. Rendering a neutral placeholder until after mount makes
  // that first client render match the server (both render nothing), then
  // corrects to the real icon a frame later - no mismatch, brief but
  // unavoidable flash instead of a hydration error.
  const mounted = useMounted();

  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label="Toggle theme"
      onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
      className="text-muted-foreground"
    >
      {mounted && resolvedTheme === "dark" ? (
        <Sun className="size-4" />
      ) : (
        <Moon className="size-4" />
      )}
    </Button>
  );
}
