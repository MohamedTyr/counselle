import type { Essay } from "@/domain/essay";
import { cn } from "@/lib/utils";

/* Word count against the limit is the one number a student checks repeatedly,
 * so it gets a track when there is a limit to measure against and stays plain
 * text when there is not. The fill reads `--essay-progress-fill`, which a
 * school column sets to the school's own ink. */
export function EssayWordProgress({
  className,
  essay,
}: {
  className?: string;
  essay: Pick<Essay, "wordCount" | "wordLimit">;
}) {
  if (!essay.wordLimit || essay.wordLimit <= 0) {
    return (
      <span
        className={cn("text-xs text-(--ink-secondary) tabular-nums", className)}
      >
        {essay.wordCount} {essay.wordCount === 1 ? "word" : "words"}
      </span>
    );
  }

  const isOverLimit = essay.wordCount > essay.wordLimit;
  const filledRatio = Math.min(essay.wordCount / essay.wordLimit, 1);

  return (
    <span className={cn("flex min-w-0 items-center gap-2.5 text-xs", className)}>
      <span
        className={cn(
          "shrink-0 text-(--ink-secondary) tabular-nums",
          isOverLimit && "font-medium text-(--danger-fg)",
        )}
      >
        {essay.wordCount} / {essay.wordLimit}
      </span>
      <span
        aria-hidden="true"
        className="h-1 min-w-8 flex-1 overflow-hidden rounded-full bg-(--essay-library-progress-track)"
      >
        <span
          className={cn(
            "block h-full rounded-full transition-[width] duration-300 ease-out",
            isOverLimit
              ? "bg-(--danger-solid)"
              : "bg-(--essay-progress-fill,var(--essay-library-progress-fill))",
          )}
          style={{ width: `${filledRatio * 100}%` }}
        />
      </span>
    </span>
  );
}
