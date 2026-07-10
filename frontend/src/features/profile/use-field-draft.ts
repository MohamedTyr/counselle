import { useState } from "react"

/**
 * Local edit buffer for a field that autosaves on blur. Resyncs from the
 * server value whenever it changes, including the echo from this field's
 * own successful commit — safe because every commit is scoped to a single
 * leaf path, so an unrelated field's save never touches this buffer.
 *
 * Uses the React-recommended "adjust state during render" pattern (rather
 * than a `useEffect` + `setState`) to avoid an extra render pass.
 */
export function useFieldDraft<T>(serverValue: T) {
  const [draft, setDraft] = useState(serverValue)
  const [lastServerValue, setLastServerValue] = useState(serverValue)

  // Content equality, not reference equality: callers that derive
  // `serverValue` from an unset field (e.g. `itemsFromValue(undefined)`)
  // produce a fresh `[]` on every render, and reference equality would
  // wipe the draft on every keystroke's re-render.
  if (JSON.stringify(serverValue) !== JSON.stringify(lastServerValue)) {
    setLastServerValue(serverValue)
    setDraft(serverValue)
  }

  return [draft, setDraft] as const
}
