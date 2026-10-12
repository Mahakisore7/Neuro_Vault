import { useCallback, useSyncExternalStore } from "react";

export type EditorFont = "sans" | "serif";

const KEY = "neurovault:editor-font";
const CHANGE = "neurovault:editor-font-change";

function subscribe(onChange: () => void) {
  window.addEventListener("storage", onChange);
  window.addEventListener(CHANGE, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(CHANGE, onChange);
  };
}

function read(): EditorFont {
  try {
    return window.localStorage.getItem(KEY) === "serif" ? "serif" : "sans";
  } catch {
    return "sans";
  }
}

/**
 * The typeface notes are written and read in. A per-person preference kept
 * in localStorage (with a same-tab event, since `storage` only fires in
 * other tabs), so it applies across notes and survives a reload.
 */
export function useEditorFont() {
  const font = useSyncExternalStore(subscribe, read, () => "sans" as EditorFont);
  const setFont = useCallback((next: EditorFont) => {
    try {
      window.localStorage.setItem(KEY, next);
    } catch {
      /* private mode: applies to this visit only */
    }
    window.dispatchEvent(new Event(CHANGE));
  }, []);
  return [font, setFont] as const;
}
