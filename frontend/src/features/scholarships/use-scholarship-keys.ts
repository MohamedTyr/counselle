import type { KeyboardEvent } from "react";

/** Shortcuts apply only while a card control is focused; opening is native Enter/Space. */
export function useScholarshipKeys({
  onToggleSave,
}: {
  onToggleSave: (id: string) => void;
}) {
  return (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey)
      return;
    if (!(event.target instanceof HTMLElement)) return;
    const card = event.target.closest<HTMLElement>("[data-scholarship-id]");
    if (!card) return;
    const key = event.key.toLowerCase();
    if (key === "s" && card.dataset.scholarshipId) {
      event.preventDefault();
      onToggleSave(card.dataset.scholarshipId);
      return;
    }
    const buttons = [
      ...event.currentTarget.querySelectorAll<HTMLButtonElement>(
        "[data-scholarship-open]",
      ),
    ];
    const index = buttons.findIndex((button) => card.contains(button));
    let next: HTMLButtonElement | undefined;
    if (["j", "arrowright"].includes(key))
      next = buttons[Math.min(index + 1, buttons.length - 1)];
    else if (["k", "arrowleft"].includes(key))
      next = buttons[Math.max(index - 1, 0)];
    else if (key === "home") next = buttons[0];
    else if (key === "end") next = buttons.at(-1);
    if (!next) return;
    event.preventDefault();
    next.focus({ preventScroll: true });
    next.scrollIntoView({ block: "nearest" });
  };
}
