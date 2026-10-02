import { CheckIcon } from "lucide-react";

import { cn } from "@/lib/utils";

/* Both marks stay mounted and cross-fade, so the change reads as the ring
 * becoming a check rather than one glyph swapped for another. Values are
 * the icon-transition recipe: scale 0.25 → 1, blur 4px → 0, opacity. */
const MARK_CLASS =
  "absolute inset-0 transition-[opacity,scale,filter] duration-200 ease-[cubic-bezier(0.2,0,0,1)] motion-reduce:transition-none";
const MARK_OFF = "scale-[0.25] opacity-0 blur-[4px]";

/** Whether a question has an answer yet. Unanswered says "Optional" —
 * which is true of every field on the page — instead of a nag. */
export function ProfileQuestionMark({
  answered,
  className,
}: {
  answered: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 text-xs transition-colors duration-200 ease-out motion-reduce:transition-none",
        answered
          ? "font-medium text-[var(--brand-subtle-ink)]"
          : "text-[var(--ink-faint)]",
        className,
      )}
    >
      <span aria-hidden="true" className="relative size-3.5 shrink-0">
        <span
          className={cn(
            MARK_CLASS,
            "m-auto size-2 rounded-full shadow-[inset_0_0_0_1.5px_var(--edge-control)]",
            answered && MARK_OFF,
          )}
        />
        <span
          className={cn(
            MARK_CLASS,
            "flex items-center justify-center rounded-full bg-[var(--progress-fill)] text-[var(--surface-raised)]",
            !answered && MARK_OFF,
          )}
        >
          <CheckIcon className="size-2.5" strokeWidth={3} />
        </span>
      </span>
      {answered ? "Answered" : "Optional"}
    </span>
  );
}
