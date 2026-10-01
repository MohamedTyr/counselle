import { cn } from "@/lib/utils";
import type { SlotStatus } from "@/features/activities/activities-types";

const segmentClass: Record<SlotStatus | "open", string> = {
  ready: "bg-[var(--progress-fill)]",
  todo: "bg-[var(--warning-solid)]",
  over: "bg-[var(--danger-solid)]",
  open: "bg-[var(--control-quiet-surface)]",
};

/** The Common App's slots as a strip, one segment per slot in list order:
 * green when the entry is paste-ready, amber while it still needs work,
 * red over a character limit, empty while the slot is open. The text
 * beside it says the same thing, so the colours are never the only cue. */
export function SectionStatus({
  className,
  max,
  slots,
}: {
  className?: string;
  max: number;
  slots: SlotStatus[];
}) {
  const ready = slots.filter((slot) => slot === "ready").length;
  const todo = slots.length - ready;
  const over = slots.filter((slot) => slot === "over").length;

  return (
    <div className={cn("flex items-center gap-3", className)}>
      <div aria-hidden="true" className="flex items-center gap-[3px]">
        {Array.from({ length: max }, (_, index) => (
          <span
            className={cn(
              "h-3.5 w-1.5 rounded-full transition-colors duration-200 ease-out",
              segmentClass[slots[index] ?? "open"],
            )}
            key={index}
          />
        ))}
      </div>
      <p className="flex flex-wrap items-center gap-x-1.5 text-[13px] text-[var(--ink-secondary)] tabular-nums">
        <span className="font-medium text-[var(--ink)]">
          {ready} paste-ready
        </span>
        {todo > 0 ? (
          <>
            <span aria-hidden="true" className="text-[var(--ink-faint)]">
              ·
            </span>
            <span>{todo} to finish</span>
          </>
        ) : null}
        {over > 0 ? (
          <>
            <span aria-hidden="true" className="text-[var(--ink-faint)]">
              ·
            </span>
            <span className="text-[var(--activity-danger-fg)]">
              {over} over limit
            </span>
          </>
        ) : null}
      </p>
    </div>
  );
}
