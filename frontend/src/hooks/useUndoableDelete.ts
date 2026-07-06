import { useCallback, useEffect, useRef, useState } from "react";
export const UNDO_WINDOW_MS = 5000;

type PendingUndo<TItem extends { id: string }> = {
  id: string;
  item: TItem;
  label: string;
} | null;

type UndoMutationOptions = {
  onError?: (error: Error) => void;
  onSuccess?: () => void;
};

type UndoMutation = {
  mutate: (id: string, options?: UndoMutationOptions) => void;
  mutateAsync?: (id: string) => Promise<unknown>;
};

export function useUndoableDelete<TItem extends { id: string }>({
  archiveMutation,
  getLabel,
  restoreMutation,
  windowMs = UNDO_WINDOW_MS,
}: {
  archiveMutation: UndoMutation;
  getLabel: (item: TItem) => string;
  restoreMutation: UndoMutation;
  windowMs?: number;
}) {
  const [pending, setPending] = useState<PendingUndo<TItem>>(null);
  const archivePromiseRef = useRef<Promise<boolean> | null>(null);
  const pendingIdRef = useRef<string | null>(null);
  const timeoutRef = useRef<number | undefined>(undefined);

  const clearPending = useCallback(() => {
    window.clearTimeout(timeoutRef.current);
    pendingIdRef.current = null;
    setPending(null);
  }, []);

  const archive = useCallback(
    (item: TItem) => {
      window.clearTimeout(timeoutRef.current);
      pendingIdRef.current = item.id;
      setPending({ id: item.id, item, label: getLabel(item) });
      archivePromiseRef.current = archiveMutation.mutateAsync
        ? archiveMutation.mutateAsync(item.id).then(
            () => true,
            () => {
              if (pendingIdRef.current === item.id) {
                clearPending();
              }
              return false;
            },
          )
        : null;
      if (!archiveMutation.mutateAsync) {
        archiveMutation.mutate(item.id, {
          onError: clearPending,
        });
      }
      timeoutRef.current = window.setTimeout(clearPending, windowMs);
    },
    [archiveMutation, clearPending, getLabel, windowMs],
  );

  const undo = useCallback(() => {
    if (!pending) {
      return;
    }
    const id = pending.id;
    const archivePromise = archivePromiseRef.current;
    clearPending();
    if (!archivePromise) {
      restoreMutation.mutate(id);
      return;
    }
    void archivePromise.then((archived) => {
      if (archived) {
        restoreMutation.mutate(id);
      }
    });
  }, [clearPending, pending, restoreMutation]);

  useEffect(() => clearPending, [clearPending]);

  return {
    archive,
    clearPending,
    pending,
    undo,
  };
}
