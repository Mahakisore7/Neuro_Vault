import { useSyncExternalStore } from "react";

function subscribe(onStoreChange: () => void) {
  // There's no real external store here - "mounted" only ever flips false
  // -> true, once. Notifying immediately makes useSyncExternalStore re-read
  // the snapshot right after the hydration commit, without calling setState
  // from inside a useEffect body (the pattern react-hooks/set-state-in-effect
  // flags - its own message points here: "use useSyncExternalStore to
  // properly subscribe to external state changes").
  onStoreChange();
  return () => {};
}

const getClientSnapshot = () => true;
const getServerSnapshot = () => false;

/**
 * True once mounted on the client; false during SSR and the hydration
 * render. Gate any output that would otherwise disagree between server and
 * client - reading localStorage, matchMedia, or anything else with no
 * server-side equivalent - behind this instead of rendering it unconditionally.
 */
export function useMounted(): boolean {
  return useSyncExternalStore(subscribe, getClientSnapshot, getServerSnapshot);
}
