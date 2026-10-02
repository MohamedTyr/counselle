import { getCharState, type CharState } from "@/domain/activity";
import { cn } from "@/lib/utils";
import { charStateClass } from "@/features/activities/activities-config";
import { AlertTriangle, Check } from "lucide-react";

const meterFillClass: Record<CharState, string> = {
  empty: "bg-transparent",
  ok: "bg-[var(--progress-fill)]",
  near: "bg-[var(--warning-solid)]",
  over: "bg-[var(--danger-solid)]",
};

export function CharCounter({
  hideOverIcon = false,
  id,
  length,
  limit,
  meter = false,
}: {
  hideOverIcon?: boolean;
  id?: string;
  length: number;
  limit: number;
  /** A short track beside the count, filled by how much of the budget is
   * spent. The count stays the source of truth; the bar is the glance. */
  meter?: boolean;
}) {
  const state = getCharState(length, limit);
  const over = length - limit;

  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 text-xs tabular-nums",
        charStateClass[state],
      )}
      id={id}
    >
      {state === "over" && !hideOverIcon ? (
        <AlertTriangle aria-hidden="true" className="size-3.5" />
      ) : null}
      {state === "ok" && !meter ? (
        <Check aria-hidden="true" className="size-3.5 opacity-70" />
      ) : null}
      {meter ? (
        <span
          aria-hidden="true"
          className="h-1 w-10 overflow-hidden rounded-full bg-[var(--control-quiet-surface)]"
        >
          <span
            className={cn("block h-full rounded-full", meterFillClass[state])}
            style={{ width: `${Math.min(length / limit, 1) * 100}%` }}
          />
        </span>
      ) : null}
      <span>
        {length}/{limit}
        {state === "over" ? ` · ${over} over` : ""}
      </span>
    </span>
  );
}

// Threshold crossings are announced politely; the visible counter stays quiet
// so screen readers are not spammed on every keystroke.
export function CharLimitAnnouncer({
  length,
  limit,
}: {
  length: number;
  limit: number;
}) {
  const state = getCharState(length, limit);
  const message =
    state === "over"
      ? `${length - limit} characters over the ${limit} character limit`
      : state === "near"
        ? `Approaching the ${limit} character limit`
        : "";

  return (
    <span aria-live="polite" className="sr-only">
      {message}
    </span>
  );
}

const missingList = new Intl.ListFormat("en", {
  style: "long",
  type: "conjunction",
});

/** "Missing description, grades and timing" — what stands between a row and
 * paste-ready, named rather than signalled with a bare warning icon. */
export function MissingFields({ fields }: { fields: string[] }) {
  if (fields.length === 0) {
    return null;
  }

  return (
    <p className="flex items-start gap-1.5 text-xs leading-4 text-[var(--activity-warning-fg)]">
      <AlertTriangle aria-hidden="true" className="mt-px size-3.5 shrink-0" />
      <span>
        Missing {missingList.format(fields.map((field) => field.toLowerCase()))}
      </span>
    </p>
  );
}
