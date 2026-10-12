"use client";

import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { flushSync } from "react-dom";

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

  function toggle(event: React.MouseEvent<HTMLButtonElement>) {
    const next = resolvedTheme === "dark" ? "light" : "dark";
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!("startViewTransition" in document) || reduceMotion) {
      setTheme(next);
      return;
    }
    // The new theme grows out of the button as a circle that covers the
    // page (View Transitions API), instead of every colour snapping at once.
    const { clientX: x, clientY: y } = event;
    const radius = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
    const transition = document.startViewTransition(() => {
      flushSync(() => setTheme(next));
    });
    transition.ready.then(() => {
      document.documentElement.animate(
        { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
        {
          duration: 550,
          easing: "cubic-bezier(0.16, 1, 0.3, 1)",
          pseudoElement: "::view-transition-new(root)",
        },
      );
    });
  }

  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label="Toggle theme"
      onClick={toggle}
      className="text-muted-foreground hover:text-foreground"
    >
      {mounted && resolvedTheme === "dark" ? (
        <Sun className="size-4" />
      ) : (
        <Moon className="size-4" />
      )}
    </Button>
  );
}
