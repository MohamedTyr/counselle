import { useEffect, useState } from "react";

/**
 * The trailing edge of a fast-changing value.
 *
 * For UI that reacts to something the user is still moving — a text selection
 * being dragged, a search box being typed into — where acting on every
 * intermediate value would flicker without telling anyone anything.
 */
export function useDebounce<T>(value: T, delayMs: number): T {
  const [settled, setSettled] = useState(value);

  useEffect(() => {
    const timer = window.setTimeout(() => setSettled(value), delayMs);
    return () => window.clearTimeout(timer);
  }, [delayMs, value]);

  return settled;
}
