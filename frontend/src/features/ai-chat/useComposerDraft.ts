import { useCallback, useEffect, useState } from "react";

function readDraft(key: string | null, initial: string): string {
  if (!key) return initial;
  try {
    return sessionStorage.getItem(key) ?? initial;
  } catch {
    return initial;
  }
}

/** Per-tab, per-owner text recovery across sign-in. Never stores credentials or
 * restores one student's unsent words in another student's workspace. */
export function useComposerDraft(
  ownerId: string | undefined,
  conversationId: string,
  initial = "",
): readonly [string, (value: string) => void] {
  const key = ownerId ? `acceptra:composer:${ownerId}:${conversationId}` : null;
  const [state, setState] = useState(() => ({
    key,
    value: readDraft(key, initial),
  }));
  const value = state.key === key ? state.value : readDraft(key, initial);
  useEffect(() => {
    if (!key || !value) return;
    try {
      if (sessionStorage.getItem(key) === null)
        sessionStorage.setItem(key, value);
    } catch {
      /* The in-memory draft remains available when storage is blocked. */
    }
  }, [key, value]);
  const setValue = useCallback(
    (next: string) => {
      if (key) {
        try {
          if (next) sessionStorage.setItem(key, next);
          else sessionStorage.removeItem(key);
        } catch {
          /* Storage may be unavailable; editing still works in memory. */
        }
      }
      setState({ key, value: next });
    },
    [key],
  );
  return [value, setValue] as const;
}
