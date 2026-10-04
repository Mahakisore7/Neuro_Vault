import { useEffect, useState } from "react";

export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    // setState inside the timer callback, not the effect body — this is the
    // "subscribe and set state when something external fires" shape that
    // react-hooks/set-state-in-effect allows.
    const id = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(id);
  }, [value, delayMs]);
  return debounced;
}
