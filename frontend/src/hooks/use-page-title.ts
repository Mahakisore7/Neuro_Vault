import { useEffect } from "react";

/**
 * Names the browser tab after the page ("Review · NeuroVault"), so several
 * open tabs can be told apart. These pages are client components, which
 * can't export Next's `metadata`, so the title is set from an effect.
 * Pass undefined while the name is still loading; the default stays until then.
 */
export function usePageTitle(title: string | undefined) {
  useEffect(() => {
    if (!title) return;
    const previous = document.title;
    document.title = `${title} · NeuroVault`;
    return () => {
      document.title = previous;
    };
  }, [title]);
}
