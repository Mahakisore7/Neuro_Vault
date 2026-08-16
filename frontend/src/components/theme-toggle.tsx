"use client";

import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";

import { Button } from "@/components/ui/button";

export function ThemeToggle() {
  // resolvedTheme is undefined both during SSR and during the client's
  // first render (next-themes only reads localStorage after mount, to
  // avoid a hydration mismatch) - so treating "not yet dark" as the Moon
  // icon needs no mounted-tracking state of our own; the two renders
  // already agree.
  const { resolvedTheme, setTheme } = useTheme();

  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label="Toggle theme"
      onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
      className="text-muted-foreground"
    >
      {resolvedTheme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}
    </Button>
  );
}
