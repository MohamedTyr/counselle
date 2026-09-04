import { useCallback, useEffect, useRef, useState } from "react";

import { UNDO_WINDOW_MS } from "@/hooks/useUndoableDelete";

/**
 * The general-purpose sibling of `useUndoableDelete.ts` (plans/
 * tasks-redesign-plan.md P7.5). That hook owns exactly one archive/restore
 * mutation pair; this one is for any action whose caller already knows how
 * to perform it and how to reverse it. The caller performs the action
 * itself (it already has the right mutation in scope) and hands this hook
 * `{ kind, label, inverse }` — `kind` is the verb `UndoToast` reads via its
 * existing unused `kind?: string` slot ("Essay CSS deleted", "Essay CSS
 * rescheduled"), `inverse` is what `undo()` calls.
 */
export type PendingAction = {
  kind: string;
  label: string;
  inverse: () => void;
} | null;

export function useUndoableAction(windowMs: number = UNDO_WINDOW_MS) {
  const [pending, setPending] = useState<PendingAction>(null);
  const timeoutRef = useRef<number | undefined>(undefined);

  const clearPending = useCallback(() => {
    window.clearTimeout(timeoutRef.current);
    setPending(null);
  }, []);

  const perform = useCallback(
    (action: { kind: string; label: string; inverse: () => void }) => {
      window.clearTimeout(timeoutRef.current);
      setPending(action);
      timeoutRef.current = window.setTimeout(clearPending, windowMs);
    },
    [clearPending, windowMs],
  );

  const undo = useCallback(() => {
    if (!pending) {
      return;
    }
    const { inverse } = pending;
    clearPending();
    inverse();
  }, [clearPending, pending]);

  useEffect(() => clearPending, [clearPending]);

  return { clearPending, pending, perform, undo };
}
