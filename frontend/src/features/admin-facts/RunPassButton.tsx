import type { KeyboardEvent, MouseEvent } from "react";

import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import type { FactsStatus } from "@/api/admin/facts-status";
import { factsDisabledReason } from "@/features/admin-facts/crawl-status";

/**
 * The "Run a pass now" button, shared verbatim between the page header and
 * the empty state (plan §5.5, §7 exit test: "both `[Run a pass now]`
 * instances ... render `aria-disabled` (not `disabled`) ... carry that
 * reason in the accessible name ... enqueue nothing on click").
 *
 * Mirrors `features/tasks/task-actions.tsx`'s `PlanWithAgentButton` pattern
 * exactly: `aria-disabled="true"` (never the real `disabled` attribute, so
 * the button stays focusable and its title/label are announced — DESIGN.md
 * §11.6), the reason folded into the accessible name via `aria-label`, and
 * both click and keyboard activation (Enter/Space) suppressed.
 *
 * When nothing blocks it, this renders a normal `Button` whose `loading`
 * prop is true only while its own POST is in flight (DESIGN.md §11.6) —
 * never `loading` for a state where nothing is loading.
 */
export function RunPassButton({
  className,
  isPending,
  onRun,
  size,
  status,
}: {
  className?: string;
  isPending: boolean;
  onRun: () => void;
  size?: "default" | "sm" | "lg";
  status: FactsStatus | undefined;
}) {
  const label = "Run a pass now";
  const reason = factsDisabledReason(status);

  if (reason !== null) {
    const accessibleLabel = `${label} unavailable: ${reason}`;
    const preventActivation = (
      event: KeyboardEvent<HTMLButtonElement> | MouseEvent<HTMLButtonElement>,
    ) => {
      event.preventDefault();
      event.stopPropagation();
    };
    const preventKeyboardActivation = (event: KeyboardEvent<HTMLButtonElement>) => {
      if (event.key === "Enter" || event.key === " ") {
        preventActivation(event);
      }
    };

    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            aria-disabled="true"
            aria-label={accessibleLabel}
            className={cn(
              "aria-disabled:cursor-not-allowed aria-disabled:opacity-64",
              className,
            )}
            onClick={preventActivation}
            onKeyDown={preventKeyboardActivation}
            size={size}
            title={reason}
            type="button"
            variant="outline"
          >
            {label}
          </Button>
        </TooltipTrigger>
        <TooltipContent>{reason}</TooltipContent>
      </Tooltip>
    );
  }

  return (
    <Button
      className={className}
      loading={isPending}
      onClick={onRun}
      size={size}
      type="button"
    >
      {label}
    </Button>
  );
}
