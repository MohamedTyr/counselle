import { useState } from "react";

export function useSyncedDraft<TValue>(serverValue: TValue) {
  const [draft, setDraft] = useState({ dirty: false, value: serverValue });
  return {
    dirty: draft.dirty,
    value: draft.dirty ? draft.value : serverValue,
    setValue: (next: TValue) => setDraft({ dirty: true, value: next }),
    commit: () => setDraft((current) => ({ ...current, dirty: false })),
    revert: () => setDraft({ dirty: false, value: serverValue }),
  };
}
