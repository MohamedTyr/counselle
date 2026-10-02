import { useEffect, useLayoutEffect, useRef } from "react";

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

/**
 * j/k (and ↓/↑) move the selection through the visible list, S saves the
 * selected scholarship. Ignored while typing or while a popup is open.
 */
export function useScholarshipKeys({
  ids,
  selectedId,
  onSelect,
  onToggleSave,
}: {
  ids: string[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onToggleSave: (id: string) => void;
}) {
  const latest = useRef({ ids, selectedId, onSelect, onToggleSave });
  useLayoutEffect(() => {
    latest.current = { ids, selectedId, onSelect, onToggleSave };
  });

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey || isTypingTarget(event.target)) return;
      if (document.querySelector("[role=dialog], [role=menu], [role=listbox]")) return;
      const { ids, selectedId, onSelect, onToggleSave } = latest.current;
      const index = selectedId ? ids.indexOf(selectedId) : -1;
      const key = event.key.toLowerCase();
      let next: string | undefined;
      if (key === "j" || key === "arrowdown") next = ids[Math.min(index + 1, ids.length - 1)];
      else if (key === "k" || key === "arrowup") next = ids[Math.max(index - 1, 0)];
      else if (key === "s" && selectedId) {
        event.preventDefault();
        onToggleSave(selectedId);
        return;
      } else return;
      if (!next) return;
      event.preventDefault();
      onSelect(next);
      document
        .querySelector(`[data-scholarship-id="${CSS.escape(next)}"]`)
        ?.scrollIntoView({ block: "nearest" });
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);
}
